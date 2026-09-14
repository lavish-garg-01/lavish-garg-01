import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  PersistableNormalizedValueSchema,
  candidateAnswerPolicy,
  canonicalDefinition,
  type CandidateValueFingerprinter,
  type EntityType,
  type PersistableNormalizedValue
} from "@job-hunter-v2/candidate-truth";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { ConflictError, NotFoundError, ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";

export const MASTER_RESUME_MAX_BYTES = 10 * 1024 * 1024;
export const MASTER_RESUME_MIME = "application/pdf" as const;

export type ResumeExtractionStatus = "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
export type DocumentLifecycleStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "EXTRACTING"
  | "EXTRACTED"
  | "RECONCILING"
  | "READY"
  | "FAILED"
  | "SUPERSEDED"
  | "ARCHIVED"
  | "QUARANTINED"
  | "DELETED";
export type ResumeProposalComparison =
  | "NEW"
  | "MATCH"
  | "CONFLICT"
  | "AMBIGUOUS"
  | "REPEATABLE_ENTITY_MATCH"
  | "REPEATABLE_ENTITY_NEW"
  | "UNSUPPORTED";
export type ResumeProposalDecision =
  | "PENDING"
  | "ACCEPTED"
  | "CORRECTED"
  | "REMOVED"
  | "SKIPPED";
export const RESUME_EXTRACTION_SCHEMA_VERSION = 2 as const;
export const RESUME_SOURCE_SECTIONS = [
  "HEADER", "SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION",
  "PROJECTS", "CERTIFICATIONS", "AWARDS", "OTHER", "UPLOAD"
] as const;
export type ResumeSourceSection = (typeof RESUME_SOURCE_SECTIONS)[number];

export interface ResumeDocument {
  documentId: string;
  accountId: string;
  candidateId: string;
  objectKey: string;
  originalFileName: string;
  contentSha256: string;
  byteSize: number;
  mimeType: typeof MASTER_RESUME_MIME;
  purpose: "MASTER_RESUME";
  status: DocumentLifecycleStatus;
  documentVersion: number;
  sourceDocumentId: string | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  readyAt: Date | null;
}

export interface ResumeExtraction {
  extractionId: string;
  documentId: string;
  status: ResumeExtractionStatus;
  attempt: number;
  extractor: string;
  extractorVersion: string;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
  idempotentReplay: boolean;
}

export interface ResumeRegistration {
  document: ResumeDocument;
  retiredObjectKey: string | null;
}

export interface ResumeProposal {
  proposalId: string;
  extractionId: string;
  itemKey: string;
  canonicalKey: string;
  entityType: EntityType | null;
  entityGroupKey: string | null;
  normalizedValue: PersistableNormalizedValue;
  confidence: number;
  comparison: ResumeProposalComparison;
  decision: ResumeProposalDecision;
  existingAnswerVersionId: string | null;
  matchedEntityId: string | null;
  reasonCodes: readonly string[];
  sourceSection: ResumeSourceSection;
  evidenceSha256: string;
  extractionSchemaVersion: number;
}

export interface ResumeReview {
  document: ResumeDocument;
  extraction: ResumeExtraction | null;
  proposals: readonly ResumeProposal[];
}

export interface ObjectStoragePort {
  put(input: { objectKey: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  get(objectKey: string): Promise<Uint8Array>;
  delete(objectKey: string): Promise<void>;
}

export interface ResumeTextExtractor {
  readonly name: string;
  readonly version: string;
  extract(bytes: Uint8Array): Promise<string>;
}

export interface ExtractedResumeProposal {
  itemKey: string;
  canonicalKey: string;
  entityType: EntityType | null;
  entityGroupKey: string | null;
  normalizedValue: PersistableNormalizedValue;
  confidence: number;
  reasonCodes: readonly string[];
  sourceSection: ResumeSourceSection;
  sourceEvidence: string;
}

function comparableText(value: PersistableNormalizedValue): string | null {
  if (value.kind !== "STRING" && value.kind !== "URL") return null;
  return value.value.toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? shared / union : 0;
}

/** Conservative, presentation-insensitive equality used only to bind a resume
 * group to an existing repeatable entity. The repository still requires two
 * independent matching anchors before it accepts a match. */
export function resumeEntityAnchorMatches(
  canonicalKey: string,
  extracted: PersistableNormalizedValue,
  existing: PersistableNormalizedValue
): boolean {
  if (JSON.stringify(extracted) === JSON.stringify(existing)) return true;
  const left = comparableText(extracted);
  const right = comparableText(existing);
  if (!left || !right) return false;
  if (left === right) return true;
  if (["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE", "EDUCATION_INSTITUTION"].includes(canonicalKey)) {
    if (Math.min(left.length, right.length) >= 4 && (` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `))) return true;
    const rightTokens = new Set(right.split(" ").filter(Boolean));
    const sharedTokens = left.split(" ").filter((token) => rightTokens.has(token)).length;
    return sharedTokens >= 2 && tokenSimilarity(left, right) >= 0.6;
  }
  return false;
}

export interface ResumeCandidateExtractor {
  extract(text: string, context?: { accountId: string; candidateId: string; documentId: string; extractionId: string }): Promise<readonly ExtractedResumeProposal[]>;
}

export interface EncryptedCandidatePayload {
  keyVersion: number;
  initializationVector: Uint8Array;
  authenticationTag: Uint8Array;
  ciphertext: Uint8Array;
}

export interface CandidatePayloadCipher {
  encrypt(value: PersistableNormalizedValue): EncryptedCandidatePayload;
  decrypt(payload: EncryptedCandidatePayload): PersistableNormalizedValue;
}

export interface ResumeRepository {
  registerResume(input: {
    documentId: string;
    accountId: string;
    candidateId: string;
    objectKey: string;
    originalFileName: string;
    contentSha256: string;
    byteSize: number;
    mimeType: typeof MASTER_RESUME_MIME;
    idempotencyKey: string;
    requestFingerprint: string;
    createdAt: Date;
  }): Promise<ResumeRegistration>;
  beginExtraction(input: {
    extractionId: string;
    accountId: string;
    candidateId: string;
    documentId: string;
    extractor: string;
    extractorVersion: string;
    idempotencyKey: string;
    requestFingerprint: string;
    startedAt: Date;
  }): Promise<ResumeExtraction>;
  completeExtraction(input: {
    accountId: string;
    candidateId: string;
    extractionId: string;
    textSha256: string;
    proposals: readonly {
      proposalId: string;
      itemKey: string;
      canonicalKey: string;
      entityType: EntityType | null;
      entityGroupKey: string | null;
      confidence: number;
      reasonCodes: readonly string[];
      sourceSection: ResumeSourceSection;
      evidenceSha256: string;
      extractionSchemaVersion: number;
      /** Transient comparison input; never stored in the proposal table. */
      entityMatchValue: PersistableNormalizedValue | null;
      valueFingerprint: string;
      fingerprintKeyVersion: number;
      encryptedPayload: EncryptedCandidatePayload;
    }[];
    invalidItemCount: number;
    completedAt: Date;
  }): Promise<void>;
  failExtraction(input: {
    accountId: string;
    candidateId: string;
    extractionId: string;
    errorCode: string;
    failedAt: Date;
  }): Promise<void>;
  getReview(input: {
    accountId: string;
    candidateId: string;
    documentId?: string;
  }): Promise<{
    document: ResumeDocument;
    extraction: ResumeExtraction | null;
    proposals: readonly (Omit<ResumeProposal, "normalizedValue"> & {
      encryptedPayload: EncryptedCandidatePayload;
    })[];
  }>;
}

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const SafeFileNameSchema = z.string().trim().min(1).max(240).refine(
  (value) => !/[\\/\0]/.test(value) && value.toLowerCase().endsWith(".pdf"),
  "A PDF file name without path characters is required."
);

function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function validateMasterResume(input: {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): { fileName: string; contentSha256: string } {
  const fileName = SafeFileNameSchema.parse(input.fileName);
  if (input.mimeType.toLowerCase() !== MASTER_RESUME_MIME) {
    throw new ValidationError("Only PDF resumes are supported.", { reasonCode: "RESUME_MIME_INVALID" });
  }
  if (input.bytes.byteLength < 8 || input.bytes.byteLength > MASTER_RESUME_MAX_BYTES) {
    throw new ValidationError("The resume must be a non-empty PDF no larger than 10 MB.", {
      reasonCode: "RESUME_SIZE_INVALID",
      maximumBytes: MASTER_RESUME_MAX_BYTES
    });
  }
  const header = Buffer.from(input.bytes.subarray(0, 5)).toString("ascii");
  const tail = Buffer.from(input.bytes.subarray(Math.max(0, input.bytes.byteLength - 2_048))).toString("latin1");
  if (header !== "%PDF-" || !tail.includes("%%EOF")) {
    throw new ValidationError("The uploaded file is not a complete PDF.", {
      reasonCode: "RESUME_PDF_SIGNATURE_INVALID"
    });
  }
  return {
    fileName,
    contentSha256: createHash("sha256").update(input.bytes).digest("hex")
  };
}

export class AesGcmCandidatePayloadCipher implements CandidatePayloadCipher {
  private readonly key: Buffer;

  constructor(key: Uint8Array, private readonly keyVersion = 1) {
    this.key = Buffer.from(key);
    if (this.key.byteLength !== 32) throw new Error("Candidate payload encryption key must contain 32 bytes.");
  }

  encrypt(value: PersistableNormalizedValue): EncryptedCandidatePayload {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, initializationVector);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(PersistableNormalizedValueSchema.parse(value)), "utf8"),
      cipher.final()
    ]);
    return {
      keyVersion: this.keyVersion,
      initializationVector,
      authenticationTag: cipher.getAuthTag(),
      ciphertext
    };
  }

  decrypt(payload: EncryptedCandidatePayload): PersistableNormalizedValue {
    if (payload.keyVersion !== this.keyVersion) throw new Error("Candidate payload encryption key version is unavailable.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, payload.initializationVector);
    decipher.setAuthTag(payload.authenticationTag);
    const cleartext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
    return PersistableNormalizedValueSchema.parse(JSON.parse(cleartext));
  }
}

