import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicResumeCandidateExtractor, resumeEntityAnchorMatches, validateMasterResume } from "./resume.js";

const candidateString = (value: string) => ({
  schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const, kind: "STRING" as const, value
});

test("repeatable resume anchors ignore presentation differences but remain conservative", () => {
  assert.equal(resumeEntityAnchorMatches("EMPLOYMENT_COMPANY", candidateString("VIDYAKUL"), candidateString("Vidyakul")), true);
  assert.equal(resumeEntityAnchorMatches("EMPLOYMENT_COMPANY", candidateString("MYLO PREGNANCY & PARENTING"), candidateString("Mylo")), true);
  assert.equal(resumeEntityAnchorMatches("EMPLOYMENT_COMPANY", candidateString("DELHI METRO RAIL CORPORATION"), candidateString("Delhi Metro Rail Cooperation")), true);
  assert.equal(resumeEntityAnchorMatches("EMPLOYMENT_TITLE", candidateString("FREELANCER"), candidateString("Developer (freelancer)")), true);
  assert.equal(resumeEntityAnchorMatches("EMPLOYMENT_COMPANY", candidateString("Acme Labs"), candidateString("Acme Bank")), false);
});

function fakePdf(text = "fixture"): Uint8Array {
  return Buffer.from(`%PDF-1.7\n${text}\n%%EOF`, "utf8");
}

test("R2 server validation rejects unsafe names, unsupported types, malformed and oversized files", () => {
  assert.throws(() => validateMasterResume({ fileName: "../resume.pdf", mimeType: "application/pdf", bytes: fakePdf() }));
  assert.throws(() => validateMasterResume({ fileName: "resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: fakePdf() }));
  assert.throws(() => validateMasterResume({ fileName: "resume.pdf", mimeType: "application/pdf", bytes: Buffer.from("not-pdf") }));
  assert.throws(() => validateMasterResume({ fileName: "resume.pdf", mimeType: "application/pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }));
});

test("R3 deterministic extraction preserves repeatable identity, provenance and valid date ordering", async () => {
  const text = [
    "Example Person", "person@example.test", "SKILLS", "TypeScript Node.js",
    "EXPERIENCE",
    "ENGINEER, EXAMPLE LABS January 2020 – December 2021",
    "SENIOR ENGINEER, EXAMPLE LABS January 2022 – present",
    "INVALID ROLE, OTHER LABS January 2025 – January 2024",
    "EDUCATION", "B.Tech in Computer Science, Example University 2015 – 2019"
  ].join("\n");
  const proposals = await new DeterministicResumeCandidateExtractor({ now: () => new Date("2026-09-01T00:00:00Z") }).extract(text);
  const employmentGroups = new Set(proposals.filter((item) => item.entityType === "EMPLOYMENT").map((item) => item.entityGroupKey));
  assert.equal(employmentGroups.size, 2);
  assert.equal(proposals.some((item) => item.normalizedValue.kind === "STRING" && item.normalizedValue.value === "OTHER LABS"), false);
  assert.ok(proposals.some((item) => item.canonicalKey === "EDUCATION_INSTITUTION"));
  assert.ok(proposals.every((item) => item.sourceEvidence.length > 0 && text.includes(item.sourceEvidence)));
});

test("deterministic extraction keeps complete role evidence, explicit skills and completed experience months", async () => {
  const text = [
    "Example Person", "person@example.test", "CORE COMPETENCIES",
    "Languages: TypeScript (Node.js), Python",
    "Platforms: AWS (EC2, S3), Docker, CI/CD Pipelines",
    "EXPERIENCE",
    "TEAM LEAD, EXAMPLE LABS", "March 2026 – present",
    "• Built Node.js services with Redis and AWS.",
    "BACKEND DEVELOPER, EXAMPLE LABS", "January 2025 – February 2026",
    "• Optimized MySQL and MongoDB workloads.",
    "FREELANCER, METRO SYSTEMS", "September 2024 – November 2024",
    "• Built Python OCR automation.",
    "DEVELOPER, COMMERCE CO", "January 2023 – August 2024",
    "• Delivered PHP services.",
    "EDUCATION", "B.E. in Computer Science, Example University August 2019 – June 2023"
  ].join("\n");
  const proposals = await new DeterministicResumeCandidateExtractor({ now: () => new Date("2026-09-11T00:00:00Z") }).extract(text);
  const skills = proposals.find((item) => item.canonicalKey === "SKILLS")?.normalizedValue;
  assert.equal(skills?.kind, "MULTI_ENUM");
  if (skills?.kind === "MULTI_ENUM") {
    const labels = skills.values.map((item) => item.label);
    for (const expected of ["TypeScript", "Node.js", "Python", "AWS", "EC2", "S3", "Docker", "CI/CD Pipelines"]) {
      assert.ok(labels.includes(expected), `missing explicit skill ${expected}`);
    }
  }
  assert.equal(proposals.filter((item) => item.canonicalKey === "EMPLOYMENT_DESCRIPTION").length, 4);
  assert.equal(proposals.filter((item) => item.canonicalKey === "EMPLOYMENT_SKILLS").length, 4);
  const experience = proposals.find((item) => item.canonicalKey === "TOTAL_EXPERIENCE")?.normalizedValue;
  assert.equal(experience?.kind === "DURATION" ? experience.months : null, 44);
  assert.ok(proposals.every((item) => item.sourceEvidence.length <= 4_000 && text.includes(item.sourceEvidence)));
});

test("headings are never misidentified as a candidate name when the header has no name", async () => {
  const proposals = await new DeterministicResumeCandidateExtractor().extract("SUMMARY\nBackend engineer\nSKILLS\nTypeScript");
  assert.equal(proposals.some((item) => item.canonicalKey === "FULL_NAME"), false);
});
