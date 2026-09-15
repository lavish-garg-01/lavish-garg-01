import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";

const repoV2 = resolve(dirname(new URL(import.meta.url).pathname), "..");
const distPath = join(repoV2, "apps/extension/dist");
const reportDir = join(repoV2, ".local-data/qa/live-copilot-one-form");
const artifactDir = "/Users/mac/Library/Application Support/Cursor/AgentStores/cursor_agent_stores/bc-5090a185-094f-43cd-ac48-5187953e8d00/files/artifacts";
const webOrigin = "http://127.0.0.1:3000";
const jobNeedle = "SAP BTP Full Stack Developer";

const log: string[] = [];
function note(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  log.push(line);
  console.error(line);
}

async function waitFor<T>(read: () => Promise<T | null | false>, label: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
  return existing ?? context.waitForEvent("serviceworker", { timeout: 20_000 });
}

async function inspectForm(page: Page): Promise<unknown> {
  return page.evaluate(`(() => {
    const fields = [];
    const visit = (root) => {
      const nodes = root.querySelectorAll("input, textarea, select, [contenteditable=true], [role=combobox], [role=textbox]");
      for (const node of nodes) {
        const el = node;
        const type = (el.getAttribute("type") ?? el.tagName).toLowerCase();
        if (type === "hidden" || type === "password" || type === "submit" || type === "button") continue;
        const label = (el.getAttribute("aria-label")
          ?? el.getAttribute("placeholder")
          ?? el.closest("label")?.innerText
          ?? "").replace(/\\s+/g, " ").trim().slice(0, 80);
        const value = "value" in el ? String(el.value ?? "") : (el.textContent ?? "");
        const invalid = el.getAttribute("aria-invalid") === "true";
        const trimmed = value.trim();
        let kind = "short-text";
        if (!trimmed) kind = "empty";
        else if (/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) kind = "email-like";
        else if (/^https?:\\/\\//i.test(trimmed)) kind = "url";
        else if (trimmed.length > 40) kind = "long-text";
        fields.push({ tag: el.tagName, type, label, invalid, value: { empty: !trimmed, length: trimmed.length, kind } });
        if (el.shadowRoot) visit(el.shadowRoot);
      }
      for (const host of root.querySelectorAll("*")) {
        if (host.shadowRoot) visit(host.shadowRoot);
      }
    };
    visit(document);
    return { url: location.href, title: document.title, copilotHosts: document.querySelectorAll("[data-job-hunter-ui]").length, fieldCount: fields.length, fields: fields.slice(0, 80) };
  })()`);
}