export class FileSystemObjectStorage implements ObjectStoragePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(objectKey: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(objectKey)) throw new ValidationError("Object key is invalid.");
    const path = resolve(this.root, objectKey);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) throw new ValidationError("Object key escapes storage root.");
    return path;
  }

  async put(input: { objectKey: string; bytes: Uint8Array }): Promise<void> {
    const target = this.path(input.objectKey);
    const temporary = `${target}.${randomUUID()}.upload`;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(temporary, input.bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  }

  async get(objectKey: string): Promise<Uint8Array> {
    try {
      return await readFile(this.path(objectKey));
    } catch {
      throw new NotFoundError("Resume object was not found.");
    }
  }

  async delete(objectKey: string): Promise<void> {
    await unlink(this.path(objectKey)).catch(() => undefined);
  }
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const linkedInPattern = /\b(?:(?:https?:\/\/)?(?:www\.)?)linkedin\.com\/in\/[A-Za-z0-9_%/-]+/i;
const githubPattern = /\b(?:(?:https?:\/\/)?(?:www\.)?)github\.com\/[A-Za-z0-9_.-]+/i;
const phonePattern = /(?:\+?91[\s-]?)?([6-9]\d{9})\b/;
const knownSkills = [
  "JavaScript", "TypeScript", "Node.js", "React", "Next.js", "Python", "Java", "Kotlin",
  "Go", "Rust", "PostgreSQL", "MySQL", "MongoDB", "Redis", "AWS", "GCP", "Azure",
  "Docker", "Kubernetes", "GraphQL", "Spring Boot", "Android", "iOS", "PHP", "Express.js",
  "Yii2", "Laravel", "Microservices", "ClickHouse", "REST", "WebSocket", "WebRTC", "RTMP",
  "HLS", "CloudFront", "GitHub Actions", "SQL", "Nginx", "FFmpeg", "Data Structures",
  "Algorithms", "OOP", "Operating Systems"
] as const;

const sectionHeadings = new Map<string, "SUMMARY" | "SKILLS" | "EXPERIENCE" | "EDUCATION">([
  ["SUMMARY", "SUMMARY"], ["PROFILE", "SUMMARY"], ["PROFESSIONALSUMMARY", "SUMMARY"],
  ["SKILLS", "SKILLS"], ["TECHNICALSKILLS", "SKILLS"], ["KEYSKILLS", "SKILLS"],
  ["CORECOMPETENCIES", "SKILLS"], ["TECHNOLOGIES", "SKILLS"], ["TECHNOLOGYSTACK", "SKILLS"],
  ["TECHSTACK", "SKILLS"],
  ["EXPERIENCE", "EXPERIENCE"], ["WORKEXPERIENCE", "EXPERIENCE"],
  ["PROFESSIONALEXPERIENCE", "EXPERIENCE"], ["EMPLOYMENT", "EXPERIENCE"],
  ["EDUCATION", "EDUCATION"], ["ACADEMICBACKGROUND", "EDUCATION"]
]);
const monthNumber = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9], ["oct", 10],
  ["october", 10], ["nov", 11], ["november", 11], ["dec", 12], ["december", 12]
]);
const monthToken = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const datedRangePattern = new RegExp(`\\b(${monthToken})\\s+(\\d{4})\\s*(?:[-–—]|to)\\s*(?:(${monthToken})\\s+(\\d{4})|(present|current|now))\\b`, "i");
const yearRangePattern = /\b((?:19|20)\d{2})\s*(?:[-–—]|to)\s*((?:19|20)\d{2}|present|current|now)\b/i;

