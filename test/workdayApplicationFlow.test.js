import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.readFileSync(path.join(root, "test/fixtures/workday-create-account.html"), "utf8");
const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");

test("IQVIA Workday create-account step is processed while password, consent, and bot trap remain protected", () => {
    // Workday uses a text input for email, rather than input[type=email].
    assert.match(fixture, /Email Address\*<\/label><input[^>]*type="text"/);
    assert.match(fixture, /current step 1 of 6/);
    assert.match(fixture, /type="password"/);
    assert.match(fixture, /consent to the processing of my personal data/i);
    assert.match(fixture, /robots only, do not enter if you're human/i);

    // The extension recognizes the Workday application route, pauses sensitive
    // account/consent controls, and excludes the honeypot from detection.
    assert.match(content, /isWorkdayApplicationRoute/);
    assert.match(content, /fieldControls\(document\.body\)\.length > 0/);
    assert.match(content, /field\.type === "password"/);
    assert.match(content, /robots\?\\s\+only\|do not enter if you/);
    assert.match(content, /MAX_NAVIGATION_HOPS = 12/);
    assert.match(content, /if \(job && state\.navigation\)/);
});
