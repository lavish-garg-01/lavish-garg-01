import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

// An isolated, fictional account. No live profile writes or employer traffic.
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {App} from './apps/web/src/App.tsx'; createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "fictional-auth", setup(builder) {
  builder.onResolve({ filter: /^\.\/auth\.js$/ }, () => ({ path: "auth", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const developmentAuthEnabled=false; export const authClient={session:async()=>({accessToken:'fictional-token',email:'asha@example.test'}),subscribe:()=>()=>{},signOut:async()=>{}};` }));
} }] });
const job = { id: "40000000-0000-4000-8000-000000000001", title: "Backend Engineer", company: "Example Labs", location: "Bengaluru, India", countryCodes: ["IN"], workMode: "HYBRID", roleFamily: "BACKEND", seniority: "MID", employmentType: "FULL_TIME", compensation: null, skills: { required: [{ key: "typescript", label: "TypeScript" }], preferred: [] }, applicationUrl: "https://employer.example.test/application", ats: "ASHBY", freshness: { state: "FRESH", verifiedAt: null }, match: { score: 82, label: "STRONG_MATCH", eligibility: "ELIGIBLE", reasons: [{ code: "SKILLS_MATCH", message: "Your TypeScript experience matches this role.", evidence: [] }], gaps: [], unknowns: [], policyVersion: "1" }, description: "Build backend services with TypeScript." };
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().url().startsWith("https://workspace.example.test/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    const data: Record<string, unknown> = {
      "/v1/auth/bootstrap": { email: "asha@example.test", onboarding: { completed: true, stage: "READY", version: 1 } },
      "/v1/jobs": { items: [job, { ...job, id: "40000000-0000-4000-8000-000000000002", company: "Example Systems", title: "Platform Engineer" }], nextCursor: null },
      "/v1/job-search/profile": { version: 1, preferences: { targetRoleFamilies: [], preferredCountryCodes: [], excludedCompanyNames: [], preferredWorkModes: [], dealBreakers: {} } },
      "/v1/profile": { answers: [], onboardingCompleted: true, onboardingVersion: 1 },
      "/v1/onboarding/readiness": { ready: false, conflicts: 0, requirements: [{ key: "PHONE", label: "Phone number", met: false, blocking: true, reason: "Add your contact number." }] },
      "/v1/profile/history": { entries: [] },
      "/v1/documents": { documents: [{ id: "50000000-0000-4000-8000-000000000001", type: "MASTER_RESUME", version: 1, status: "READY", fileName: "Asha-backend-resume.pdf", isCurrentMaster: true, uses: [], createdAt: "2026-09-11T00:00:00Z" }] }
    };
    return route.fulfill({ status: path in data ? 200 : 404, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type" }, body: JSON.stringify(data[path] ?? {}) });
  });
  await page.goto("https://workspace.example.test/");
  await page.addStyleTag({ path: "apps/web/src/styles.css" });
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.getByRole("heading", { name: "Find your next role." }).waitFor();
  assert.equal(await page.locator(".job-card").count(), 2);
  assert.equal(await page.locator(".job-card.selected").count(), 1, "First result is preselected");
  assert.equal(await page.getByRole("textbox", { name: "Search jobs" }).isVisible(), false);
  await page.locator(".job-card").nth(1).getByText("Example Systems", { exact: true }).click();
  await page.locator(".job-detail").getByRole("heading", { name: "Platform Engineer" }).waitFor();
  await page.getByRole("button", { name: "Search & filters" }).click();
  assert.equal(await page.getByRole("textbox", { name: "Search jobs" }).isVisible(), true);
  await page.getByRole("button", { name: "Hide filters" }).click();
  await mkdir(".local-data/qa", { recursive: true });
  await page.screenshot({ path: ".local-data/qa/workspace-jobs-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "View match details" }).first().click();
  await page.getByRole("heading", { name: "About the role", exact: true }).waitFor();
  await page.screenshot({ path: ".local-data/qa/workspace-job-detail-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Your match", exact: true }).click();
  await page.getByRole("heading", { name: "Why it fits" }).waitFor();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("heading", { name: "Application documents" }).waitFor();
  assert.ok(await page.locator(".job-detail").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "document controls must fit the detail pane");
  await page.getByRole("button", { name: "Close job details" }).click();
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await page.getByRole("heading", { name: "A résumé for every opportunity." }).waitFor();
  await page.getByText("Asha-backend-resume.pdf").waitFor();
  await page.getByRole("link", { name: "Attention", exact: true }).click();
  await page.getByRole("heading", { name: "1 profile gaps" }).waitFor();
  await page.screenshot({ path: ".local-data/qa/workspace-attention-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await page.getByRole("heading", { name: "A little setup. A lot less typing." }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await page.getByRole("heading", { name: "Find your next role." }).waitFor();
  await page.locator(".job-card").first().waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile must not overflow");
  await page.screenshot({ path: ".local-data/qa/workspace-jobs-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "View match details" }).first().click();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile documents must not overflow");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: ".local-data/qa/workspace-job-documents-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: V1-style jobs, split-pane About/Match/Documents, document controls, attention, profile, hash navigation, desktop/mobile width and no browser errors");
} finally { await browser.close(); }
