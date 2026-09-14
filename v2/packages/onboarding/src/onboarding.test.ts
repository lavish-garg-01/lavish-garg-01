import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityAccount, IdentityTokenVerifier } from "@job-hunter-v2/auth";
import {
  CandidateSessionService,
  DeterministicResumeCandidateExtractor,
  PdfJsResumeTextExtractor,
  type CandidateBootstrapRepository
} from "./index.js";

const account: IdentityAccount = {
  accountId: "10000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000002",
  accountType: "NORMAL",
  accountStatus: "ACTIVE",
  userStatus: "ACTIVE",
  membershipRole: "OWNER"
};

test("authenticated bootstrap derives account and candidate ownership from the verified token", async () => {
  const now = new Date("2026-09-01T10:00:00.000Z");
  const verifier: IdentityTokenVerifier = {
    verifyAuthorizationHeader: async (header) => {
      assert.equal(header, "Bearer trusted");
      return {
        provider: "TEST",
        providerSubject: "subject",
        email: "engineer@example.com",
        tokenId: null,
        expiresAt: new Date("2026-09-01T11:00:00.000Z")
      };
    }
  };
  const identityService = {
    ensureNormalAccount: async () => account
  };
  const candidateTruth = {
    ensureCandidate: async (input: { accountId: string; candidateId: string }) => {
      assert.equal(input.accountId, account.accountId);
      return "20000000-0000-4000-8000-000000000001";
    }
  };
  const repository: CandidateBootstrapRepository = {
    ensureState: async (input) => ({
      accountId: input.accountId,
      candidateId: input.candidateId,
      stage: "WELCOME",
      completed: false,
      isNewCandidate: true,
      version: 1,
      startedAt: now,
      completedAt: null
    })
  };
  const service = new CandidateSessionService(
    verifier,
    identityService,
    candidateTruth,
    repository,
    { now: () => now },
    () => "20000000-0000-4000-8000-000000000099"
  );
  const session = await service.authenticate("Bearer trusted");
  assert.equal(session.account.accountId, account.accountId);
  assert.equal(session.candidate.candidateId, "20000000-0000-4000-8000-000000000001");
  assert.equal(session.identity.email, "engineer@example.com");
});

function selectableTextPdf(text: string): Buffer {
  const escapedLines = text.split("\n").map((line) =>
    line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
  );
  const stream = `BT /F1 12 Tf 14 TL 72 720 Td ${escapedLines.map((line, index) => `${index ? "T* " : ""}(${line}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "latin1");
}

test("PDF extraction accepts persisted Buffer bytes and returns selectable text", async () => {
  const text = await new PdfJsResumeTextExtractor().extract(selectableTextPdf("Audit Candidate\naudit@example.test"));
  assert.equal(text, "Audit Candidate\naudit@example.test");
});

test("resume candidates include scheme-less links and stable employment and education facts", async () => {
  const extractor = new DeterministicResumeCandidateExtractor({
    now: () => new Date("2026-09-03T00:00:00.000Z")
  });
  const proposals = await extractor.extract([
    "Audit Candidate",
    "audit@example.test • +91 9876543210 • www.linkedin.com/in/audit-candidate",
    "S U M M A R Y",
    "Backend engineer building reliable systems.",
    "S K I L L S",
    "Languages: TypeScript, Node.js, SQL",
    "E X P E R I E N C E",
    "LEAD ENGINEER, EXAMPLE LABS March 2026 – present",
    "• Built one system.",
    "SOFTWARE ENGINEER, EXAMPLE LABS",
    "January 2024 – February 2026",
    "• Built another system.",
    "E D U C A T I O N",
    "B.E. in Computer Science, Example Institute August 2019 – June 2023"
  ].join("\n"));
  const byCanonical = new Map<string, typeof proposals>(
    [...new Set(proposals.map((proposal) => proposal.canonicalKey))]
      .map((key) => [key, proposals.filter((proposal) => proposal.canonicalKey === key)])
  );
  const linkedIn = byCanonical.get("LINKEDIN_URL")?.[0]?.normalizedValue;
  assert.equal(linkedIn?.kind, "URL");
  assert.equal(
    linkedIn?.kind === "URL"
      ? linkedIn.value
      : null,
    "https://www.linkedin.com/in/audit-candidate"
  );
  assert.equal(byCanonical.get("PERSONAL_SUMMARY")?.length, 1);
  assert.equal(byCanonical.get("EMPLOYMENT_COMPANY")?.length, 2);
  assert.equal(byCanonical.get("EMPLOYMENT_TITLE")?.length, 2);
  assert.equal(byCanonical.get("EMPLOYMENT_DATE_RANGE")?.length, 2);
  assert.equal(byCanonical.get("CURRENT_COMPANY")?.length, 1);
  assert.equal(byCanonical.get("CURRENT_JOB_TITLE")?.length, 1);
  assert.equal(byCanonical.get("TOTAL_EXPERIENCE")?.length, 1);
  assert.equal(byCanonical.get("EDUCATION_INSTITUTION")?.length, 1);
  assert.equal(byCanonical.get("EDUCATION_DEGREE")?.length, 1);
  assert.equal(byCanonical.get("EDUCATION_FIELD_OF_STUDY")?.length, 1);
  assert.equal(byCanonical.get("EDUCATION_DATE_RANGE")?.length, 1);
  const employmentGroups = new Set(
    proposals.filter((proposal) => proposal.entityType === "EMPLOYMENT").map((proposal) => proposal.entityGroupKey)
  );
  assert.equal(employmentGroups.size, 2);
});
