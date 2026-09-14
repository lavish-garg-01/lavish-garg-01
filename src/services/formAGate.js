import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergePacks } from "../adapters/overlayKey.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACK_DIR = path.join(ROOT, "src/adapters/packs");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures");

/**
 * Owned Form A/B contracts per ATS. Fixtures live under test/fixtures.
 * testIds here must match the seeded pack and the HTML fixtures.
 */
export const FORM_A_CONTRACTS = {
    rippling: { resumeTestIds: ["input-resume"], coverTestIds: ["input-cover_letter"] },
    greenhouse: { resumeTestIds: ["resume"], coverTestIds: ["cover_letter"] },
    workday: {
        resumeTestIds: ["file-upload-input-resume"],
        coverTestIds: ["file-upload-input-coverLetter"],
        testIdAttr: "data-automation-id"
    },
    keka: { resumeTestIds: ["keka-resume"], coverTestIds: ["keka-cover-letter"] },
    lever: { resumeTestIds: ["resume-upload-input"], coverTestIds: ["additional-information"] },
    ashby: { resumeTestIds: ["ashby-resume"], coverTestIds: ["ashby-cover-letter"] },
    smartrecruiters: { resumeTestIds: ["smartrecruiters-resume"], coverTestIds: ["smartrecruiters-cover-letter"] },
    pinpoint: { resumeTestIds: ["pinpoint-resume"], coverTestIds: ["pinpoint-cover-letter"] },
    phenom: { resumeTestIds: ["phenom-resume"], coverTestIds: ["phenom-cover-letter"] },
    naukri: { resumeTestIds: ["naukri-resume"], coverTestIds: ["naukri-cover-letter"] },
    instahyre: { resumeTestIds: ["instahyre-resume"], coverTestIds: ["instahyre-cover-letter"] },
    wellfound: { resumeTestIds: ["wellfound-resume"], coverTestIds: ["wellfound-cover-letter"] },
    linkedin: { resumeTestIds: ["linkedin-resume"], coverTestIds: ["linkedin-cover-letter"] },
    generic: { resumeTestIds: ["input-resume"], coverTestIds: ["input-cover_letter"] }
};