type ResumeSection = "SUMMARY" | "SKILLS" | "EXPERIENCE" | "EDUCATION";
type ResumeDateRange = Extract<PersistableNormalizedValue, { kind: "DATE_RANGE" }>;

function heading(line: string): ResumeSection | null {
  const compact = line.replace(/[^A-Za-z]/g, "").toUpperCase();
  return sectionHeadings.get(compact) ?? null;
}

function section(lines: readonly string[], requested: ResumeSection): string[] {
  const start = lines.findIndex((line) => heading(line) === requested);
  if (start < 0) return [];
  const endOffset = lines.slice(start + 1).findIndex((line) => heading(line) !== null);
  return lines.slice(start + 1, endOffset < 0 ? lines.length : start + 1 + endOffset);
}

function splitTopLevelList(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }
  items.push(value.slice(start));
  return items.map((item) => item.trim()).filter(Boolean);
}

function skillKey(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#.]+/g, "-").replace(/^-|-$/g, "");
}

function explicitSkills(skillsSection: readonly string[], fallbackText: string): string[] {
  const evidence = skillsSection.join("\n") || fallbackText;
  const sectionValues = skillsSection.flatMap((line) => {
    const separator = line.indexOf(":");
    const content = separator >= 0 ? line.slice(separator + 1) : line;
    return splitTopLevelList(content).flatMap((item) => {
      const parenthetical = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(item);
      if (!parenthetical) return [item];
      const base = parenthetical[1]?.trim() ?? "";
      const nested = (parenthetical[2] ?? "").split(/[,/]/).map((value) => value.trim()).filter(Boolean);
      return [base, ...nested].filter(Boolean);
    });
  });
  const known = knownSkills.filter((skill) => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(evidence);
  });
  return [...new Map([...sectionValues, ...known]
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter((value) => value.length >= 2 && value.length <= 120)
    .map((value) => [skillKey(value), value])).values()].slice(0, 100);
}

function normalizedUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function dateValue(month: number, year: number) {
  return { isoDate: `${year}-${String(month).padStart(2, "0")}-01`, precision: "MONTH" as const };
}

function parseDateRange(line: string): { range: ResumeDateRange; prefix: string } | null {
  const dated = datedRangePattern.exec(line);
  if (dated) {
    const startMonth = monthNumber.get((dated[1] ?? "").toLowerCase());
    const startYear = Number(dated[2]);
    if (!startMonth || !Number.isInteger(startYear)) return null;
    const current = Boolean(dated[5]);
    const endMonth = current ? null : monthNumber.get((dated[3] ?? "").toLowerCase()) ?? null;
    const endYear = current ? null : Number(dated[4]);
    if (!current && (!endMonth || !Number.isInteger(endYear))) return null;
    const start = dateValue(startMonth, startYear);
    const end = current ? null : dateValue(endMonth as number, endYear as number);
    if (end && start.isoDate > end.isoDate) return null;
    return {
      prefix: line.slice(0, dated.index).trim().replace(/[|·]+$/, "").trim(),
      range: {
        schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DATE_RANGE",
        start, end, current
      }
    };
  }
  const years = yearRangePattern.exec(line);
  if (!years) return null;
  const current = /present|current|now/i.test(years[2] ?? "");
  const startYear = Number(years[1]);
  const endYear = current ? null : Number(years[2]);
  if (!Number.isInteger(startYear) || (!current && !Number.isInteger(endYear))) return null;
  if (endYear !== null && startYear > endYear) return null;
  return {
    prefix: line.slice(0, years.index).trim().replace(/[|·]+$/, "").trim(),
    range: {
      schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DATE_RANGE",
      start: { isoDate: `${startYear}-01-01`, precision: "YEAR" },
      end: current ? null : { isoDate: `${endYear}-01-01`, precision: "YEAR" }, current
    }
  };
}

function isLikelyEntryHeader(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, "");
  return line.includes(",") && letters.length >= 4 && letters === letters.toUpperCase() && !/^[•●▪◦-]/.test(line);
}

function stringValue(value: string): PersistableNormalizedValue {
  return { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: value.trim() };
}

function richTextValue(value: string): PersistableNormalizedValue {
  return { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "RICH_TEXT", value: value.trim() };
}

function uniqueProfessionalMonths(ranges: readonly ResumeDateRange[], now: Date): number {
  const months = new Set<number>();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const range of ranges) {
    if (!range.start) continue;
    const [startYear, startMonth] = range.start.isoDate.split("-").map(Number);
    const start = (startYear as number) * 12 + (startMonth as number) - 1;
    // Resume month ranges are inclusive: Jan-Dec is 12 months, and a current
    // role includes the active calendar month.
    let end = currentMonth;
    if (range.end) {
      const [endYear, endMonth] = range.end.isoDate.split("-").map(Number);
      end = (endYear as number) * 12 + (endMonth as number) - 1;
    }
    if (start > end || end - start > 1_200) continue;
    for (let month = start; month <= end; month += 1) months.add(month);
  }
  return Math.min(months.size, 1_200);
}

function candidate(
  item: Omit<ExtractedResumeProposal, "reasonCodes" | "sourceSection" | "sourceEvidence">,
  sourceEvidence: string,
  sourceSection: ResumeSourceSection
): ExtractedResumeProposal {
  return { ...item, sourceEvidence, sourceSection, reasonCodes: ["DETERMINISTIC_RESUME_EXTRACTION"] };
}

export class DeterministicResumeCandidateExtractor implements ResumeCandidateExtractor {
  constructor(private readonly clock: Clock = systemClock) {}

