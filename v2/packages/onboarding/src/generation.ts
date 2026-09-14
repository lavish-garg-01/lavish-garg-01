import { createHash, randomUUID } from "node:crypto";
import type { CandidateProfileAnswer } from "./profile.js";
import type { CandidateDocument, DocumentPurpose } from "./documents.js";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { ConflictError, NotFoundError, ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import type { ObjectStoragePort } from "./resume.js";

export const DOCUMENT_GENERATION_POLICY_VERSION = 1 as const;
export type GenerationStrength = "LIGHT" | "FOCUSED";
export interface GenerationClaim {
  sourceId: string;
  sourceType: "CANDIDATE_TRUTH" | "JOB_INTELLIGENCE";
  canonicalKey: string;
  text: string;
}
export interface GeneratedDocumentBlock {
  kind: "HEADING" | "PARAGRAPH" | "BULLET";
  text: string;
  sourceClaimIds: readonly string[];
}
export interface GeneratedDocumentDraft {
  title: string;
  titleSourceClaimIds: readonly string[];
  blocks: readonly GeneratedDocumentBlock[];
}
export interface DocumentGenerationContext {
  sourceDocumentId: string;
  jobId: string;
  applicationId: string | null;
  candidateClaims: readonly GenerationClaim[];
  jobClaims: readonly GenerationClaim[];
}
export interface DocumentGenerationContextPort {
  load(input: { accountId: string; candidateId: string; jobId: string; applicationId: string | null }): Promise<DocumentGenerationContext>;
}
export interface GeneratedDocumentPort {
  generate(input: DocumentGenerationContext & {
    accountId: string;
    candidateId: string;
    purpose: "TAILORED_RESUME" | "COVER_LETTER";
    strength: GenerationStrength;
  }): Promise<GeneratedDocumentDraft>;
}
export interface DocumentGenerationRepository {
  editableSource?(input: { accountId: string; candidateId: string; documentId: string }): Promise<{ objectKey: string; jobId: string; applicationId: string | null; purpose: "TAILORED_RESUME" | "COVER_LETTER" } | null>;
  begin(input: {
    runId: string; accountId: string; candidateId: string; sourceDocumentId: string;
    jobId: string; applicationId: string | null; purpose: "TAILORED_RESUME" | "COVER_LETTER";
    generator: string; generatorVersion: string; generationPolicyVersion: number;
    idempotencyKey: string; requestFingerprint: string; createdAt: Date;
  }): Promise<{ runId: string; idempotentReplay: boolean; document: CandidateDocument | null }>;
  complete(input: {
    runId: string; documentId: string; accountId: string; candidateId: string;
    objectKey: string; fileName: string; contentSha256: string; byteSize: number;
    claimManifest: readonly string[]; completedAt: Date;
  }): Promise<CandidateDocument>;
  fail(input: { runId: string; accountId: string; candidateId: string; errorCode: string; failedAt: Date }): Promise<void>;
  approve(input: {
    accountId: string; candidateId: string; documentId: string; idempotencyKey: string;
    requestFingerprint: string; receiptId: string; approvedAt: Date;
  }): Promise<{ document: CandidateDocument; idempotentReplay: boolean }>;
}

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const SafeClaimSchema = z.object({
  sourceId: z.string().regex(/^(?:truth:[0-9a-f-]{36}|job:[a-z0-9-]{2,80})$/),
  sourceType: z.enum(["CANDIDATE_TRUTH", "JOB_INTELLIGENCE"]),
  canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(140),
  text: z.string().trim().min(1).max(8_000)
}).strict();
const DraftSchema = z.object({
  title: z.string().trim().min(1).max(240),
  titleSourceClaimIds: z.array(z.string()).min(1).max(10),
  blocks: z.array(z.object({
    kind: z.enum(["HEADING", "PARAGRAPH", "BULLET"]), text: z.string().trim().min(1).max(2_000),
    sourceClaimIds: z.array(z.string()).min(1).max(20)
  }).strict()).min(1).max(200)
}).strict();

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function significantWords(text: string): Set<string> {
  return new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}+#.]+/u)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length >= 4));
}

const neutralPresentationWords = new Set([
  "application", "applying", "candidate", "company", "consideration", "cover", "dear",
  "education", "experience", "hiring", "interest", "interested", "letter", "manager",
  "opportunity", "position", "professional", "projects", "relevant", "resume", "role",
  "selected", "sincerely", "skills", "summary", "team", "technical", "thank", "certifications", "contact", "languages"
]);

