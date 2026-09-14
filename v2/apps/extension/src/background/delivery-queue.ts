import { z } from "zod";
import { AutofillOutcomeSchema, LearningInboxCaptureSchema, type AutofillOutcome, type LearningInboxCapture } from "@job-hunter-v2/contracts";
import type { StorageArea } from "./storage.js";
import type { AuthSessionStore } from "./auth-session.js";
import type { ExtensionApiClient } from "./api-client.js";
import { ExtensionRuntimeError, failure, safeFailure } from "../shared/errors.js";

const EntrySchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), id: z.uuid(),
  kind: z.enum(["NOTE", "OUTCOME"]), state: z.enum(["QUEUED", "DELIVERED", "REJECTED"]),
  payload: z.union([LearningInboxCaptureSchema, AutofillOutcomeSchema]).nullable(),
  expiresAt: z.number().int(), nextAt: z.number().int(), attempts: z.number().int().min(0).max(6)
}).strict();
const StateSchema = z.object({ owner: z.string().regex(/^[a-f0-9]{64}$/), entries: z.array(EntrySchema).max(200), dropped: z.number().int().nonnegative() }).strict();
type State = z.infer<typeof StateSchema>;
const key = "jobHunter.delivery.v1";
const ttl = 24 * 60 * 60 * 1000;
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Single service-worker writer. Notes stay in trusted session memory; no answers on disk. */
export class DeliveryQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private flushing = false;
  constructor(private readonly local: StorageArea, private readonly session: StorageArea, private readonly auth: AuthSessionStore,
    private readonly api: Pick<ExtensionApiClient, "recordOutcome" | "captureInbox" | "session">, private readonly apiOrigin: string,
    private readonly now: () => number = Date.now) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work); this.chain = result.catch(() => undefined); return result;
  }
  private async identity() {
    const identity = await this.auth.deliveryIdentity();
    if (!identity) throw new ExtensionRuntimeError(failure("AUTH_EXPIRED", "Reconnect before queuing answers or diagnostics.", { category: "AUTHORIZATION" }));
    return { ...identity, owner: await digest(`${this.apiOrigin}:${identity.candidateId}`) };
  }
  private async read(storage: StorageArea, owner: string): Promise<State> {
    const parsed = StateSchema.safeParse((await storage.get(key))[key]);
    const state: State = parsed.success && parsed.data.owner === owner ? parsed.data : { owner, entries: [], dropped: 0 };
    const expired = state.entries.filter(entry => entry.expiresAt <= this.now());
    state.dropped += expired.filter(entry => entry.state === "QUEUED").length;
    state.entries = state.entries.filter(entry => entry.expiresAt > this.now() && (storage !== this.local || entry.kind === "OUTCOME"));
    await storage.set({ [key]: state });
    return state;
  }

  async enqueueNote(raw: LearningInboxCapture) { return this.enqueue("NOTE", LearningInboxCaptureSchema.parse(raw)); }
  async enqueueOutcome(raw: AutofillOutcome) { return this.enqueue("OUTCOME", AutofillOutcomeSchema.parse(raw)); }
  private enqueue(kind: "NOTE" | "OUTCOME", payload: LearningInboxCapture | AutofillOutcome) {
    return this.serial(async () => {
      const identity = await this.identity();
      const storage = kind === "NOTE" ? this.session : this.local;
      const state = await this.read(storage, identity.owner);
      // Notes use semantic identity across page reloads, retaining the original server item ID.
      const semantic = "itemId" in payload ? { ...payload, itemId: undefined } : payload;
      const fingerprint = await digest(JSON.stringify(semantic));
      const prior = state.entries.find(entry => entry.fingerprint === fingerprint);
      if (prior) {
        if (kind === "NOTE" && prior.state === "DELIVERED" && "itemId" in payload) {
          // Recheck server tombstones on an explicit repeat save; never resurrect a deleted note.
          prior.state = "QUEUED"; prior.payload = { ...payload, itemId: prior.id }; prior.attempts = 0; prior.nextAt = this.now();
          await storage.set({ [key]: state });
        }
        return { state: prior.state, id: prior.id };
      }
      if (state.entries.length >= 200) {
        const completed = state.entries.findIndex(entry => entry.state !== "QUEUED");
        if (kind === "OUTCOME" && completed >= 0) state.entries.splice(completed, 1);
        else { state.dropped++; await storage.set({ [key]: state }); throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "Delivery queue is full. Review delivery status and retry later.")); }
      }
      const id = "itemId" in payload ? payload.itemId : payload.eventId;
      state.entries.push({ fingerprint, id, kind, state: "QUEUED", payload, attempts: 0, nextAt: this.now(), expiresAt: this.now() + ttl });
      await storage.set({ [key]: state });
      return { state: "QUEUED" as const, id };
    });
  }

  async summary() {
    return this.serial(async () => {
      const identity = await this.auth.deliveryIdentity();
      if (!identity) return { connected: false, queuedNotes: 0, queuedDiagnostics: 0, delivered: 0, rejected: 0, dropped: 0 };
      const owner = await digest(`${this.apiOrigin}:${identity.candidateId}`);
      const notes = await this.read(this.session, owner), outcomes = await this.read(this.local, owner);
      const entries = [...notes.entries, ...outcomes.entries];
      return { connected: true, queuedNotes: notes.entries.filter(e => e.state === "QUEUED").length, queuedDiagnostics: outcomes.entries.filter(e => e.state === "QUEUED").length,
        delivered: entries.filter(e => e.state === "DELIVERED").length, rejected: entries.filter(e => e.state === "REJECTED").length, dropped: notes.dropped + outcomes.dropped };
    });
  }

  async discardPending() {
    return this.serial(async () => {
      const identity = await this.identity();
      for (const storage of [this.session, this.local]) {
        const state = await this.read(storage, identity.owner);
        for (const entry of state.entries) if (entry.state === "QUEUED") { entry.state = "REJECTED"; entry.payload = null; state.dropped++; }
        await storage.set({ [key]: state });
      }
    });
  }

  private async expireDisconnected() {
    for (const storage of [this.session, this.local]) {
      const parsed = StateSchema.safeParse((await storage.get(key))[key]);
      if (parsed.success) await this.read(storage, parsed.data.owner);
      else await storage.remove(key);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.serial(async () => {
        await this.expireDisconnected();
        const identity = await this.identity();
        const states = [await this.read(this.session, identity.owner), await this.read(this.local, identity.owner)];
        if (!states.some(state => state.entries.some(e => e.state === "QUEUED" && e.nextAt <= this.now()))) return;
        // Verify server identity before sending, then pin every request to that exact credential.
        const verified = await this.api.session();
        if (verified.candidate.id !== identity.candidateId || (await this.auth.token()) !== identity.token) return;
        let sent = 0;
        for (let index = 0; index < states.length; index++) {
          const state = states[index]!, storage = index === 0 ? this.session : this.local;
          for (const entry of state.entries) {
            if (sent >= 5) break;
            if (entry.state !== "QUEUED" || entry.nextAt > this.now()) continue;
            if ((await this.auth.token()) !== identity.token) return;
            if (entry.attempts >= 6 || entry.expiresAt <= this.now()) {
              entry.state = "REJECTED"; entry.payload = null; state.dropped++;
              await storage.set({ [key]: state }); continue;
            }
            // Persist an attempt before the side effect. A crash can only replay the original ID.
            entry.attempts++; entry.nextAt = this.now() + Math.min(3600_000, 30_000 * 2 ** entry.attempts);
            await storage.set({ [key]: state }); sent++;
            try {
              if (entry.kind === "NOTE") {
                const result = await this.api.captureInbox(LearningInboxCaptureSchema.parse(entry.payload), identity.token);
                entry.state = result.status === "PENDING" ? "DELIVERED" : "REJECTED";
              } else {
                await this.api.recordOutcome(AutofillOutcomeSchema.parse(entry.payload), identity.token);
                entry.state = "DELIVERED";
              }
            } catch (error) {
              const reason = safeFailure(error);
              if (reason.code === "AUTH_EXPIRED") { entry.attempts--; await storage.set({ [key]: state }); return; }
              if (!reason.retryable || entry.attempts >= 6) entry.state = "REJECTED";
            }
            if (entry.state !== "QUEUED") entry.payload = null;
            await storage.set({ [key]: state });
          }
        }
      });
    } catch { /* Auth/storage outages leave pending evidence untouched; status is separately read. */ }
    finally { this.flushing = false; }
  }
}
