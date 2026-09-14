import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const uploads = fs.readFileSync(path.join(root, "extension/adapters/common/uploads.js"), "utf8");
const scripts = `${content}\n${uploads}`;

function applyText() {
    const match = content.match(/const APPLY_TEXT = (\/\^[\s\S]*?\/i);/);
    assert.ok(match, "APPLY_TEXT must remain a single-line-extractable regular expression");
    return eval(match[1]);
}

function questionUpload() {
    const uploads = fs.readFileSync(path.join(root, "extension/adapters/common/uploads.js"), "utf8");
    assert.match(uploads, /function isQuestionDisguisedAsUpload\(label\)/);
    const fn = new Function("label", `
        const text = String(label || "");
        if (/r[eé]sum[eé]|(?:^|\\W)cv(?:\\W|$)|cover.?letter/i.test(text)) return false;
        return /how many years|years of experience|notice period|current ctc|expected ctc|willing to relocate|why (?:are you|do you want)|backend engineering/i.test(text);
    `);
    return fn;
}

test("Naukri listing Apply labels still match after nearby Save text", () => {
    const apply = applyText();
    assert.equal(apply.test("Apply"), true);
    assert.equal(apply.test("Apply Save"), true);
    assert.equal(apply.test("Apply on Naukri"), true);
    assert.equal(apply.test("Apply on company website"), true);
    assert.equal(apply.test("Easy Apply"), true);
});

test("Trustklub session: years-of-experience file is not a resume and does not make a listing look like a form", () => {
    const disguised = questionUpload();
    assert.equal(disguised("How many years of experience do you have in Backend Engineering?"), true);
    assert.equal(disguised("Resume"), false);
    assert.equal(disguised("Cover letter"), false);
    assert.match(content, /isQuestionDisguisedAsUpload\(uploadLabelFor\(element\)\)/);
    assert.match(content, /!visible\(element\) && !isNamedDocumentUpload\(element\) && !isLabeledDocumentUpload\(element\)/);
    assert.match(content, /isNamedDocumentUpload\(element\) \|\| isLabeledDocumentUpload\(element\) \|\| \(visible\(element\) && !isQuestionDisguisedAsUpload/);
    assert.doesNotMatch(content, /if \(document\.querySelector\('input\[type="file"\]'\)\) return true/);
    assert.match(scripts, /isQuestionDisguisedAsUpload\(field\.label\)/);
    assert.doesNotMatch(content, /uploads\.length === 1 && !\/cover\.\?letter\|portfolio\|transcript/);
});