export function validateGroundedDraft(
  draft: GeneratedDocumentDraft,
  context: DocumentGenerationContext,
  purpose: "TAILORED_RESUME" | "COVER_LETTER" = "TAILORED_RESUME"
): GeneratedDocumentDraft {
  const parsed = DraftSchema.parse(draft);
  const claims = new Map([...context.candidateClaims, ...context.jobClaims].map((claim) => [claim.sourceId, SafeClaimSchema.parse(claim)]));
  const candidateText = context.candidateClaims.map((claim) => claim.text).join(" ").toLocaleLowerCase();
  const unsupportedJobSkills = context.jobClaims
    .filter((claim) => ["REQUIRED_SKILL", "PREFERRED_SKILL"].includes(claim.canonicalKey))
    .filter((claim) => !candidateText.includes(claim.text.toLocaleLowerCase()));
  const validateText = (text: string, sourceIds: readonly string[], genericHeading = false) => {
    if (new Set(sourceIds).size !== sourceIds.length || sourceIds.some((id) => !claims.has(id))) {
      throw new ValidationError("Generated document cited an unknown source.", { reasonCode: "DOCUMENT_GENERATION_UNGROUNDED" });
    }
    const citedClaims = sourceIds.map((id) => claims.get(id)?.text ?? "");
    const cited = citedClaims.join(" ");
    const normalizeExact = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    // Exact cited claims remain grounded even when they are short values or
    // acronyms (for example "Yes", "AWS", "C++"). The word-overlap heuristic
    // below intentionally ignores such tokens and previously rejected the
    // deterministic fallback used for real candidate profiles.
    const exactCitedClaim = citedClaims.some((claim) => normalizeExact(claim) === normalizeExact(text));
    const citedWords = significantWords(cited);
    const factualWords = [...significantWords(text)].filter((word) => !neutralPresentationWords.has(word));
    const citedNumbers = new Set(cited.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []);
    if ((text.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? []).some((number) => !citedNumbers.has(number))) {
      throw new ValidationError("Generated document introduced an unsupported number.", { reasonCode: "DOCUMENT_GENERATION_UNGROUNDED" });
    }
    if (unsupportedJobSkills.some((skill) => text.toLocaleLowerCase().includes(skill.text.toLocaleLowerCase()))) {
      throw new ValidationError("Generated document introduced an unsupported skill.", { reasonCode: "DOCUMENT_GENERATION_UNGROUNDED" });
    }
    if (!exactCitedClaim && ((!genericHeading && factualWords.length === 0) || factualWords.some((word) => !citedWords.has(word)))) {
      throw new ValidationError("Generated document text was not supported by its cited sources.", { reasonCode: "DOCUMENT_GENERATION_UNGROUNDED" });
    }
  };
  validateText(parsed.title, parsed.titleSourceClaimIds);
  for (const block of parsed.blocks) {
    validateText(block.text, block.sourceClaimIds, block.kind === "HEADING");
    if (purpose === "TAILORED_RESUME" && block.kind !== "HEADING"
      && !block.sourceClaimIds.some((id) => claims.get(id)?.sourceType === "CANDIDATE_TRUTH")) {
      throw new ValidationError("A tailored resume body claim must be grounded in Candidate Truth.", { reasonCode: "DOCUMENT_GENERATION_UNGROUNDED" });
    }
  }
  return parsed;
}

