import assert from "node:assert/strict";
import test from "node:test";
import { DeliveryQueue } from "./delivery-queue.js";
import { AuthSessionStore } from "./auth-session.js";
import { MemoryStorageArea } from "./storage.js";
import { ExtensionApiClient, type CandidateSession } from "./api-client.js";
import { ExtensionRuntimeError, failure } from "../shared/errors.js";

async function fixture() {
  const local = new MemoryStorageArea(), session = new MemoryStorageArea();
  const auth = new AuthSessionStore(session), candidateId = crypto.randomUUID(), token = "test-token-private-at-least-16";
  await auth.offer(token); await auth.bind(candidateId, token);
  let time = 100000, offline = false, permanent = false;
  const delivered: string[] = [];
  const api = {
    session: async () => ({ candidate: { id: candidateId } }) as CandidateSession,
    captureInbox: async (item: { itemId: string }, pinned?: string) => {
      assert.equal(pinned, token); delivered.push(item.itemId);
      if (offline) throw new ExtensionRuntimeError(failure("API_TIMEOUT", "Outage", { retryable: true }));
      return { itemId: item.itemId, status: permanent ? "DELETED" : "PENDING", idempotentReplay: false } as const;
    },
    recordOutcome: async (item: { eventId: string }, pinned?: string) => {
      assert.equal(pinned, token); delivered.push(item.eventId);
      if (offline) throw new ExtensionRuntimeError(failure("API_UNAVAILABLE", "Outage", { retryable: !permanent }));
      return { eventId: item.eventId, idempotentReplay: false };
    }
  };
  const create = () => new DeliveryQueue(local, session, auth, api, "https://api.example.test", () => time);
  const note = { schemaVersion: 1 as const, itemId: crypto.randomUUID(), applicationId: crypto.randomUUID(), applicationRunId: crypto.randomUUID(), question: "Unknown question", answer: "PRIVATE_SYNTHETIC_ANSWER", source: "EXPLICIT_SAVE" as const };
  const event = { schemaVersion: 1 as const, eventId: crypto.randomUUID(), applicationId: note.applicationId, applicationRunId: note.applicationRunId, questionId: null, stage: "RESOLVE" as const, code: "API_TIMEOUT" as const, release: "ADAPTIVE_CHECKPOINT_4" as const, containsCandidateValue: false as const };
  return { local, session, auth, candidateId, token, api, create, note, event, delivered, advance: (ms: number) => { time += ms; }, outage: (value: boolean) => { offline = value; }, permanent: () => { permanent = true; } };
}

test("note queue survives worker reload, deduplicates page retry and never stores private payload locally", async () => {
  const f = await fixture(); let queue = f.create();
  assert.equal((await queue.enqueueNote(f.note)).state, "QUEUED");
  assert.equal(JSON.stringify(f.local.values).includes(f.note.answer), false);
  f.outage(true); await queue.flush();
  assert.equal((await queue.summary()).queuedNotes, 1);
  queue = f.create();
  assert.equal((await queue.enqueueNote({ ...f.note, itemId: crypto.randomUUID() })).id, f.note.itemId);
  await queue.flush(); assert.equal(f.delivered.length, 1, "backoff survives restart");
  f.advance(120000); f.outage(false); await queue.flush();
  assert.deepEqual(f.delivered, [f.note.itemId, f.note.itemId]);
  assert.equal((await queue.summary()).delivered, 1);
  assert.equal(JSON.stringify(f.session.values).includes(f.note.answer), false, "ACK erases local private payload");
  assert.equal((await queue.enqueueNote({ ...f.note, itemId: crypto.randomUUID() })).state, "QUEUED");
  f.permanent(); await queue.flush();
  assert.equal((await queue.summary()).rejected, 1, "repeat save rechecks deleted server tombstones");
});

test("outcome queue preserves identities, bounds capacity and reports dropped/expired work", async () => {
  const f = await fixture(); const queue = f.create();
  await Promise.all(Array.from({ length: 200 }, () => queue.enqueueOutcome({ ...f.event, eventId: crypto.randomUUID() })));
  await assert.rejects(queue.enqueueOutcome({ ...f.event, eventId: crypto.randomUUID() }), /full/);
  assert.equal((await queue.summary()).queuedDiagnostics, 200);
  assert.equal((await queue.summary()).dropped, 1);
  await assert.rejects(queue.enqueueOutcome({ ...f.event, answer: f.note.answer } as never));
  assert.equal(JSON.stringify(f.local.values).includes(f.note.answer), false);
  f.advance(24 * 3600_000 + 1); await queue.flush();
  assert.equal(f.delivered.length, 0);
  assert.equal((await queue.summary()).dropped, 201);
});