export function formAPortalKinds() {
    return Object.keys(FORM_A_CONTRACTS);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalize(value = "") {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function packPath(portalKind) {
    return path.join(PACK_DIR, `${portalKind}.json`);
}

export function formAFixturePath(portalKind, variant) {
    const kind = String(portalKind || "rippling").toLowerCase();
    if (variant === "b") return path.join(FIXTURE_DIR, `form-b-${kind}-cover-trap.html`);
    return path.join(FIXTURE_DIR, `form-a-${kind}.html`);
}

export function formFixtureHtml(portalKind, variant = "a") {
    const spec = FORM_A_CONTRACTS[portalKind];
    if (!spec) throw new Error(`No Form A contract for portal ${portalKind}.`);
    const attr = spec.testIdAttr || "data-testid";
    const resumeId = spec.resumeTestIds[0];
    const coverId = spec.coverTestIds[0];
    const trap = variant === "b";
    const title = trap
        ? `Form B · ${portalKind} cover-letter trap`
        : `Form A · ${portalKind} dual upload`;
    const coverLabel = trap ? "Cover letter / CV upload" : "Cover letter";
    const coverAria = trap ? ' aria-label="CV"' : "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body>
  <main>
    <h1>Application</h1>
    <form id="application">
      <label data-field="full_name">Full name
        <input type="text" name="full_name" autocomplete="name" />
      </label>
      <label data-field="email">Email
        <input type="email" name="email" autocomplete="email" />
      </label>
      <label data-field="phone">Phone
        <input type="tel" name="phone" autocomplete="tel" />
      </label>
${trap ? `      <label data-field="cover_letter">${coverLabel}
        <input type="file" name="cover" ${attr}="${coverId}"${coverAria} accept="application/pdf" />
      </label>
      <label data-field="resume">Resume PDF
        <input type="file" name="resume" ${attr}="${resumeId}" accept="application/pdf" />
      </label>
` : `      <label data-field="resume">Resume
        <input type="file" name="resume" ${attr}="${resumeId}" accept="application/pdf" />
      </label>
      <label data-field="cover_letter">Cover letter
        <input type="file" name="cover_letter" ${attr}="${coverId}" accept="application/pdf" />
      </label>
`}    </form>
  </main>
</body>
</html>
`;
}

/**
 * Browserless parse of file inputs and their nearest label / aria text.
 * Fixtures are owned HTML; this is a contract lock, not a full DOM engine.
 */
export function extractFileControls(html = "") {
    const source = String(html || "");
    const controls = [];
    const inputRe = /<input\b[^>]*\btype\s*=\s*["']file["'][^>]*>/gi;
    let match;
    while ((match = inputRe.exec(source))) {
        const tag = match[0];
        const index = match.index;
        const testId = (tag.match(/\bdata-testid\s*=\s*["']([^"']+)["']/i) || [])[1]
            || (tag.match(/\bdata-automation-id\s*=\s*["']([^"']+)["']/i) || [])[1]
            || "";
        const name = (tag.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
        const ariaLabel = (tag.match(/\baria-label\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
        const id = (tag.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
        const before = source.slice(Math.max(0, index - 400), index);
        const labelOpen = before.lastIndexOf("<label");
        const labelClose = before.lastIndexOf("</label>");
        let labelText = "";
        let fieldHint = "";
        if (labelOpen > labelClose) {
            const labelSlice = before.slice(labelOpen);
            fieldHint = ((labelSlice.match(/\bdata-field\s*=\s*["']([^"']+)["']/i) || [])[1]) || "";
            labelText = labelSlice.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
        controls.push({
            testId,
            name,
            id,
            ariaLabel,
            labelText,
            fieldHint,
            searchText: normalize([labelText, ariaLabel, name, fieldHint, testId].filter(Boolean).join(" "))
        });
    }
    return controls;
}

function preferTestId(pack = {}) {
    const overlays = pack.overlays || {};
    if (overlays.preferTestIdForUploads != null) return Boolean(overlays.preferTestIdForUploads);
    return true;
}

/**
 * mergePacks unions testIds, so an overlay cannot clear input-resume.
 * For the gate, an explicit candidate testIds array (including []) replaces
 * the portal default — that is how a poison pack that drops the resume
 * testId is detected.
 */
function effectivePack(portalDefault, candidatePack) {
    if (!candidatePack) return portalDefault;
    const merged = mergePacks(portalDefault, candidatePack);
    const roles = ["resume", "coverLetter"];
    const fileFields = { ...(merged.fileFields || {}) };
    for (const role of roles) {
        const candidateField = candidatePack.fileFields?.[role];
        if (!candidateField || !Object.prototype.hasOwnProperty.call(candidateField, "testIds")) continue;
        fileFields[role] = {
            ...(fileFields[role] || {}),
            testIds: [...(candidateField.testIds || [])]
        };
    }
    return { ...merged, fileFields };
}

function fieldSpec(pack = {}, role) {
    const fields = pack.fileFields || {};
    if (role === "coverLetter") return fields.coverLetter || fields.cover_letter || {};
    return fields[role] || {};
}

function testIdsOf(spec = {}) {
    return [...(spec.testIds || [])].filter(Boolean);
}

function matchByTestId(controls, testIds = []) {
    const wanted = new Set(testIds.map((value) => normalize(value)).filter(Boolean));
    if (!wanted.size) return null;
    return controls.find((control) => wanted.has(normalize(control.testId))) || null;
}

function matchByLabel(controls, patterns = []) {
    const needles = (patterns || []).map((value) => normalize(value)).filter(Boolean);
    if (!needles.length) return null;
    return controls.find((control) => needles.some((needle) => control.searchText.includes(needle))) || null;
}

/**
 * Resolve a file role the same way the extension prefers: testId first when
 * preferTestIdForUploads is on, then labelPatterns.
 */
export function resolveFileControl(html, pack, role) {
    const controls = extractFileControls(html);
    const spec = fieldSpec(pack, role);
    const testIds = testIdsOf(spec);
    const labelPatterns = spec.labelPatterns || [];
    if (preferTestId(pack) && testIds.length) {
        const byTestId = matchByTestId(controls, testIds);
        if (byTestId) return { control: byTestId, via: "testid" };
    }
    const byLabel = matchByLabel(controls, labelPatterns);
    if (byLabel) return { control: byLabel, via: "label" };
    if (testIds.length) {
        const byTestId = matchByTestId(controls, testIds);
        if (byTestId) return { control: byTestId, via: "testid" };
    }
    return { control: null, via: null };
}

function identityPresent(html = "") {
    const text = normalize(html);
    const hasName = /full name/.test(text)
        || (/(?:first|given) name/.test(text) && /(?:last|family|sur)name/.test(text));
    return hasName && /\bemail\b/.test(text) && /\bphone\b/.test(text);
}

function controlKey(control) {
    if (!control) return "";
    return normalize([control.testId, control.name, control.id, control.fieldHint].filter(Boolean).join("|"));
}

function evaluateFixture(name, html, pack) {
    const resume = resolveFileControl(html, pack, "resume");
    const cover = resolveFileControl(html, pack, "coverLetter");
    const resumeKey = controlKey(resume.control);
    const coverKey = controlKey(cover.control);
    const reasons = [];

    if (!resume.control) reasons.push("RESUME_UNRESOLVED");
    if (!cover.control) reasons.push("COVER_UNRESOLVED");
    if (resume.control && cover.control && resumeKey && resumeKey === coverKey) {
        reasons.push("RESUME_COVER_COLLISION");
    }
    if (name === "form-b" && resume.control?.fieldHint === "cover_letter") {
        reasons.push("RESUME_BOUND_TO_COVER_TRAP");
    }
    if (preferTestId(pack) && !testIdsOf(fieldSpec(pack, "resume")).length) {
        reasons.push("RESUME_TESTID_MISSING");
    }
    if (!identityPresent(html)) reasons.push("IDENTITY_LABELS_MISSING");

    const ok = reasons.length === 0;
    const resumeView = resume.control
        ? { testId: resume.control.testId, via: resume.via, fieldHint: resume.control.fieldHint }
        : null;
    const coverView = cover.control
        ? { testId: cover.control.testId, via: cover.via, fieldHint: cover.control.fieldHint }
        : null;
    return {
        fixture: name,
        ok,
        reasons,
        resume: resumeView,
        coverLetter: coverView
    };
}

function loadFixture(portalKind, variant) {
    const filePath = formAFixturePath(portalKind, variant);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf8");
    return formFixtureHtml(portalKind, variant);
}

function resolvePortalKind(candidatePack = null) {
    const kind = String(candidatePack?.portalKind || "").toLowerCase();
    if (kind && FORM_A_CONTRACTS[kind]) return kind;
    return null;
}

function gateResult(portalKind, formA, formB) {
    const failed = [formA, formB].filter((item) => !item.ok);
    const status = failed.length ? "FAIL" : "PASS";
    const reason = status === "PASS"
        ? `${portalKind} Form A and Form B keep resume and cover letter on distinct controls.`
        : failed.map((item) => `${portalKind} ${item.fixture}: ${item.reasons.join(", ")}`).join("; ");
    return {
        status,
        formAGate: status,
        reason,
        details: { formA, formB, portalKind }
    };
}

/**
 * Form A gate for one ATS file overlay.
 * Never returns SKIPPED once the owned fixtures exist.
 */
export function evaluateFormAGate(candidatePack = null, portalKind = null) {
    const kind = String(portalKind || resolvePortalKind(candidatePack) || "rippling").toLowerCase();
    if (!FORM_A_CONTRACTS[kind]) {
        return {
            status: "FAIL",
            formAGate: "FAIL",
            reason: `No Form A contract for portal ${kind}.`,
            details: { formA: null, formB: null, portalKind: kind }
        };
    }
    const portalDefault = readJson(packPath(kind));
    const merged = effectivePack(portalDefault, candidatePack);
    const formA = evaluateFixture("form-a", loadFixture(kind, "a"), merged);
    const formB = evaluateFixture("form-b", loadFixture(kind, "b"), merged);
    return gateResult(kind, formA, formB);
}

export function evaluateAllFormAGates() {
    const portals = {};
    const failed = [];
    for (const kind of formAPortalKinds()) {
        const result = evaluateFormAGate(null, kind);
        portals[kind] = result;
        if (result.status !== "PASS") failed.push(`${kind}: ${result.reason}`);
    }
    const rippling = portals.rippling;
    const status = failed.length ? "FAIL" : "PASS";
    return {
        status,
        formAGate: status,
        reason: status === "PASS"
            ? "Every ATS Form A and Form B keeps resume and cover letter on distinct controls."
            : failed.join(" | "),
        details: {
            formA: rippling.details.formA,
            formB: rippling.details.formB,
            portalKind: "rippling",
            portals
        }
    };
}

/** Stable export used by learnProposer and admin promote. */
export function formAGate(candidatePack = null) {
    if (candidatePack && (candidatePack.portalKind || candidatePack.fileFields)) {
        return evaluateFormAGate(candidatePack, resolvePortalKind(candidatePack));
    }
    return evaluateAllFormAGates();
}
