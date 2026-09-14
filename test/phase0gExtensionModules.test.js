import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadRuntime(file, extras = {}) {
    const context = { globalThis: null, WeakSet, WeakMap, Map, Set, Object, String, Number, Boolean, Date, Math, Error, Promise, setTimeout, clearTimeout, ...extras };
    context.globalThis = context;
    vm.runInNewContext(read(file), context, { filename: file });
    return context;
}

test("Phase 0G loads one modular content runtime before the bootstrap entry", () => {
    const manifest = JSON.parse(read("extension/manifest.json"));
    const scripts = manifest.content_scripts[0].js;
    const runtimeModules = ["scanner", "ownership", "executor", "verifier", "telemetry", "orchestrator"]
        .map((name) => `runtime/${name}.js`);
    for (const module of runtimeModules) {
        assert.ok(scripts.includes(module), module);
        assert.ok(scripts.indexOf(module) < scripts.indexOf("content.js"), module);
    }

    const background = read("extension/background.js");
    for (const module of ["api-client", "session-store", "outbox-transport", "message-router"]) {
        assert.match(background, new RegExp(`importScripts\\(\\"runtime/background/${module}\\.js\\"\\)`));
    }
    assert.match(background, /chrome\.runtime\.onMessage\.addListener\(globalThis\.JobHunterBackgroundMessageRouter\.createHandler/);
    assert.match(background, /async function dispatchBackgroundMessage/);
    assert.ok(
        background.lastIndexOf("void flushDurableOutbox().catch") > background.indexOf("const outboxTransport"),
        "the eager outbox flush must run only after transport initialization"
    );
});

test("Form A and Form B remain certification names, never extension runtime branches", () => {
    const productionRuntime = [
        "extension/content.js", "extension/background.js",
        ...["scanner", "ownership", "executor", "verifier", "telemetry", "orchestrator"]
            .map((name) => `extension/runtime/${name}.js`)
    ].map(read).join("\n");
    assert.doesNotMatch(productionRuntime, /\bFORM_[AB]\b|formType\s*===\s*["'](?:FORM_)?[AB]["']/i);
});

test("ownership is the single veto for active candidate interaction", () => {
    const context = loadRuntime("extension/runtime/ownership.js");
    const ownership = context.JobHunterRuntimeOwnership.create();
    const element = {};
    assert.equal(ownership.canAutomate("field-1"), true);
    ownership.beginUserInteraction("field-1");
    assert.equal(ownership.canAutomate("field-1"), false);
    assert.equal(ownership.canAutomate("field-1", { force: true }), true);
    ownership.endUserInteraction("field-1");
    ownership.markUserEdited("field-1");
    assert.equal(ownership.isUserEdited("field-1"), true);
    ownership.withProgrammaticMutation(element, () => assert.equal(ownership.isProgrammatic(element), true));
    assert.equal(ownership.isProgrammatic(element), false);
});

test("scanner owns stable identity, element binding, and safe selector rebinding", () => {
    const context = loadRuntime("extension/runtime/scanner.js");
    const first = { id: "react-select-12-input", name: "candidate.email", isConnected: true, getAttribute: () => "" };
    const replacement = { id: "email", name: "candidate.email", type: "email", isConnected: true, getAttribute: () => "" };
    const scanner = context.JobHunterRuntimeScanner.create({
        deepQueryAll: (selector) => selector === "#email" ? [replacement] : [],
        visible: () => true,
        genericControlLabel: () => false
    });
    scanner.beginScan();
    const id = scanner.stableId(first, "email", "Email");
    scanner.bind(id, first);
    assert.equal(scanner.fieldIdForElement(first), id);
    assert.equal(scanner.control({ id }), first);
    first.isConnected = false;
    assert.equal(scanner.control({ id, selectorCandidates: ["#email"] }), replacement);
});

test("orchestrator serializes work and verifier independently confirms readback", async () => {
    const orchestratorContext = loadRuntime("extension/runtime/orchestrator.js");
    const lifecycle = [];
    const orchestrator = orchestratorContext.JobHunterRuntimeOrchestrator.create({
        timeoutMs: 100,
        isPaused: () => false,
        begin: (label) => lifecycle.push(`begin:${label}`),
        end: () => lifecycle.push("end")
    });
    let release;
    const first = orchestrator.run("one", () => new Promise((resolve) => { release = resolve; }));
    assert.equal(await orchestrator.run("two", async () => "unexpected"), null);
    release("done");
    assert.equal(await first, "done");
    assert.deepEqual(lifecycle, ["begin:one", "end"]);

    const verifierContext = loadRuntime("extension/runtime/verifier.js");
    const verifier = verifierContext.JobHunterRuntimeVerifier.create({
        delay: async () => {},
        selectedComboboxDisplay: () => "Gurugram, Haryana, India",
        optionMatchScore: (left, right) => left === right ? 4 : 0,
        textVerifyDelay: () => 0
    });
    const text = { value: "Lavish", type: "text", getAttribute: () => null, checkValidity: () => true };
    assert.equal(await verifier.verifyText(text, "Lavish"), true);
    const combo = { isConnected: true, getAttribute: () => null };
    assert.equal(await verifier.verifyCombobox(combo, "Gurugram, Haryana, India", "Gurugram, Haryana, India"), true);
});

test("entry points delegate stateful concerns to Phase 0G modules", () => {
    const content = read("extension/content.js");
    const background = read("extension/background.js");
    for (const owner of ["JobHunterRuntimeScanner", "JobHunterRuntimeOwnership", "JobHunterRuntimeExecutor", "JobHunterRuntimeVerifier", "JobHunterRuntimeTelemetry", "JobHunterRuntimeOrchestrator"]) {
        assert.match(content, new RegExp(`${owner}\\.create`));
    }
    assert.doesNotMatch(content, /fieldElementById|fieldIdByElement|programmaticChangeElements|userActiveFieldIds|fieldOperationIds/);
    assert.match(background, /JobHunterBackgroundApiClient\.create/);
    assert.match(background, /JobHunterBackgroundSessionStore\.create/);
    assert.match(background, /JobHunterBackgroundOutboxTransport\.create/);
});
