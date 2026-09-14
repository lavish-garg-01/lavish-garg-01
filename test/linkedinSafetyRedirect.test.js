import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveApplicationUrl } from "../src/utils/applicationUrl.js";

test("LinkedIn safety redirects open the embedded employer application directly", () => {
    const employer = "https://ats.rippling.com/alaan-careers/jobs/6dce30b8-9f8c-4e48-8433-68270a768d87?jobSite=LinkedIn";
    const wrapper = `https://www.linkedin.com/safety/go/?url=${encodeURIComponent(employer)}&urlhash=GjnM&isSdui=true`;
    assert.deepEqual(resolveApplicationUrl(wrapper), { url: employer, unwrapped: true, source: wrapper });
});

test("ordinary application URLs remain unchanged", () => {
    const employer = "https://iqvia.wd1.myworkdayjobs.com/en-US/IQVIA/job/123/apply";
    assert.deepEqual(resolveApplicationUrl(employer), { url: employer, unwrapped: false, source: null });
});

test("expired and unsafe LinkedIn redirect destinations fail clearly", () => {
    assert.throws(() => resolveApplicationUrl("https://www.linkedin.com/safety/go/?_l=en_US"), /expired|lost/i);
    const unsafe = `https://www.linkedin.com/safety/go/?url=${encodeURIComponent("javascript:alert(1)")}`;
    assert.throws(() => resolveApplicationUrl(unsafe), /unsafe/i);
});

test("extension navigation applies the same LinkedIn unwrap and scheme boundary", () => {
    const background = fs.readFileSync(path.resolve(import.meta.dirname, "../extension/background.js"), "utf8");
    assert.match(background, /function safeApplicationDestination/);
    assert.match(background, /original\.searchParams\.get\("url"\)/);
    assert.match(background, /LinkedIn redirect has expired/);
    assert.match(background, /\["http:", "https:"\]/);
    assert.match(background, /chrome\.tabs\.update\(sender\.tab\.id, \{ url: target, active: true \}\)/);
});