  async extract(text: string): Promise<readonly ExtractedResumeProposal[]> {
    const normalizedText = text.replace(/\r/g, "").trim();
    if (!normalizedText) return [];
    const proposals: ExtractedResumeProposal[] = [];
    const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);
    const firstSection = lines.findIndex((line) => heading(line) !== null);
    const headerLines = lines.slice(0, firstSection < 0 ? Math.min(lines.length, 12) : firstSection);
    const name = headerLines.find((line) => /^[\p{L}][\p{L} .'-]{1,79}$/u.test(line)
      && line.split(/\s+/).length <= 5 && !heading(line));
    if (name) proposals.push(candidate({
      itemKey: "full-name", canonicalKey: "FULL_NAME", entityType: null, entityGroupKey: null,
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: name }, confidence: 0.72
    }, name, "HEADER"));
    const email = normalizedText.match(emailPattern)?.[0];
    if (email) proposals.push(candidate({
      itemKey: "email", canonicalKey: "EMAIL", entityType: null, entityGroupKey: null,
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: email.toLowerCase() }, confidence: 0.99
    }, email, "HEADER"));
    const phone = normalizedText.match(phonePattern)?.[1];
    if (phone) proposals.push(candidate({
      itemKey: "phone", canonicalKey: "PHONE", entityType: null, entityGroupKey: null,
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "PHONE", countryCode: "+91", nationalNumber: phone, extension: null }, confidence: 0.9
    }, phone, "HEADER"));
    const linkedIn = normalizedText.match(linkedInPattern)?.[0];
    if (linkedIn) proposals.push(candidate({
      itemKey: "linkedin", canonicalKey: "LINKEDIN_URL", entityType: null, entityGroupKey: null,
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "URL", value: normalizedUrl(linkedIn) }, confidence: 0.98
    }, linkedIn, "HEADER"));
    const github = normalizedText.match(githubPattern)?.[0];
    if (github) proposals.push(candidate({
      itemKey: "github", canonicalKey: "GITHUB_URL", entityType: null, entityGroupKey: null,
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "URL", value: normalizedUrl(github) }, confidence: 0.98
    }, github, "HEADER"));
    const summary = section(lines, "SUMMARY").join(" ").replace(/\s+/g, " ").trim();
    if (summary) proposals.push(candidate({
      itemKey: "personal-summary", canonicalKey: "PERSONAL_SUMMARY", entityType: null, entityGroupKey: null,
      normalizedValue: richTextValue(summary), confidence: 0.9
    }, section(lines, "SUMMARY").join("\n"), "SUMMARY"));
    const skillEvidence = section(lines, "SKILLS");
    // Only promote an explicitly labelled skills section into the global skill
    // inventory. Mentions inside work bullets remain scoped to that role.
    const skills = skillEvidence.length ? explicitSkills(skillEvidence, normalizedText) : [];
    if (skills.length) proposals.push(candidate({
      itemKey: "skills", canonicalKey: "SKILLS", entityType: null, entityGroupKey: null,
      normalizedValue: {
        schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MULTI_ENUM",
        values: skills.map((skill) => ({ key: skillKey(skill), label: skill }))
      }, confidence: 0.82
    }, section(lines, "SKILLS").join("\n") || skills.join(" "), "SKILLS"));

    const employmentRanges: ResumeDateRange[] = [];
    const employment = section(lines, "EXPERIENCE");
    let pendingEmploymentHeader: string | null = null;
    let employmentIndex = 0;
    let currentEmployment: { company: string; title: string; evidence: string } | null = null;
    let activeEmployment: { group: string; descriptionLines: string[] } | null = null;
    const flushEmploymentDetails = () => {
      if (!activeEmployment?.descriptionLines.length) return;
      const evidence = activeEmployment.descriptionLines.join("\n").slice(0, 4_000).trim();
      if (!evidence) return;
      proposals.push(candidate({
        itemKey: `${activeEmployment.group}-description`, canonicalKey: "EMPLOYMENT_DESCRIPTION",
        entityType: "EMPLOYMENT", entityGroupKey: activeEmployment.group,
        normalizedValue: richTextValue(evidence), confidence: 0.9
      }, evidence, "EXPERIENCE"));
      const employmentSkills = explicitSkills([], evidence);
      if (employmentSkills.length) proposals.push(candidate({
        itemKey: `${activeEmployment.group}-skills`, canonicalKey: "EMPLOYMENT_SKILLS",
        entityType: "EMPLOYMENT", entityGroupKey: activeEmployment.group,
        normalizedValue: {
          schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MULTI_ENUM",
          values: employmentSkills.map((skill) => ({ key: skillKey(skill), label: skill }))
        }, confidence: 0.82
      }, evidence, "EXPERIENCE"));
    };
    for (const line of employment) {
      const parsed = parseDateRange(line);
      if (!parsed) {
        if (isLikelyEntryHeader(line)) pendingEmploymentHeader = line;
        else if (activeEmployment) activeEmployment.descriptionLines.push(line);
        continue;
      }
      const headerLine = parsed.prefix || pendingEmploymentHeader;
      const headerEvidence = parsed.prefix ? line : pendingEmploymentHeader ? `${pendingEmploymentHeader}\n${line}` : line;
      pendingEmploymentHeader = null;
      if (!headerLine || !headerLine.includes(",")) continue;
      const comma = headerLine.indexOf(",");
      const title = headerLine.slice(0, comma).trim();
      const company = headerLine.slice(comma + 1).trim();
      if (!title || !company) continue;
      flushEmploymentDetails();
      employmentIndex += 1;
      const group = `employment-${employmentIndex}`;
      activeEmployment = { group, descriptionLines: [] };
      employmentRanges.push(parsed.range);
      proposals.push(candidate({
        itemKey: `${group}-company`, canonicalKey: "EMPLOYMENT_COMPANY", entityType: "EMPLOYMENT", entityGroupKey: group,
        normalizedValue: stringValue(company), confidence: 0.92
      }, headerEvidence, "EXPERIENCE"));
      proposals.push(candidate({
        itemKey: `${group}-title`, canonicalKey: "EMPLOYMENT_TITLE", entityType: "EMPLOYMENT", entityGroupKey: group,
        normalizedValue: stringValue(title), confidence: 0.92
      }, headerEvidence, "EXPERIENCE"));
      proposals.push(candidate({
        itemKey: `${group}-dates`, canonicalKey: "EMPLOYMENT_DATE_RANGE", entityType: "EMPLOYMENT", entityGroupKey: group,
        normalizedValue: parsed.range, confidence: 0.96
      }, headerEvidence, "EXPERIENCE"));
      if (parsed.range.current && !currentEmployment) currentEmployment = { company, title, evidence: headerEvidence };
    }
    flushEmploymentDetails();
    if (currentEmployment) {
      proposals.push(candidate({
        itemKey: "current-company", canonicalKey: "CURRENT_COMPANY", entityType: null, entityGroupKey: null,
        normalizedValue: stringValue(currentEmployment.company), confidence: 0.9
      }, currentEmployment.evidence, "EXPERIENCE"));
      proposals.push(candidate({
        itemKey: "current-job-title", canonicalKey: "CURRENT_JOB_TITLE", entityType: null, entityGroupKey: null,
        normalizedValue: stringValue(currentEmployment.title), confidence: 0.9
      }, currentEmployment.evidence, "EXPERIENCE"));
    }
    const totalMonths = uniqueProfessionalMonths(employmentRanges, this.clock.now());
    if (totalMonths > 0) proposals.push(candidate({
      itemKey: "total-experience", canonicalKey: "TOTAL_EXPERIENCE", entityType: null, entityGroupKey: null,
      normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DURATION", months: totalMonths }, confidence: 0.88
    }, employment.join("\n"), "EXPERIENCE"));

    const education = section(lines, "EDUCATION");
    let pendingEducationHeader: string | null = null;
    let educationIndex = 0;
    for (const line of education) {
      const parsed = parseDateRange(line);
      if (!parsed) {
        if (line.includes(",") && !/^[•●▪◦-]/.test(line)) pendingEducationHeader = line;
        continue;
      }
      const headerLine = parsed.prefix || pendingEducationHeader;
      const headerEvidence = parsed.prefix ? line : pendingEducationHeader ? `${pendingEducationHeader}\n${line}` : line;
      pendingEducationHeader = null;
      if (!headerLine || !headerLine.includes(",")) continue;
      const comma = headerLine.indexOf(",");
      const degreeAndField = headerLine.slice(0, comma).trim();
      const institution = headerLine.slice(comma + 1).trim();
      if (!degreeAndField || !institution) continue;
      educationIndex += 1;
      const group = `education-${educationIndex}`;
      const degreeParts = /^(.*?)\s+(?:in|of)\s+(.+)$/i.exec(degreeAndField);
      proposals.push(candidate({
        itemKey: `${group}-institution`, canonicalKey: "EDUCATION_INSTITUTION", entityType: "EDUCATION", entityGroupKey: group,
        normalizedValue: stringValue(institution), confidence: 0.92
      }, headerEvidence, "EDUCATION"));
      proposals.push(candidate({
        itemKey: `${group}-degree`, canonicalKey: "EDUCATION_DEGREE", entityType: "EDUCATION", entityGroupKey: group,
        normalizedValue: stringValue(degreeParts?.[1] ?? degreeAndField), confidence: 0.9
      }, headerEvidence, "EDUCATION"));
      if (degreeParts?.[2]) proposals.push(candidate({
        itemKey: `${group}-field`, canonicalKey: "EDUCATION_FIELD_OF_STUDY", entityType: "EDUCATION", entityGroupKey: group,
        normalizedValue: stringValue(degreeParts[2]), confidence: 0.9
      }, headerEvidence, "EDUCATION"));
      proposals.push(candidate({
        itemKey: `${group}-dates`, canonicalKey: "EDUCATION_DATE_RANGE", entityType: "EDUCATION", entityGroupKey: group,
        normalizedValue: parsed.range, confidence: 0.96
      }, headerEvidence, "EDUCATION"));
    }
    return proposals;
  }
}

