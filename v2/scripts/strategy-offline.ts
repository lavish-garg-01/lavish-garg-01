import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { DefinitionSchema, digest, type Definition, type OfflineProof, type StrategyIntelligenceService } from "@job-hunter-v2/strategy-intelligence";

/** Runs actual K mechanisms + independent verifier in a fresh browser, never AI self-evaluation. */
export async function validateStrategyOffline(raw: Definition, reviewedBy: string, q: StrategyIntelligenceService): Promise<OfflineProof> {
  const definition = DefinitionSchema.parse(raw);
  if (!definition.capabilities.every((c) => ["NATIVE_TEXT", "NATIVE_TEXTAREA"].includes(c)) || !definition.representations.every((r) => r === "TEXT")) throw new Error("Q_OFFLINE_SUITE_UNSUPPORTED_CAPABILITY");
  const bundled = await build({ entryPoints: [new URL("../apps/extension/src/testing/strategy-fixture.ts", import.meta.url).pathname], bundle: true, write: false, format: "iife", platform: "browser" });
  const browser = await chromium.launch({ headless: true });
  try {
    const errors: string[] = [];
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (entry) => { if (entry.type() === "error") errors.push(entry.text()); });
    await page.route("**/*", (route) => route.request().url() === "https://q-fixture.test/"
      ? route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" }) : route.abort());
    await page.goto("https://q-fixture.test/");
    await page.addScriptTag({ content: bundled.outputFiles[0]!.text });
    const checks: OfflineProof["checks"] = { targetOnly: false, events: false, verifier: false, rerender: false,
      failure: false, bounded: false, userIntervention: false, dynamic: false, declaration: false, deduplication: false, regression: false, browser: true };
    for (const scenario of ["normal", "textarea", "react", "rerender", "revert", "disabled", "ownership", "interrupt", "graph", "navigation", "outside", "dynamic", "declaration", "duplicate", "fallback", "expired"]) {
      const result = await page.evaluate(async ({ plan, scenario }) => {
        const runtime = globalThis as unknown as { strategyFixture: (plan: unknown, scenario: string) => Promise<{
          status: string; failure: string; targetMatches: boolean; unrelatedUntouched: boolean; consentUntouched: boolean; submitted: boolean;
          elapsed: number; events: string[]; duplicateEvents: number; structuralChange: boolean;
          attempts: Array<{ key: string; verified: string; safety: string | null }>
        }> };
        return runtime.strategyFixture(plan, scenario);
      }, { plan: definition.plan, scenario });
      assert.ok((scenario === "outside" || result.unrelatedUntouched) && result.consentUntouched && !result.submitted, scenario + ": target isolation");
      assert.ok(result.elapsed < 2000, scenario + ": bounded execution");
      if (["normal", "textarea", "react", "rerender", "dynamic", "duplicate", "fallback"].includes(scenario)) assert.ok(result.status === "VERIFIED" && result.targetMatches, scenario + ": independent readback");
      else assert.notEqual(result.status, "VERIFIED", scenario + ": fail closed");
      if (scenario === "normal") { assert.ok(result.events.includes("input") && result.events.includes("change")); checks.events = checks.verifier = checks.targetOnly = true; }
      if (scenario === "rerender") checks.rerender = true;
      if (scenario === "revert") checks.failure = true;
      if (scenario === "interrupt") checks.userIntervention = true;
      if (scenario === "dynamic") { assert.equal(result.structuralChange, true); checks.dynamic = true; }
      if (scenario === "declaration") { assert.equal(result.events.length, 0); checks.declaration = true; }
      if (scenario === "duplicate") { assert.equal(result.duplicateEvents, 0); checks.deduplication = true; }
      if (scenario === "fallback") {
        assert.equal(result.attempts.length, 2); assert.equal(result.attempts[0]?.verified, "FAILED");
        assert.equal(result.attempts[1]?.key, "NATIVE_VALUE_SETTER@1"); assert.equal(result.attempts[1]?.verified, "VERIFIED");
      }
      if (scenario === "outside") assert.equal(result.attempts[0]?.safety, "OUTSIDE_TARGET");
      if (scenario === "expired") assert.equal(result.events.length, 0);
    }
    assert.deepEqual(errors, []);
    checks.bounded = checks.regression = true;
    const unsigned = { definitionHash: digest(definition), suiteVersion: "Q_FIXTURES@1", checks, reviewedBy, checkedAt: new Date().toISOString() };
    return { ...unsigned, attestation: q.attestProof(unsigned) };
  } finally { await browser.close(); }
}
