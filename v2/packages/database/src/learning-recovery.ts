import { createHash } from "node:crypto";
import { ConfirmLearningNoteSchema, LearningInboxPageSchema, type ConfirmLearningNote } from "@job-hunter-v2/contracts";
import { CandidateTruthService,candidateAnswerPolicy,resolveCandidateAnswerScope,candidateFingerprintMatches } from "@job-hunter-v2/candidate-truth";
import { KyselyCandidateTruthRepository } from "./index.js";
import { AutofillOutcomeSchema, LearningInboxCaptureSchema, type AutofillOutcome, type LearningInboxCapture } from "@job-hunter-v2/contracts";
import type { CandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { ConflictError, IdempotencyConflictError, NotFoundError, ValidationError } from "@job-hunter-v2/domain";
import type { LearningPayloadCipher } from "@job-hunter-v2/verified-learning";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";
import { inTransaction } from "./transaction-scope.js";
import { learningNoteValue } from "./learning-note-value.js";

type Owner = { accountId: string; candidateId: string };
type StoredPayload = { keyVersion: number; initializationVector: string; authenticationTag: string; ciphertext: string };

/** Maintenance authority only: no candidate route and no private payload in the result. */
export async function purgeExpiredLearningInbox(database: Kysely<V2Database>, limit = 1000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ValidationError("Cleanup batch size must be 1–1000.");
  const result = await sql`WITH expired AS (
    SELECT id FROM candidate_learning_inbox WHERE expires_at <= now() AND payload IS NOT NULL
    ORDER BY expires_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED
  ) UPDATE candidate_learning_inbox inbox SET payload = NULL FROM expired WHERE inbox.id = expired.id RETURNING inbox.id`.execute(database);
  return { purged: result.rows.length };
}

/** Private recovery and value-free diagnostics stay separate; only explicit confirmation writes truth. */
export class KyselyLearningRecovery {
  constructor(private readonly database: Kysely<V2Database>, private readonly cipher: LearningPayloadCipher, private readonly fingerprinter: CandidateValueFingerprinter) {}

  async preview(owner: Owner, itemId: string, raw: ConfirmLearningNote) {
    const request=ConfirmLearningNoteSchema.parse(raw),result = learningNoteValue(request);
    const note = await sql<{ application_id: string; run_id: string }>`SELECT application_id,run_id FROM candidate_learning_inbox WHERE id = ${itemId} AND account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId} AND status = 'PENDING' AND payload IS NOT NULL AND expires_at > now()`.execute(this.database);
    if (!note.rows[0]) throw new NotFoundError("Available note not found.");
    await this.authorize(this.database, owner, note.rows[0].application_id, note.rows[0].run_id);
    const scope=request.scope??"GLOBAL",applicationId=note.rows[0].application_id;
    const resolved=resolveCandidateAnswerScope({policy:candidateAnswerPolicy(request.canonicalKey),scopeType:scope,...(scope==="APPLICATION"?{requested:{applicationId},context:{applicationId}}:{})});
    if(!resolved.ok)throw new ValidationError("The selected field cannot be reused in this scope.");
    const current=await new KyselyCandidateTruthRepository(this.database).findCurrent({...owner,canonicalKey:request.canonicalKey,entityId:null,scopeFingerprint:resolved.scope.scopeFingerprint});
    return { ...result, scope, applicationId:scope==="APPLICATION"?applicationId:null,currentValue:current?.normalizedValue??null,expectedCurrentVersionId:current?.answerVersionId??null, containsCandidateValue: true as const };
  }

  async confirm(owner: Owner, itemId: string, raw: ConfirmLearningNote) {
    const request = ConfirmLearningNoteSchema.parse(raw);
    const { normalizedValue } = learningNoteValue(request);
    const fingerprintValue = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const, kind: "STRING" as const, value: JSON.stringify(request) };
    const fingerprint = this.fingerprinter.fingerprint(fingerprintValue);
    return inTransaction(this.database, async (transaction) => {
      const note = await sql<{ application_id: string; run_id: string; status: string; available: boolean }>`SELECT application_id,run_id,status,(payload IS NOT NULL AND expires_at > now()) AS available
        FROM candidate_learning_inbox WHERE id = ${itemId} AND account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId} FOR UPDATE`.execute(transaction);
      const row = note.rows[0];
      if (!row) throw new NotFoundError("Pending note not found.");
      await this.authorize(transaction, owner, row.application_id, row.run_id);
      const replay = await sql<{ request_fingerprint: string; fingerprint_key_version:number|null; change_set_id: string }>`SELECT request_fingerprint,fingerprint_key_version,change_set_id FROM candidate_learning_note_confirmations WHERE item_id = ${itemId} AND candidate_id = ${owner.candidateId}`.execute(transaction);
      if (replay.rows[0]) {
        if (!candidateFingerprintMatches(this.fingerprinter,fingerprintValue,{digest:replay.rows[0].request_fingerprint,keyVersion:replay.rows[0].fingerprint_key_version})) throw new IdempotencyConflictError("This note's confirmation cannot be verified with the supplied details and configured keys.");
        return { changeSetId: replay.rows[0].change_set_id, idempotentReplay: true };
      }
      const assertAvailable=async()=>{
        const live=await sql`SELECT id FROM candidate_learning_inbox WHERE id=${itemId} AND status='PENDING' AND payload IS NOT NULL AND expires_at>clock_timestamp()`.execute(transaction);
        if(!live.rows.length)throw new ConflictError("This note was deleted or expired.");
      };
      await assertAvailable();
      const truth = new CandidateTruthService(new KyselyCandidateTruthRepository(transaction), this.fingerprinter);
      const scope=request.scope??"GLOBAL",applicationId=row.application_id;
      const saved = await truth.saveGroup({ ...owner, commitPoint: "EXPLICIT_SAVE",applicationId:scope==="APPLICATION"?applicationId:null, idempotencyKey: `note-confirm:${itemId}`, items: [{ itemKey: itemId, canonicalKey: request.canonicalKey, normalizedValue, scopeType:scope,...(scope==="APPLICATION"?{requestedScope:{applicationId},context:{applicationId}}:{}), entityId: null, source: "PROFILE", expectedCurrentVersionId: request.expectedCurrentVersionId }] });
      await assertAvailable(); // A wait in Candidate Truth must not extend evidence retention.
      await sql`INSERT INTO candidate_learning_note_confirmations(item_id,candidate_id,request_fingerprint,fingerprint_key_version,change_set_id,canonical_key) VALUES(${itemId},${owner.candidateId},${fingerprint.digest},${fingerprint.keyVersion},${saved.changeSetId},${request.canonicalKey})`.execute(transaction);
      return { changeSetId: saved.changeSetId, idempotentReplay: false };
    });
  }

  private async authorize(database: Kysely<V2Database>, owner: Owner, applicationId: string, runId: string): Promise<void> {
    const result = await sql`SELECT application.id FROM applications application JOIN application_runs run ON run.application_id = application.id
      JOIN candidates candidate ON candidate.id = application.candidate_id JOIN accounts account ON account.id = application.account_id
      WHERE application.id = ${applicationId} AND run.id = ${runId} AND application.account_id = ${owner.accountId}
      AND application.candidate_id = ${owner.candidateId} AND candidate.status = 'ACTIVE' AND account.status = 'ACTIVE'`.execute(database);
    if (!result.rows.length) throw new NotFoundError("Application run not found.");
  }

  async capture(owner: Owner, raw: LearningInboxCapture) {
    const request = LearningInboxCaptureSchema.parse(raw);
    const normalized = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const, kind: "STRING" as const, value: JSON.stringify({ question: request.question, answer: request.answer, source: request.source }) };
    const fingerprintValue={...normalized,value:JSON.stringify(request)};
    const fingerprint = this.fingerprinter.fingerprint(fingerprintValue);
    const encrypted = this.cipher.encrypt(normalized);
    const payload: StoredPayload = { keyVersion: encrypted.keyVersion, initializationVector: Buffer.from(encrypted.initializationVector).toString("base64"), authenticationTag: Buffer.from(encrypted.authenticationTag).toString("base64"), ciphertext: Buffer.from(encrypted.ciphertext).toString("base64") };
    return inTransaction(this.database, async (transaction) => {
      await this.authorize(transaction, owner, request.applicationId, request.applicationRunId);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`inbox:${owner.candidateId}`})::bigint)`.execute(transaction);
      const replay = await sql<{ fingerprint: string; fingerprint_key_version:number|null; status: string }>`SELECT fingerprint,fingerprint_key_version,CASE WHEN status = 'PENDING' AND expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE status END AS status FROM candidate_learning_inbox WHERE id = ${request.itemId} AND candidate_id = ${owner.candidateId} AND account_id = ${owner.accountId}`.execute(transaction);
      if (replay.rows[0]) {
        if (!candidateFingerprintMatches(this.fingerprinter,fingerprintValue,{digest:replay.rows[0].fingerprint,keyVersion:replay.rows[0].fingerprint_key_version})) throw new IdempotencyConflictError("Inbox replay cannot be verified with the supplied evidence and configured keys.");
        return { itemId: request.itemId, status: replay.rows[0].status, idempotentReplay: true };
      }
      await sql`UPDATE candidate_learning_inbox SET payload = NULL WHERE account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId} AND expires_at <= now() AND payload IS NOT NULL`.execute(transaction);
      const count = await sql<{ count: number }>`SELECT count(*)::int AS count FROM candidate_learning_inbox inbox WHERE candidate_id = ${owner.candidateId} AND account_id = ${owner.accountId} AND status = 'PENDING' AND expires_at > now() AND NOT EXISTS(SELECT 1 FROM candidate_learning_note_confirmations confirmation WHERE confirmation.item_id = inbox.id)`.execute(transaction);
      if ((count.rows[0]?.count ?? 0) >= 200) throw new ConflictError("Review or delete pending answers before saving more.");
      await sql`INSERT INTO candidate_learning_inbox(id,account_id,candidate_id,application_id,run_id,payload,fingerprint,fingerprint_key_version,expires_at)
        VALUES(${request.itemId},${owner.accountId},${owner.candidateId},${request.applicationId},${request.applicationRunId},${JSON.stringify(payload)}::jsonb,${fingerprint.digest},${fingerprint.keyVersion},clock_timestamp() + interval '30 days')`.execute(transaction);
      return { itemId: request.itemId, status: "PENDING", idempotentReplay: false };
    });
  }

  async list(owner: Owner) {
    return (await this.listPage(owner, { limit: 100 })).items;
  }

  async listPage(owner: Owner, raw: { cursor?: string | undefined; limit?: number | undefined } = {}) {
    const page = LearningInboxPageSchema.parse(raw);
    return inTransaction(this.database, async transaction => {
      await sql`UPDATE candidate_learning_inbox SET payload = NULL WHERE account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId} AND expires_at <= now() AND payload IS NOT NULL`.execute(transaction);
      if (page.cursor) {
        const cursor = await sql`SELECT id FROM candidate_learning_inbox WHERE id = ${page.cursor} AND account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId}`.execute(transaction);
        if (!cursor.rows.length) throw new NotFoundError("Note page not found.");
      }
      const before = page.cursor ? sql`AND (created_at,id) < (SELECT created_at,id FROM candidate_learning_inbox WHERE id = ${page.cursor} AND account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId})` : sql``;
      const result = await sql<{ id: string; status: string; expires_at: Date; payload: StoredPayload | null; confirmed: boolean }>`SELECT id,status,expires_at,
      EXISTS(SELECT 1 FROM candidate_learning_note_confirmations confirmation WHERE confirmation.item_id = candidate_learning_inbox.id) AS confirmed,
      CASE WHEN status = 'PENDING' AND expires_at > now() THEN payload ELSE NULL END AS payload
      FROM candidate_learning_inbox WHERE account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId} ${before} ORDER BY created_at DESC,id DESC LIMIT ${page.limit + 1}`.execute(transaction);
      const items = result.rows.slice(0, page.limit).map((row) => {
        if (!row.payload) return { itemId: row.id, status: row.status === "DELETED" ? "DELETED" : "EXPIRED", expiresAt: row.expires_at, evidence: null };
        try {
          const stored = row.payload;
          const decoded = this.cipher.decrypt({ keyVersion: stored.keyVersion, initializationVector: Buffer.from(stored.initializationVector,"base64"), authenticationTag: Buffer.from(stored.authenticationTag,"base64"), ciphertext: Buffer.from(stored.ciphertext,"base64") });
          if (decoded.kind !== "STRING") throw new Error("Invalid payload kind.");
          const evidence:unknown=JSON.parse(decoded.value);
          if(!evidence||typeof evidence!=="object"||Array.isArray(evidence)||Object.keys(evidence).sort().join(",")!=="answer,question,source")throw new Error("Invalid payload shape.");
          const checked=LearningInboxCaptureSchema.parse({...evidence,schemaVersion:1,itemId:row.id,applicationId:row.id,applicationRunId:row.id});
          return { itemId: row.id, status: row.confirmed ? "CONFIRMED" : "PENDING", expiresAt: row.expires_at, evidence: {question:checked.question,answer:checked.answer,source:checked.source} };
        }catch{throw new Error("Private note cannot be read.");}
      });
      return { items, nextCursor: result.rows.length > page.limit ? items.at(-1)!.itemId : null };
    });
  }

  async remove(owner: Owner, itemId: string) {
    const result = await sql`UPDATE candidate_learning_inbox SET status = 'DELETED',payload = NULL WHERE id = ${itemId} AND account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId} RETURNING id`.execute(this.database);
    if (!result.rows.length) throw new NotFoundError("Pending answer not found.");
    return { itemId, status: "DELETED" as const };
  }

  async recordOutcome(owner: Owner, raw: AutofillOutcome) {
    const event = AutofillOutcomeSchema.parse(raw);
    const fingerprint = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    return inTransaction(this.database, async (transaction) => {
      await this.authorize(transaction, owner, event.applicationId, event.applicationRunId);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`outcomes:${event.applicationRunId}`})::bigint)`.execute(transaction);
      const previous = await sql<{ fingerprint: string }>`SELECT fingerprint FROM autofill_outcome_events WHERE id = ${event.eventId} AND account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId}`.execute(transaction);
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== fingerprint) throw new IdempotencyConflictError("Outcome identity was reused with different evidence.");
        return { eventId: event.eventId, idempotentReplay: true };
      }
      const count = await sql<{ count: number }>`SELECT count(*)::int AS count FROM autofill_outcome_events WHERE run_id = ${event.applicationRunId}`.execute(transaction);
      if ((count.rows[0]?.count ?? 0) >= 1000) throw new ConflictError("Outcome limit reached for this run.");
      await sql`INSERT INTO autofill_outcome_events(id,account_id,candidate_id,application_id,run_id,question_id,stage,code,release,fingerprint)
        VALUES(${event.eventId},${owner.accountId},${owner.candidateId},${event.applicationId},${event.applicationRunId},${event.questionId},${event.stage},${event.code},${event.release},${fingerprint})`.execute(transaction);
      return { eventId: event.eventId, idempotentReplay: false };
    });
  }

  async outcomes(owner: Owner) {
    const result = await sql<{ stage: string; code: string; release: string; events: number; affected_runs: number; affected_questions: number }>`
      SELECT stage,code,release,count(*)::int AS events,count(DISTINCT run_id)::int AS affected_runs,
      count(DISTINCT (run_id,question_id)) FILTER (WHERE question_id IS NOT NULL)::int AS affected_questions
      FROM autofill_outcome_events WHERE account_id = ${owner.accountId} AND candidate_id = ${owner.candidateId}
      GROUP BY stage,code,release ORDER BY affected_runs DESC,stage,code LIMIT 100`.execute(this.database);
    return { groups: result.rows, denominator: "REPORTED_FAILURES_ONLY" as const };
  }
}