test("account change and token race cannot deliver queued data with another credential", async () => {
  const f = await fixture(); const queue = f.create();
  await queue.enqueueNote(f.note);
  await f.auth.offer("another-token-at-least-16");
  await f.auth.bind(f.candidateId, f.token); // delayed validation for the old offer
  assert.equal(await f.auth.deliveryIdentity(), null);
  await queue.flush(); assert.equal(f.delivered.length, 0);
  await f.auth.bind(crypto.randomUUID(), "another-token-at-least-16");
  assert.equal((await queue.summary()).queuedNotes, 0);
  assert.equal(JSON.stringify(f.session.values).includes(f.note.answer), false);
  const api = new ExtensionApiClient({ apiOrigin: "https://api.example.test", webOrigins: [], channel: "development" }, f.auth, (async () => { throw new Error("must not send"); }) as typeof fetch);
  await assert.rejects(api.captureInbox(f.note, f.token), /Reconnect/);
});

test("permanent rejection, discard and retry exhaustion remove payloads without claiming saved", async () => {
  const f = await fixture(); let queue = f.create(); f.permanent();
  await queue.enqueueNote(f.note); await queue.flush();
  assert.equal((await queue.enqueueNote(f.note)).state, "REJECTED");
  assert.equal(JSON.stringify(f.session.values).includes(f.note.answer), false);
  const f2 = await fixture(); queue = f2.create();
  await queue.enqueueNote(f2.note); await queue.discardPending(); await queue.flush();
  assert.equal(f2.delivered.length, 0);
  assert.equal((await queue.summary()).dropped, 1);
  const f3 = await fixture(); queue = f3.create(); f3.outage(true);
  await queue.enqueueNote(f3.note);
  for (let n = 0; n < 7; n++) { await queue.flush(); f3.advance(3600_000); }
  assert.equal(f3.delivered.length, 6);
  assert.equal((await queue.summary()).rejected, 1);
  assert.equal(JSON.stringify(f3.session.values).includes(f3.note.answer), false);
});

test("browser restart loses private session notes but diagnostics survive reconnection", async () => {
  const f = await fixture(); const queue = f.create();
  await queue.enqueueNote(f.note); await queue.enqueueOutcome(f.event);
  const session = new MemoryStorageArea(), auth = new AuthSessionStore(session);
  await auth.offer(f.token); await auth.bind(f.candidateId, f.token);
  const restarted = new DeliveryQueue(f.local, session, auth, f.api, "https://api.example.test");
  // Use matching clock so fixture records have not expired.
  const recovered = new DeliveryQueue(f.local, session, auth, f.api, "https://api.example.test", () => 100000);
  assert.equal((await recovered.summary()).queuedNotes, 0);
  assert.equal((await recovered.summary()).queuedDiagnostics, 1);
  await recovered.flush(); assert.deepEqual(f.delivered, [f.event.eventId]);
  await restarted.summary();
});

test("expired disconnected notes are purged; auth outage does not consume delivery attempts", async () => {
  const f = await fixture(); const queue = f.create();
  await queue.enqueueNote(f.note); await f.auth.clear(); await queue.flush();
  assert.equal(f.delivered.length, 0);
  f.advance(24 * 3600_000 + 1); await queue.flush();
  assert.equal(JSON.stringify(f.session.values).includes(f.note.answer), false);
});

test("crash after server acknowledgement retries the original identity and never duplicates a new note", async () => {
  const f = await fixture(); let queue = f.create();
  await queue.enqueueNote(f.note);
  const originalSet = f.session.set.bind(f.session);
  let failReceipt = true;
  f.session.set = async items => {
    if (failReceipt && JSON.stringify(items).includes('"state":"DELIVERED"')) { failReceipt = false; throw new Error("synthetic storage failure"); }
    return originalSet(items);
  };
  await queue.flush();
  assert.equal((await queue.summary()).queuedNotes, 1);
  f.advance(120000); queue = f.create(); await queue.flush();
  assert.deepEqual(f.delivered,[f.note.itemId,f.note.itemId]);
  assert.equal((await queue.summary()).delivered,1);
});

test("verified session changes during flush stop transmission; transient HTTP limits remain retryable", async () => {
  const f = await fixture();
  f.api.session = async () => { await f.auth.offer("new-credential-at-least-16"); return { candidate:{id:f.candidateId} } as CandidateSession; };
  const queue = f.create(); await queue.enqueueNote(f.note); await queue.flush();
  assert.equal(f.delivered.length,0);
  await f.auth.offer(f.token);
  for (const status of [408,429,503]) {
    const api = new ExtensionApiClient({ apiOrigin:"https://api.example.test",webOrigins:[],channel:"development" },f.auth,(async()=>new Response("{}",{status})) as typeof fetch);
    await assert.rejects(api.recordOutcome(f.event,f.token),error => error instanceof ExtensionRuntimeError && error.failure.retryable);
  }
});