export class PdfJsResumeTextExtractor implements ResumeTextExtractor {
  readonly name = "PDFJS";
  readonly version = "7";

  async extract(bytes: Uint8Array): Promise<string> {
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = pdfjs.getDocument({
        // fs.readFile returns a Buffer. Buffer#slice remains a Buffer, which
        // pdfjs deliberately rejects even though Buffer extends Uint8Array.
        // Copy into a plain Uint8Array so persisted local/object-storage PDFs
        // follow the same path as browser/test byte arrays.
        data: new Uint8Array(bytes),
        useWorkerFetch: false
      });
      const document = await loading.promise;
      const pages: string[] = [];
      try {
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          const lines: string[] = [];
          let line: string[] = [];
          const flushLine = () => {
            const value = line.join(" ").replace(/\s+/g, " ").trim();
            if (value) lines.push(value);
            line = [];
          };
          for (const item of content.items) {
            if (!("str" in item)) continue;
            if (item.str) line.push(item.str);
            if (item.hasEOL) flushLine();
          }
          flushLine();
          pages.push(lines.join("\n"));
          page.cleanup();
        }
      } finally {
        await document.cleanup();
        await loading.destroy();
      }
      const text = pages.join("\n").trim();
      if (!text) {
        throw new ValidationError("This PDF has no selectable text.", {
          reasonCode: "RESUME_TEXT_NOT_FOUND"
        });
      }
      return text;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError("The PDF is corrupt, encrypted, or cannot be read.", {
        reasonCode: "RESUME_PDF_PARSE_FAILED"
      });
    }
  }
}

