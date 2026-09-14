import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Rippling dynamic controls prefer contextual labels and reject generic AI questions", () => {
    const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const uploads = fs.readFileSync(path.join(root, "extension/adapters/common/uploads.js"), "utf8");
const scripts = `${content}\n${uploads}`;
    const routes = fs.readFileSync(path.join(root, "src/routes/extension.js"), "utf8");
    assert.match(content, /aria-labelledby/);
    assert.match(content, /genericControlLabel/);
    assert.match(content, /durableControlIdentity\(element\.name\)/);
    assert.match(content, /!dynamicControlId\(element\.id\)/);
    assert.match(content, /portalFieldKey: `\$\{normalizedToken\(identity\)\}:\$\{normalizedToken\(type\)\}:\$\{containerSignature\}/);
    assert.match(content, /filled \? "FILLED" : isVisible \? "UNCHANGED" : "HIDDEN"/);
    assert.match(content, /selectedControlValue/);
    assert.match(content, /optionMatchScore/);
    assert.match(content, /pendingSubmissionReview/);
    assert.match(content, /Did the employer receive/);
    assert.match(content, /const validationFields = detectFields\(\)/);
    assert.doesNotMatch(content, /return fieldControls\(\)\[field\.index\]/);
    assert.doesNotMatch(content, /text\.startsWith\(`\$\{normalized\}/);
    assert.match(content, /data-testid/);
    assert.match(scripts, /employer control cleared the selected file/);
    assert.match(content, /opaqueControlToken/);
    assert.match(content, /isAttachmentStatusNoise/);
    assert.match(content, /type: "choice-group"/);
    assert.match(scripts, /input\[-_\]\?resume/);
    assert.match(content, /fieldHeadingText/);
    assert.match(content, /\[role=radiogroup\]/);
    assert.match(scripts, /fileCount > 1/);
    assert.match(scripts, /GET_RESUME" && \/resume\/i\.test\(existing\.name\)/);
    assert.match(routes, /field\|input\|select\|react-select\)\[-_\]\?\\d\+/);
    assert.match(routes, /input_cover_letter\|cover\.\?letter/);
        assert.match(routes, /locallyFilledFieldIds/);
        assert.match(routes, /allowAiForSemanticKey/);
    assert.match(routes, /FIELD_MAPPING_REJECTED/);
    assert.match(routes, /STALE_APPLICATION_ANSWER_REJECTED/);
    assert.match(routes, /previous && trustedKey && previous\.question_key === trustedKey/);
    assert.match(routes, /genericFieldLabel\(field\.label\)/);
});

test("active resume library stores compact category deltas and assigns them on demand", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-resume-library-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { assignResumeVariant, bestResumeVariantForJob, listActiveResumeVariants, seedResumeVariantsFromJobs } =
        await import("../src/repositories/resumeVariantRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO candidate_profiles (user_id,name,email) VALUES ('local-user','Candidate','candidate@example.com')").run();
        db.prepare("INSERT INTO jobs (id,title,description,url,source,resume_modifications) VALUES (?,?,?,?,?,?)")
            .run("backend", "Backend Engineer", "Node.js APIs", "https://example.test/1", "test", JSON.stringify({ resumeSummary: "Backend resume" }));
        db.prepare("INSERT INTO jobs (id,title,description,url,source,resume_modifications) VALUES (?,?,?,?,?,?)")
            .run("mobile", "Android Engineer", "Kotlin mobile", "https://example.test/2", "test", JSON.stringify({ resumeSummary: "Mobile resume" }));
        const variants = seedResumeVariantsFromJobs();
        assert.equal(variants.length, 2);
        assert.equal(variants.every((variant) => !Object.hasOwn(variant, "filePath")), true);
        const backend = bestResumeVariantForJob({ title: "Senior Backend Engineer", description: "REST APIs" });
        assert.equal(backend.categoryKey, "BACKEND_API");
        assignResumeVariant("backend", backend.id);
        const job = db.prepare("SELECT resume_variant_id,resume_modifications,generated_resume_path FROM jobs WHERE id='backend'").get();
        assert.equal(job.resume_variant_id, backend.id);
        assert.equal(JSON.parse(job.resume_modifications).resumeSummary, "Backend resume");
        assert.equal(job.generated_resume_path, null);
        assert.ok(listActiveResumeVariants().length <= 8);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("side panel uses fitted HTML Quick Look and exposes real active resumes", () => {
    const panel = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "extension/sidepanel.html"), "utf8");
    assert.match(panel, /jobs\/\$\{jobId\}\/resume\.html\?template=/);
    assert.match(panel, /embed=1&v=\$\{revision\}/);
    assert.match(panel, /Your active resumes/);
    assert.match(panel, /data-resume-variant/);
    assert.match(panel, /data-fresh-resume/);
    assert.match(panel, /data-open-quick-look/);
    assert.match(panel, /resumeRevision/);
    assert.match(panel, /event\.key !== "Escape"/);
    assert.match(panel, /quick-look-backdrop/);
    assert.match(panel, /quick-look-page/);
    assert.match(css, /backdrop-filter:blur/);
    assert.match(css, /aspect-ratio:210\/297/);
    assert.equal((css.match(/\.document-preview\{margin-top:12px/g) || []).length, 1);
});