async function shot(page: Page, name: string): Promise<string> {
  await mkdir(artifactDir, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  const file = `${name}.png`;
  const artifactPath = join(artifactDir, file);
  await page.screenshot({ path: artifactPath, fullPage: false });
  await page.screenshot({ path: join(reportDir, file), fullPage: false });
  return artifactPath;
}

const report: Record<string, unknown> = { ok: false, started: new Date().toISOString() };

try {
  await mkdir(reportDir, { recursive: true });
  const extensionCopy = join(reportDir, "extension");
  await cp(distPath, extensionCopy, { recursive: true });
  const manifestPath = join(extensionCopy, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { host_permissions?: string[] };
  const hosts = new Set(manifest.host_permissions ?? []);
  hosts.add("https://jobs.smartrecruiters.com/*");
  manifest.host_permissions = [...hosts];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  note(`Prepared test extension copy with SmartRecruiters host permission. Production dist was not modified.`);

  const profile = await mkdtemp(join(tmpdir(), "job-hunter-live-copilot-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extensionCopy}`, `--load-extension=${extensionCopy}`]
  });
  context.setDefaultTimeout(20_000);
  let worker: Worker | null = null;
  try {
    worker = await extensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    note(`Extension worker ${extensionId}`);
    report.extensionId = extensionId;

    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
    await shot(page, "live_copilot_01_dashboard_entry");

    const signIn = page.getByRole("button", { name: /Continue as local test user/i });
    if (await signIn.isVisible().catch(() => false)) {
      await signIn.click();
      note("Clicked local test user sign-in");
    }
    await page.waitForTimeout(2_000);
    if (await page.getByText("Let’s build the profile").isVisible().catch(() => false)) {
      report.blocker = "Local test user is still in onboarding; Jobs view not available.";
      await shot(page, "live_copilot_02_onboarding_blocker");
      throw new Error(String(report.blocker));
    }

    const jobsNav = page.getByRole("link", { name: /^Jobs$/ });
    if (await jobsNav.isVisible().catch(() => false)) await jobsNav.click();
    await page.waitForTimeout(1_000);

    const filters = page.getByRole("button", { name: /Search & filters/i });
    if (await filters.isVisible().catch(() => false)) await filters.click();
    const search = page.getByLabel("Search jobs");
    if (await search.isVisible().catch(() => false)) {
      await search.fill("SAP BTP");
      await page.getByRole("button", { name: "Find roles" }).click();
    }
    await waitFor(async () => page.getByRole("heading", { name: jobNeedle }).count().then((count) => count > 0 || null), "SAP BTP job card", 25_000);
    await page.getByRole("heading", { name: jobNeedle }).first().click();
    await shot(page, "live_copilot_02_job_detail");
    note("Opened Bosch SAP BTP job detail");

    const apply = page.getByRole("button", { name: /Apply with Copilot/i });
    await apply.click();
    note("Clicked Apply with Copilot");
    await page.waitForTimeout(2_500);
    await shot(page, "live_copilot_03_after_apply_click");

    const employer = await waitFor(async () => {
      const candidate = context.pages().find((item) => item.url().includes("smartrecruiters.com"));
      return candidate ?? null;
    }, "SmartRecruiters tab", 25_000);
    await employer.waitForLoadState("domcontentloaded");
    await employer.bringToFront();
    note(`Employer tab ${employer.url()}`);
    report.employerUrl = new URL(employer.url()).origin + new URL(employer.url()).pathname;
    await shot(employer, "live_copilot_04_employer_initial");

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForTimeout(1_000);
    report.sidepanelBefore = (await panel.locator("body").innerText()).slice(0, 2_000);
    await shot(panel, "live_copilot_05_sidepanel_initial");

    const allow = panel.getByRole("button", { name: /allow/i });
    if (await allow.isVisible().catch(() => false)) {
      await allow.click();
      note("Clicked side panel Allow site access");
      await panel.waitForTimeout(1_500);
    }

    note("Waiting 40s for unassisted Copilot");
    await employer.waitForTimeout(40_000);
    await employer.bringToFront();
    await shot(employer, "live_copilot_06_employer_after_wait");
    await panel.reload();
    await panel.waitForTimeout(1_000);
    report.sidepanelAfter = (await panel.locator("body").innerText()).slice(0, 2_500);
    await shot(panel, "live_copilot_07_sidepanel_after_wait");

    report.form = await inspectForm(employer);
    report.copilotHostCount = await employer.locator("[data-job-hunter-ui]").count();
    report.runtimes = await worker.evaluate(async () => {
      const stored = await chrome.storage.session.get(null);
      const keys = Object.keys(stored);
      const runtimes = stored["jobHunter.extension.runtimes.v1"];
      return { keys, runtimes };
    });
    report.ok = true;
  } finally {
    await context.close();
  }
} catch (error) {
  report.ok = false;
  report.error = error instanceof Error ? error.message : String(error);
  note(`FAILED ${report.error}`);
} finally {
  report.finished = new Date().toISOString();
  report.log = log;
  await mkdir(reportDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(reportDir, "report.json"), json);
  await writeFile(join(artifactDir, "live_copilot_one_form_report.json"), json);
  note(`Wrote report ok=${report.ok}`);
}

if (!report.ok) process.exitCode = 1;