export class ResumeOnboardingService {
  constructor(
    private readonly repository: ResumeRepository,
    private readonly storage: ObjectStoragePort,
    private readonly textExtractor: ResumeTextExtractor,
    private readonly candidateExtractor: ResumeCandidateExtractor,
    private readonly cipher: CandidatePayloadCipher,
    private readonly fingerprinter: CandidateValueFingerprinter,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async upload(input: {
    accountId: string;
    candidateId: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    idempotencyKey: string;
  }): Promise<ResumeDocument> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const validated = validateMasterResume(input);
    const objectKey = `accounts/${accountId}/candidates/${candidateId}/resumes/${createHash("sha256").update(idempotencyKey).digest("hex")}-${validated.contentSha256.slice(0, 16)}.pdf`;
    const fingerprint = requestFingerprint({ candidateId, contentSha256: validated.contentSha256, fileName: validated.fileName });
    await this.storage.put({ objectKey, bytes: input.bytes, contentType: MASTER_RESUME_MIME });
    try {
      const registration = await this.repository.registerResume({
        documentId: this.newId(), accountId, candidateId, objectKey,
        originalFileName: validated.fileName, contentSha256: validated.contentSha256,
        byteSize: input.bytes.byteLength, mimeType: MASTER_RESUME_MIME,
        idempotencyKey, requestFingerprint: fingerprint, createdAt: this.clock.now()
      });
      if (registration.retiredObjectKey && registration.retiredObjectKey !== registration.document.objectKey) {
        await this.storage.delete(registration.retiredObjectKey).catch(() => undefined);
      }
      return registration.document;
    } catch (error) {
      await this.storage.delete(objectKey);
      throw error;
    }
  }

