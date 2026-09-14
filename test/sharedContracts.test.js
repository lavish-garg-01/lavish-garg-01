import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { canonicalContractJson, stableContractHash } from "../src/contracts/contractPrimitives.js";
import { parseSharedContract } from "../src/contracts/sharedContracts.js";
import { validSharedContractFixtures } from "./fixtures/shared-contract-fixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function browserContracts() {
    const source = fs.readFileSync(path.join(root, "extension/contracts/shared-contract-validator.js"), "utf8");
    const sandbox = {
        TextEncoder, URL, Date, Set, Number, Object, Array, JSON, TypeError,
        crypto: crypto.webcrypto, Uint8Array
    };
    vm.runInNewContext(source, sandbox, { filename: "shared-contract-validator.js" });
    return sandbox.JobHunterSharedContracts;
}

function copy(value) {
    return structuredClone(value);
}

test("backend and extension accept the same Phase 0B golden contract corpus", () => {
    const browser = browserContracts();
    for (const [name, fixture] of Object.entries(validSharedContractFixtures)) {
        assert.equal(parseSharedContract(name, fixture).success, true, `${name} backend`);
        assert.equal(browser.validate(name, fixture).success, true, `${name} extension`);
    }
});

test("backend and extension fail closed on unknown versions and unknown fields", () => {
    const browser = browserContracts();
    for (const [name, fixture] of Object.entries(validSharedContractFixtures)) {
        const future = { ...copy(fixture), schemaVersion: 99 };
        assert.equal(parseSharedContract(name, future).reasonCode, "UNSUPPORTED_SCHEMA_VERSION", `${name} backend version`);
        assert.equal(browser.validate(name, future).reasonCode, "UNSUPPORTED_SCHEMA_VERSION", `${name} extension version`);

        const expanded = { ...copy(fixture), unexpected: true };
        assert.equal(parseSharedContract(name, expanded).success, false, `${name} backend unknown field`);
        assert.equal(browser.validate(name, expanded).success, false, `${name} extension unknown field`);
    }
});

test("semantic and shared telemetry contracts cannot carry raw or protected values", () => {
    const browser = browserContracts();
    const semantic = { ...copy(validSharedContractFixtures.FieldSemanticResult), value: "candidate answer" };
    assert.equal(parseSharedContract("FieldSemanticResult", semantic).success, false);
    assert.equal(browser.validate("FieldSemanticResult", semantic).success, false);

    const telemetry = copy(validSharedContractFixtures.TelemetryEnvelope);
    telemetry.dimensions.email = "candidate@example.com";
    assert.equal(parseSharedContract("TelemetryEnvelope", telemetry).success, false);
    assert.equal(browser.validate("TelemetryEnvelope", telemetry).success, false);

    const protocol = copy(validSharedContractFixtures.ExtensionProtocolEnvelope);
    protocol.payload = { password: "do-not-transport" };
    assert.equal(parseSharedContract("ExtensionProtocolEnvelope", protocol).reasonCode, "PROTECTED_VALUE_FORBIDDEN");
    assert.equal(browser.validate("ExtensionProtocolEnvelope", protocol).reasonCode, "PROTECTED_VALUE_FORBIDDEN");

    const evidence = copy(validSharedContractFixtures.EvidenceUpdate);
    evidence.subjectKey = "My current salary is 24 LPA";
    assert.equal(parseSharedContract("EvidenceUpdate", evidence).success, false);
    assert.equal(browser.validate("EvidenceUpdate", evidence).success, false);
});

test("protocol and telemetry enforce serialized size limits", () => {
    const browser = browserContracts();
    const oversized = copy(validSharedContractFixtures.ExtensionProtocolEnvelope);
    oversized.payload = { text: "x".repeat(65 * 1024) };
    assert.equal(parseSharedContract("ExtensionProtocolEnvelope", oversized).success, false);
    assert.equal(browser.validate("ExtensionProtocolEnvelope", oversized).success, false);
});

test("canonical JSON and SHA-256 are stable across object key order", async () => {
    const browser = browserContracts();
    const left = { z: [3, { b: true, a: "x" }], a: 1 };
    const right = { a: 1, z: [3, { a: "x", b: true }] };
    assert.equal(canonicalContractJson(left), canonicalContractJson(right));
    assert.equal(stableContractHash(left), stableContractHash(right));
    assert.equal(await browser.stableContractHash(left), stableContractHash(left));
});

test("normalized money uses exact decimals and never floating-point truth", () => {
    const browser = browserContracts();
    for (let index = 0; index < 50; index += 1) {
        const value = {
            schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MONEY",
            amountExact: `${index * 1000}.${String(index % 100).padStart(2, "0")}`,
            currency: index % 2 ? "INR" : "USD", period: index % 3 ? "YEAR" : "MONTH"
        };
        assert.equal(parseSharedContract("NormalizedValue", value).success, true);
        assert.equal(browser.validate("NormalizedValue", value).success, true);
    }
    const floating = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MONEY", amountExact: 249.1, currency: "INR", period: "MONTH" };
    assert.equal(parseSharedContract("NormalizedValue", floating).success, false);
    assert.equal(browser.validate("NormalizedValue", floating).success, false);
});

test("normalized durations, dates, phones and multi-enums share browser/backend rules", () => {
    const browser = browserContracts();
    const values = [
        { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DURATION", months: 56 },
        { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DATE", value: { isoDate: "2026-08-30", precision: "DAY" } },
        { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "PHONE", countryCode: "+91", nationalNumber: "9876543210", extension: null },
        { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "MULTI_ENUM", values: [{ key: "node", label: "Node.js" }, { key: "postgres", label: "PostgreSQL" }] }
    ];
    for (const value of values) {
        assert.equal(parseSharedContract("NormalizedValue", value).success, true);
        assert.equal(browser.validate("NormalizedValue", value).success, true);
    }
    for (const invalid of [
        { ...values[0], months: 1201 },
        { ...values[1], value: { isoDate: "2026-02-30", precision: "DAY" } },
        { ...values[2], nationalNumber: "12" },
        { ...values[3], values: [{ key: "node", label: "Node" }, { key: "node", label: "Node.js" }] }
    ]) {
        assert.equal(parseSharedContract("NormalizedValue", invalid).success, false);
        assert.equal(browser.validate("NormalizedValue", invalid).success, false);
    }
});

test("extension validator is generated from the checked-in browser template", () => {
    const generated = fs.readFileSync(path.join(root, "extension/contracts/shared-contract-validator.js"), "utf8");
    assert.match(generated, /Generated from src\/contracts\/browserValidatorTemplate\.js/);
    assert.match(generated, /JobHunterSharedContracts/);
});
