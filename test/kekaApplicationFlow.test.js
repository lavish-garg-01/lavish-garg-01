import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.readFileSync(path.join(root, "test/fixtures/keka-application.html"), "utf8");
const content = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");
const scanner = fs.readFileSync(path.join(root, "extension/runtime/scanner.js"), "utf8");
const executor = fs.readFileSync(path.join(root, "extension/runtime/executor.js"), "utf8");
const background = fs.readFileSync(path.join(root, "extension/background.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "extension/popup.html"), "utf8");

test("Keka composite controls are learned as stable real fields and can be replayed safely", () => {
    assert.match(fixture, /name="mobilePhone\.countryCode"/);
    assert.match(fixture, /role="combobox"/);
    assert.match(fixture, /value="Years" readonly/);
    assert.match(fixture, /name="currentSalary\.amount"/);

    assert.match(content, /element\.readOnly && !element\.isContentEditable/);
    assert.match(content, /element\.closest\("\.select2"\)/);
    assert.match(content, /countryCode\|currency\|salaryPeriod\|months/);
    assert.match(content, /portalFieldKey/);
    assert.match(content, /selectorCandidates/);
    assert.match(scanner, /bound\?\.isConnected/);
    assert.match(scanner, /deepQueryAll\(selector\)/);
    assert.match(executor, /function setNativeValue/);
    assert.match(executor, /instanceof HTMLSelectElement/);
    assert.match(content, /ownership\.hasFillFailed/);
    assert.match(content, /KEKA_SUCCESS_ROUTE/);
    assert.match(content, /isKekaFormSubmit/);
    assert.match(content, /TEST_LEARNED_AUTOFILL/);
    assert.match(background, /replay: message\.replay === true/);
    assert.match(popup, /Test learned autofill \(never submits\)/);
    assert.doesNotMatch(content, /\.click\(\)[\s\S]{0,80}submit/i);
});
