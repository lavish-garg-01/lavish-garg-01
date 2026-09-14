import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const uploads = fs.readFileSync(path.join(root, "extension/adapters/common/uploads.js"), "utf8");
const scripts = `${content}\n${uploads}`;
const panel = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background.js"), "utf8");

test("Wellfound EarnIn session: hidden resume dropzones are document uploads, Naukri question files are not", () => {
    assert.match(scripts, /function isLabeledDocumentUpload\(element\)/);
    assert.match(scripts, /drag to upload/);
    assert.match(scripts, /!visible\(element\) && !isNamedDocumentUpload\(element\) && !isLabeledDocumentUpload\(element\)/);
    assert.match(scripts, /isNamedDocumentUpload\(element\) \|\| isLabeledDocumentUpload\(element\) \|\| \(visible\(element\) && !isQuestionDisguisedAsUpload/);
    assert.match(scripts, /function isCoverLetterNoteField/);
    assert.match(scripts, /write a note/);
    assert.match(scripts, /assignFilesToControl/);
    assert.match(scripts, /DOCUMENT_DRAG_START/);
    assert.match(scripts, /ATTACH_DOCUMENT/);
    assert.match(background, /GET_COVER_LETTER_TEXT/);
    assert.match(background, /ATTACH_DOCUMENT/);
    assert.match(panel, /data-drag-document|DOCUMENT_DRAG_START/);
    assert.match(panel, /data-attach-document|ATTACH_DOCUMENT/);
    assert.doesNotMatch(scripts, /if \(document\.querySelector\('input\[type="file"\]'\)\) return true/);
});

test("Wellfound cover-letter note uses the prepared letter instead of waiting on leftover writing review", () => {
    assert.match(scripts, /fillCoverLetterNote/);
    assert.match(scripts, /GET_COVER_LETTER_TEXT/);
    assert.match(scripts, /coverLetterAttached/);
    const noteFn = uploads.match(/function isCoverLetterNoteField\(field\) \{[\s\S]*?\n\}/);
    assert.ok(noteFn);
    const fn = new Function("field", `${noteFn[0]}\nreturn isCoverLetterNoteField(field);`);
    assert.equal(fn({ type: "textarea", label: "Cover letter", name: "" }), true);
    assert.equal(fn({ type: "textarea", label: "Write a note to EarnIn.", name: "" }), true);
    assert.equal(fn({ type: "file", label: "Cover letter", name: "cover" }), false);
    assert.equal(fn({ type: "textarea", label: "Years of experience", name: "" }), false);
});