function escapePdf(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text: string, width = 92): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").flatMap((word) => word.match(new RegExp(`.{1,${width}}`, "g")) ?? []);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Small deterministic PDF renderer; it embeds no remote assets or active content. */
export function renderGeneratedPdf(draft: GeneratedDocumentDraft, template: "CLASSIC" | "COMPACT" = "CLASSIC"): Uint8Array {
  const lines = [draft.title, "", ...draft.blocks.flatMap((block) =>
    wrap(`${block.kind === "BULLET" ? "- " : ""}${block.text}`, template === "COMPACT" ? 86 : 75)
  )];
  const pageSize = template === "COMPACT" ? 58 : 48;
  const pages = Array.from({ length: Math.ceil(lines.length / pageSize) }, (_, index) => lines.slice(index * pageSize, (index + 1) * pageSize));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  for (const [pageIndex, pageLines] of pages.entries()) {
    const stream = ["BT", `/F1 ${template === "COMPACT" ? 10 : 11} Tf`, "54 750 Td", `${template === "COMPACT" ? 12 : 14} TL`, ...pageLines.flatMap((line, index) => [
      ...(index ? ["T*"] : []), `(${escapePdf(line)}) Tj`
    ]), "ET"].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + pageIndex * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

function safeGeneratedFileName(purpose: DocumentPurpose, versionHint: string): string {
  const prefix = purpose === "TAILORED_RESUME" ? "tailored-resume" : "cover-letter";
  return `${prefix}-${versionHint.replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 40)}.pdf`;
}

export class DocumentGenerationService {
  constructor(
    private readonly repository: DocumentGenerationRepository,
    private readonly contexts: DocumentGenerationContextPort,
    private readonly generator: GeneratedDocumentPort,
    private readonly storage: ObjectStoragePort,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async generate(input: {
    accountId: string; candidateId: string; jobId: string; applicationId?: string | null;
    purpose: "TAILORED_RESUME" | "COVER_LETTER"; strength?: GenerationStrength; template?: "CLASSIC" | "COMPACT"; idempotencyKey: string;
    editedDraft?: GeneratedDocumentDraft;
  }): Promise<CandidateDocument> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const jobId = UuidSchema.parse(input.jobId);
    const applicationId = input.applicationId ? UuidSchema.parse(input.applicationId) : null;
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const purpose = z.enum(["TAILORED_RESUME", "COVER_LETTER"]).parse(input.purpose);
    const strength = z.enum(["LIGHT", "FOCUSED"]).parse(input.strength ?? "LIGHT");
    const template = z.enum(["CLASSIC", "COMPACT"]).parse(input.template ?? "CLASSIC");
    const context = await this.contexts.load({ accountId, candidateId, jobId, applicationId });
    if (context.jobId !== jobId || context.applicationId !== applicationId) throw new ConflictError("Document generation context changed.");
    const requestFingerprint = fingerprint({
      candidateId, jobId, applicationId, purpose, strength, template, editedDraft: input.editedDraft ?? null, sourceDocumentId: context.sourceDocumentId,
      claims: [...context.candidateClaims, ...context.jobClaims].map((claim) => [claim.sourceId, fingerprint(claim.text)])
    });
    const runId = this.newId();
    const begun = await this.repository.begin({
      runId, accountId, candidateId, sourceDocumentId: context.sourceDocumentId, jobId,
      applicationId, purpose, generator: "PHASE_P", generatorVersion: "1",
      generationPolicyVersion: DOCUMENT_GENERATION_POLICY_VERSION,
      idempotencyKey, requestFingerprint, createdAt: this.clock.now()
    });
    if (begun.idempotentReplay) {
      if (!begun.document) throw new ConflictError("Document generation is still processing.");
      return begun.document;
    }
    let objectKey: string | null = null;
    try {
      const draft = validateGroundedDraft(input.editedDraft ?? await this.generator.generate({
        ...context, accountId, candidateId, purpose, strength
      }), context, purpose);
      const bytes = renderGeneratedPdf(draft, template);
      const contentSha256 = createHash("sha256").update(bytes).digest("hex");
      const documentId = this.newId();
      objectKey = `accounts/${accountId}/candidates/${candidateId}/generated/${runId}-${contentSha256.slice(0, 16)}.pdf`;
      await this.storage.put({ objectKey, bytes, contentType: "application/pdf" });
      await this.storage.put({ objectKey: `${objectKey}.draft.json`, bytes: Buffer.from(JSON.stringify(draft)), contentType: "application/json" });
      return await this.repository.complete({
        runId, documentId, accountId, candidateId, objectKey,
        fileName: safeGeneratedFileName(purpose, jobId.slice(0, 8)), contentSha256,
        byteSize: bytes.byteLength,
        claimManifest: [...new Set([...draft.titleSourceClaimIds, ...draft.blocks.flatMap((block) => block.sourceClaimIds)])],
        completedAt: this.clock.now()
      });
    } catch (error) {
      if (objectKey) await this.storage.delete(objectKey).catch(() => undefined);
      if (objectKey) await this.storage.delete(`${objectKey}.draft.json`).catch(() => undefined);
      await this.repository.fail({ runId, accountId, candidateId, errorCode: "DOCUMENT_GENERATION_FAILED", failedAt: this.clock.now() });
      throw error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError
        ? error
        : new ValidationError("The document could not be generated safely.", { reasonCode: "DOCUMENT_GENERATION_FAILED" });
    }
  }

  async editable(input: { accountId: string; candidateId: string; documentId: string }): Promise<GeneratedDocumentDraft> {
    const source = await this.repository.editableSource?.({ accountId: UuidSchema.parse(input.accountId), candidateId: UuidSchema.parse(input.candidateId), documentId: UuidSchema.parse(input.documentId) });
    if (!source) throw new NotFoundError("Editable document was not found for this candidate.");
    try { return DraftSchema.parse(JSON.parse(Buffer.from(await this.storage.get(`${source.objectKey}.draft.json`)).toString("utf8"))); }
    catch { throw new ValidationError("This older document has no editable draft. Generate a new version first."); }
  }

  async revise(input: { accountId: string; candidateId: string; documentId: string; draft: GeneratedDocumentDraft; template?: "CLASSIC" | "COMPACT"; idempotencyKey: string }) {
    const source = await this.repository.editableSource?.({ accountId: UuidSchema.parse(input.accountId), candidateId: UuidSchema.parse(input.candidateId), documentId: UuidSchema.parse(input.documentId) });
    if (!source) throw new NotFoundError("Editable document was not found for this candidate.");
    const parsed = DraftSchema.safeParse(input.draft);
    if (!parsed.success) throw new ValidationError("The draft contains missing or invalid sections.");
    // Immutable revision, fresh source validation and a separate approval. A
    // submitted/approved PDF is never changed by editing its draft.
    return this.generate({ ...input, jobId: source.jobId, applicationId: source.applicationId,
      purpose: source.purpose, editedDraft: parsed.data });
  }

  async approve(input: { accountId: string; candidateId: string; documentId: string; idempotencyKey: string }) {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const documentId = UuidSchema.parse(input.documentId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    return this.repository.approve({
      accountId, candidateId, documentId, idempotencyKey,
      requestFingerprint: fingerprint({ candidateId, documentId }),
      receiptId: this.newId(), approvedAt: this.clock.now()
    });
  }
}

export function generationClaimFromProfile(answer: CandidateProfileAnswer, text: string): GenerationClaim {
  return SafeClaimSchema.parse({
    sourceId: `truth:${answer.answerVersionId}`, sourceType: "CANDIDATE_TRUTH",
    canonicalKey: answer.canonicalKey, text
  });
}

export class DeterministicGeneratedDocumentPort implements GeneratedDocumentPort {
  async generate(input: DocumentGenerationContext & {
    accountId: string; candidateId: string; purpose: "TAILORED_RESUME" | "COVER_LETTER";
  }): Promise<GeneratedDocumentDraft> {
    const name = input.candidateClaims.find((claim) => claim.canonicalKey === "FULL_NAME") ?? input.candidateClaims[0];
    if (!name) throw new ValidationError("Add verified profile details before generating a document.");
    const jobTitle = input.jobClaims.find((claim) => claim.canonicalKey === "JOB_TITLE") ?? input.jobClaims[0];
    const company = input.jobClaims.find((claim) => claim.canonicalKey === "COMPANY_NAME") ?? input.jobClaims[1] ?? jobTitle;
    if (!jobTitle || !company) throw new ValidationError("Job details are incomplete.");
    if (input.purpose === "COVER_LETTER") {
      return {
        title: `Application for ${jobTitle.text} at ${company.text}`,
        titleSourceClaimIds: [jobTitle.sourceId, company.sourceId],
        blocks: [
          { kind: "PARAGRAPH", text: `I am interested in the ${jobTitle.text} opportunity at ${company.text}.`, sourceClaimIds: [jobTitle.sourceId, company.sourceId] },
          ...input.candidateClaims.filter((claim) => !["EMAIL", "PHONE", "RESUME"].includes(claim.canonicalKey)).slice(0, 6)
            .map((claim) => ({ kind: "PARAGRAPH" as const, text: claim.text, sourceClaimIds: [claim.sourceId] })),
          { kind: "PARAGRAPH", text: `Sincerely, ${name.text}`, sourceClaimIds: [name.sourceId] }
        ]
      };
    }
    const relevantSkills = input.jobClaims.filter((claim) => ["REQUIRED_SKILL", "PREFERRED_SKILL"].includes(claim.canonicalKey));
    const ordered = [...input.candidateClaims].sort((left, right) => {
      const leftRelevant = relevantSkills.some((skill) => left.text.toLocaleLowerCase().includes(skill.text.toLocaleLowerCase()));
      const rightRelevant = relevantSkills.some((skill) => right.text.toLocaleLowerCase().includes(skill.text.toLocaleLowerCase()));
      return Number(rightRelevant) - Number(leftRelevant);
    });
    return {
      title: name.text,
      titleSourceClaimIds: [name.sourceId],
      blocks: ordered.filter((claim) => claim.canonicalKey !== "RESUME")
        .map((claim) => ({ kind: "BULLET" as const, text: claim.text, sourceClaimIds: [claim.sourceId] }))
    };
  }
}