  async extract(input: {
    accountId: string;
    candidateId: string;
    documentId: string;
    idempotencyKey: string;
  }): Promise<ResumeReview> {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const documentId = UuidSchema.parse(input.documentId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const extraction = await this.repository.beginExtraction({
      extractionId: this.newId(), accountId, candidateId, documentId,
      extractor: this.textExtractor.name, extractorVersion: this.textExtractor.version,
      idempotencyKey,
      requestFingerprint: requestFingerprint({ candidateId, documentId, extractor: this.textExtractor.name, version: this.textExtractor.version }),
      startedAt: this.clock.now()
    });
    if (extraction.idempotentReplay || extraction.status !== "PROCESSING") {
      return this.getReview({ accountId, candidateId, documentId });
    }
    try {
      const review = await this.repository.getReview({ accountId, candidateId, documentId });
      const bytes = await this.storage.get(review.document.objectKey);
      const text = await this.textExtractor.extract(bytes);
      const extracted = await this.candidateExtractor.extract(text, { accountId, candidateId, documentId, extractionId: extraction.extractionId });
      const stableGroupKeys = new Map<string, string>();
      for (const item of extracted) {
        if (!item.entityType || !item.entityGroupKey) continue;
        const sourceGroup = `${item.entityType}:${item.entityGroupKey}`;
        if (stableGroupKeys.has(sourceGroup)) continue;
        const group = extracted.filter((candidate) =>
          candidate.entityType === item.entityType && candidate.entityGroupKey === item.entityGroupKey
        );
        const preferred = item.entityType === "EMPLOYMENT"
          ? ["EMPLOYMENT_COMPANY", "EMPLOYMENT_DATE_RANGE", "EMPLOYMENT_TITLE"]
          : item.entityType === "EDUCATION"
            ? ["EDUCATION_INSTITUTION", "EDUCATION_DATE_RANGE", "EDUCATION_DEGREE"]
            : item.entityType === "PROJECT"
              ? ["PROJECT_NAME", "PROJECT_DATE_RANGE", "PROJECT_URL"]
              : ["CERTIFICATION_NAME", "CERTIFICATION_ISSUER", "CERTIFICATION_DATE"];
        const anchors = preferred.flatMap((canonicalKey) => {
          const candidate = group.find((value) => value.canonicalKey === canonicalKey);
          return candidate ? [`${canonicalKey}:${this.fingerprinter.fingerprint(candidate.normalizedValue).digest}`] : [];
        }).slice(0, 2);
        stableGroupKeys.set(sourceGroup, `v1-${item.entityType.toLowerCase()}-${createHash("sha256")
          .update(`${item.entityType}:${anchors.join(":")}`)
          .digest("hex").slice(0, 32)}`);
      }
      const stabilized = extracted.map((item) => item.entityType && item.entityGroupKey
        ? { ...item, entityGroupKey: stableGroupKeys.get(`${item.entityType}:${item.entityGroupKey}`) ?? item.entityGroupKey }
        : item);
      const raw: readonly ExtractedResumeProposal[] = [
        ...stabilized,
        {
          itemKey: "resume-document",
          canonicalKey: "RESUME",
          entityType: null,
          entityGroupKey: null,
          normalizedValue: {
            schemaVersion: 1,
            dataClass: "CANDIDATE_PRIVATE",
            kind: "FILE_REF",
            fileId: review.document.documentId,
            contentSha256: review.document.contentSha256,
            fileName: review.document.originalFileName,
            mimeType: review.document.mimeType
          },
          confidence: 1,
          reasonCodes: ["CANDIDATE_UPLOADED_MASTER_RESUME"],
          sourceSection: "UPLOAD",
          sourceEvidence: review.document.contentSha256
        }
      ];
      const valid: ExtractedResumeProposal[] = [];
      let invalidItemCount = 0;
      const itemKeys = new Set<string>();
      for (const item of raw) {
        try {
          if (itemKeys.has(item.itemKey)) throw new Error("duplicate item key");
          itemKeys.add(item.itemKey);
          const definition = canonicalDefinition(item.canonicalKey);
          if (!definition) throw new Error("unsupported canonical");
          const value = PersistableNormalizedValueSchema.parse(item.normalizedValue);
          const policy = candidateAnswerPolicy(item.canonicalKey);
          if (policy.valueType !== value.kind || policy.entityType !== item.entityType) throw new Error("policy mismatch");
          if (!RESUME_SOURCE_SECTIONS.includes(item.sourceSection)) throw new Error("invalid source section");
          const evidence = item.sourceEvidence.trim();
          if (!evidence || evidence.length > 4_000) throw new Error("invalid source evidence");
          if (item.canonicalKey !== "RESUME" && !text.replace(/\r/g, "").includes(evidence)) {
            throw new Error("source evidence is absent from document");
          }
          if (policy.answerClass === "LEGAL_FACT" || policy.answerClass === "CONSENT" || policy.answerClass === "PROTECTED") {
            throw new Error("unsafe inference");
          }
          valid.push({ ...item, sourceEvidence: evidence, normalizedValue: value, confidence: z.number().min(0).max(1).parse(item.confidence) });
        } catch {
          invalidItemCount += 1;
        }
      }
      await this.repository.completeExtraction({
        accountId, candidateId, extractionId: extraction.extractionId,
        textSha256: createHash("sha256").update(text).digest("hex"),
        proposals: valid.map((item) => {
          const fingerprint = this.fingerprinter.fingerprint(item.normalizedValue);
          return {
            proposalId: this.newId(), itemKey: item.itemKey, canonicalKey: item.canonicalKey,
            entityType: item.entityType, entityGroupKey: item.entityGroupKey,
            confidence: item.confidence, reasonCodes: item.reasonCodes,
            sourceSection: item.sourceSection,
            evidenceSha256: createHash("sha256").update(item.sourceEvidence).digest("hex"),
            extractionSchemaVersion: RESUME_EXTRACTION_SCHEMA_VERSION,
            entityMatchValue: item.entityType ? item.normalizedValue : null,
            valueFingerprint: fingerprint.digest, fingerprintKeyVersion: fingerprint.keyVersion,
            encryptedPayload: this.cipher.encrypt(item.normalizedValue)
          };
        }),
        invalidItemCount,
        completedAt: this.clock.now()
      });
      return this.getReview({ accountId, candidateId, documentId });
    } catch (error) {
      await this.repository.failExtraction({
        accountId, candidateId, extractionId: extraction.extractionId,
        errorCode: error instanceof ValidationError ? "DOCUMENT_INVALID" : "EXTRACTION_FAILED",
        failedAt: this.clock.now()
      });
      throw error instanceof ConflictError || error instanceof NotFoundError || error instanceof ValidationError
        ? error
        : new ValidationError("We could not read this resume. Upload a clear, text-based PDF or retry.", {
            reasonCode: "RESUME_EXTRACTION_FAILED"
          });
    }
  }

  async getReview(input: { accountId: string; candidateId: string; documentId?: string }): Promise<ResumeReview> {
    const stored = await this.repository.getReview({
      accountId: UuidSchema.parse(input.accountId),
      candidateId: UuidSchema.parse(input.candidateId),
      ...(input.documentId ? { documentId: UuidSchema.parse(input.documentId) } : {})
    });
    return {
      document: stored.document,
      extraction: stored.extraction,
      proposals: stored.proposals.map((proposal) => ({
        ...proposal,
        normalizedValue: this.cipher.decrypt(proposal.encryptedPayload)
      }))
    };
  }
}
