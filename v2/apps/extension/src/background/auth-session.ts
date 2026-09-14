import { z } from "zod";
import { AuthRuntimeStateSchema, type AuthRuntimeState } from "../shared/contracts.js";
import type { StorageArea } from "./storage.js";

const key = "jobHunter.extension.auth.v1";
const StoredAuthSchema = z.object({
  accessToken: z.string().min(16).max(8_192).nullable(),
  state: AuthRuntimeStateSchema,
  validatedAt: z.iso.datetime().nullable()
  ,candidateId: z.uuid().nullable().default(null)
}).strict();

export class AuthSessionStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: StorageArea) {}
  private serial(work: () => Promise<void>): Promise<void> {
    const result = this.writes.then(work); this.writes = result.catch(() => undefined); return result;
  }

  async offer(accessToken: string): Promise<void> {
    await this.serial(() => this.storage.set({ [key]: StoredAuthSchema.parse({ accessToken, state: "NOT_AUTHENTICATED", validatedAt: null }) }));
  }

  async token(): Promise<string | null> {
    await this.writes;
    const parsed = StoredAuthSchema.safeParse((await this.storage.get(key))[key]);
    return parsed.success ? parsed.data.accessToken : null;
  }

  async bind(candidateId: string, token: string): Promise<void> {
    return this.serial(async () => {
    const parsed = StoredAuthSchema.safeParse((await this.storage.get(key))[key]);
    if (parsed.success && parsed.data.accessToken === token) await this.storage.set({ [key]: { ...parsed.data, candidateId: z.uuid().parse(candidateId) } });
    });
  }

  async deliveryIdentity(): Promise<{ candidateId: string; token: string } | null> {
    await this.writes;
    const parsed = StoredAuthSchema.safeParse((await this.storage.get(key))[key]);
    return parsed.success && parsed.data.accessToken && parsed.data.candidateId
      ? { candidateId: parsed.data.candidateId, token: parsed.data.accessToken } : null;
  }

  async state(): Promise<AuthRuntimeState> {
    await this.writes;
    const parsed = StoredAuthSchema.safeParse((await this.storage.get(key))[key]);
    return parsed.success ? parsed.data.state : "NOT_AUTHENTICATED";
  }

  async mark(state: AuthRuntimeState): Promise<void> {
    return this.serial(async () => {
    const parsed = StoredAuthSchema.safeParse((await this.storage.get(key))[key]);
    if (!parsed.success) {
      if (state !== "NOT_AUTHENTICATED") throw new Error("AUTH_TOKEN_MISSING");
      return;
    }
    await this.storage.set({ [key]: { ...parsed.data, state, validatedAt: new Date().toISOString() } });
    });
  }

  async clear(state: "NOT_AUTHENTICATED" | "SESSION_EXPIRED" = "NOT_AUTHENTICATED"): Promise<void> {
    return this.serial(async () => {
    const parsed = StoredAuthSchema.safeParse((await this.storage.get(key))[key]);
    if (!parsed.success || state === "NOT_AUTHENTICATED") { await this.storage.remove(key); return; }
    await this.storage.set({ [key]: { ...parsed.data, accessToken: null, state, validatedAt: new Date().toISOString() } });
    });
  }
}
