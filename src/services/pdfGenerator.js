import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { env } from "../config/environment.js";
import { renderResumeHtml, resolveTemplateId } from "./resumeRenderer.js";
import { loadMasterResume } from "./openai.js";
import { normalizeLineBreaks } from "../utils/textFormatting.js";

export { renderResumeHtml, resolveTemplateId, RESUME_TEMPLATES } from "./resumeRenderer.js";

const buildLocks = new Map();
export const MIN_RESUME_BODY_FONT_PT = 10;
export const MIN_RESUME_TEXT_RECALL = 0.98;

function workspaceDir(companyName, jobId) {
    const safeCompany = String(companyName || "company")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 48);
    const safeJobId = String(jobId || "job");
    return path.join(env.paths.output, `${safeCompany || "company"}-${safeJobId.slice(0, 8)}`);
}

async function launchBrowser() {
    const attempts = [
        () => chromium.launch({ headless: true }),
        () => chromium.launch({ headless: true, channel: "chrome" }),
        () => chromium.launch({ headless: true, channel: "chromium" })
    ];
    let lastError = null;
    for (const start of attempts) {
        try {
            return await start();
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("Could not launch a Chromium/Chrome browser for PDF rendering");
}

function pdfOptions() {
    return {
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        scale: 1,
        displayHeaderFooter: false,
        tagged: true,
        outline: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" }
    };
}

function normalizedTokens(value = "") {
    return String(value)
        .normalize("NFKC")
        .toLowerCase()
        .match(/[a-z0-9]+/g) || [];
}

function tokenRecall(expectedText, actualText) {
    const expected = normalizedTokens(expectedText);
    if (!expected.length) return 1;
    const counts = new Map();
    for (const token of normalizedTokens(actualText)) counts.set(token, (counts.get(token) || 0) + 1);
    let matched = 0;
    for (const token of expected) {
        const available = counts.get(token) || 0;
        if (!available) continue;
        matched += 1;
        counts.set(token, available - 1);
    }
    return Number((matched / expected.length).toFixed(4));
}

export async function inspectPdfBuffer(buffer, { sourceText = "" } = {}) {
    const loadingTask = getDocument({ data: new Uint8Array(buffer), disableWorker: true });
    const document = await loadingTask.promise;
    try {
        const textParts = [];
        const layoutPages = [];
        const fontSizes = [];
        let firstViewport = null;
        let tagged = true;

        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            if (!firstViewport) firstViewport = viewport;
            const [text, structure] = await Promise.all([page.getTextContent(), page.getStructTree()]);
            tagged = tagged && Boolean(structure);
            const positioned = [];
            for (const item of text.items) {
                if (typeof item.str !== "string") continue;
                if (item.str.trim() && Number.isFinite(item.height) && item.height > 0) {
                    fontSizes.push(item.height);
                }
                textParts.push(item.str);
                textParts.push(item.hasEOL ? "\n" : " ");
                if (item.str.trim()) positioned.push({
                    text: item.str.trim(),
                    x: Number(item.transform?.[4] || 0),
                    y: Number(item.transform?.[5] || 0)
                });
            }
            const lines = [];
            for (const item of positioned.sort((a, b) => b.y - a.y || a.x - b.x)) {
                let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
                if (!line) {
                    line = { y: item.y, items: [] };
                    lines.push(line);
                }
                line.items.push(item);
            }
            layoutPages.push(lines.sort((a, b) => b.y - a.y).map((line) => line.items
                .sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim())
                .filter(Boolean).join("\n"));
            if (pageNumber < document.numPages) textParts.push("\n");
        }

        const plainText = textParts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        const layoutText = layoutPages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
        const pageWidthMm = firstViewport ? (firstViewport.width * 25.4) / 72 : null;
        const pageHeightMm = firstViewport ? (firstViewport.height * 25.4) / 72 : null;
        const isA4 =
            pageWidthMm !== null &&
            pageHeightMm !== null &&
            Math.abs(pageWidthMm - 210) <= 2 &&
            Math.abs(pageHeightMm - 297) <= 2;

        return {
            pageSize: isA4 ? "A4" : "Custom",
            pageWidthMm: pageWidthMm === null ? null : Number(pageWidthMm.toFixed(2)),
            pageHeightMm: pageHeightMm === null ? null : Number(pageHeightMm.toFixed(2)),
            pageCount: document.numPages,
            pdfBytes: buffer.length,
            tagged,
            textLayerPresent: plainText.length > 0,
            plainText,
            layoutText,
            minFontPt: fontSizes.length ? Number(Math.min(...fontSizes).toFixed(2)) : null,
            pdfTextRecall: tokenRecall(sourceText, plainText)
        };
    } finally {
        await document.destroy();
    }
}

function pdfPostflightFailures(layout) {
    const failures = [];
    const minimumReadableFontPt = Number.isFinite(layout.profile?.minimumReadableFontPt)
        ? layout.profile.minimumReadableFontPt
        : MIN_RESUME_BODY_FONT_PT;
    if (layout.pageSize !== "A4") failures.push(`page size was ${layout.pageSize || "unknown"}`);
    if (layout.pageCount !== 1) failures.push(`rendered as ${layout.pageCount} page(s)`);
    if (!layout.tagged) failures.push("the PDF is not tagged");
    if (!layout.textLayerPresent) failures.push("the PDF has no selectable text layer");
    if (layout.minFontPt === null || layout.minFontPt < minimumReadableFontPt) {
        failures.push(
            layout.minFontPt === null
                ? "the smallest PDF font could not be measured"
                : `the smallest PDF text was ${layout.minFontPt} pt, below the ${minimumReadableFontPt} pt readable floor`
        );
    }
    if (layout.pdfTextRecall < MIN_RESUME_TEXT_RECALL) {
        failures.push(`PDF text recall was ${Math.round(layout.pdfTextRecall * 100)}%`);
    }
    return failures;
}

async function collectResumeDiagnostics(page) {
    await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        if (window.__resumeFit?.fit) await window.__resumeFit.fit();
    });
    await page.waitForFunction(() => window.__resumeFit?.ready === true, undefined, { timeout: 10000 });

    return page.evaluate(() => {
        const content = document.querySelector(".resume-content");
        const headings = [...document.querySelectorAll("h1, h2")].map((node) => node.textContent.trim());
        const links = [...document.querySelectorAll("a")].map((node) => ({
            text: node.textContent.trim(),
            href: node.getAttribute("href") || ""
        }));
        const metrics = window.__resumeFit?.metrics || {};
        return {
            ...metrics,
            headings,
            links,
            plainText: content?.innerText.trim() || "",
            hasSvg: Boolean(document.querySelector("svg")),
            hasTable: Boolean(document.querySelector("table")),
            hasImage: Boolean(document.querySelector("img, canvas")),
            hasMultiColumnLayout: [...document.querySelectorAll(".resume-content, .resume-section")].some((node) => {
                const style = getComputedStyle(node);
                const columns = style.gridTemplateColumns
                    .split(" ")
                    .filter((part) => part && part !== "none");
                return Number.parseInt(style.columnCount, 10) > 1 || columns.length > 1;
            })
        };
    });
}

async function renderResumeDocument(html, { includePdf = false, strict = false } = {}) {
    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
        await page.setContent(html, { waitUntil: "load" });
        await page.emulateMedia({ media: "print" });
        const domDiagnostics = await collectResumeDiagnostics(page);
        if (strict && (domDiagnostics.overflow || domDiagnostics.clipped)) {
            const error = new Error(
                "Resume content cannot fit safely on one A4 page. Shorten the summary or lowest-priority bullets."
            );
            error.code = "RESUME_OVERFLOW";
            error.layout = domDiagnostics;
            throw error;
        }
        const minimumReadableFontPt = Number.isFinite(domDiagnostics.profile?.minimumReadableFontPt)
            ? domDiagnostics.profile.minimumReadableFontPt
            : MIN_RESUME_BODY_FONT_PT;
        if (strict && domDiagnostics.minFontPt < minimumReadableFontPt) {
            const error = new Error(
                `Resume would require ${domDiagnostics.minFontPt} pt body text. Shorten lower-priority content to keep body text at ${minimumReadableFontPt} pt or larger.`
            );
            error.code = "RESUME_UNREADABLE";
            error.layout = domDiagnostics;
            throw error;
        }
        if (!includePdf) return { buffer: null, layout: domDiagnostics };

        const buffer = await page.pdf(pdfOptions());
        const pdfDiagnostics = await inspectPdfBuffer(buffer, { sourceText: domDiagnostics.plainText });
        const layout = {
            ...domDiagnostics,
            domMinFontPt: domDiagnostics.minFontPt,
            ...pdfDiagnostics,
            overflow: domDiagnostics.overflow || pdfDiagnostics.pageCount !== 1,
            clipped:
                domDiagnostics.clipped ||
                !pdfDiagnostics.textLayerPresent ||
                pdfDiagnostics.pdfTextRecall < MIN_RESUME_TEXT_RECALL
        };
        const postflightFailures = pdfPostflightFailures(layout);
        if (strict && (layout.clipped || postflightFailures.length)) {
            const failures = [...postflightFailures];
            if (layout.clipped && !failures.some((failure) => failure.includes("text layer") || failure.includes("recall"))) {
                failures.push("the rendered content was clipped");
            }
            const error = new Error(`Resume PDF postflight failed: ${failures.join("; ")}. No file was saved.`);
            error.code = "RESUME_POSTFLIGHT";
            error.layout = layout;
            throw error;
        }
        return { buffer, layout };
    } finally {
        if (browser) await browser.close();
    }
}

export async function inspectResumeHtml(html, { includePdf = false } = {}) {
    const result = await renderResumeDocument(html, { includePdf, strict: false });
    return result.layout;
}

export async function renderResumePdf(html, { strict = true } = {}) {
    return renderResumeDocument(html, { includePdf: true, strict });
}

function publishAssetBundle(files) {
    const operationId = randomUUID();
    const staged = files.map((file, index) => ({
        ...file,
        temporaryPath: `${file.path}.tmp-${operationId}-${index}`
    }));
    try {
        for (const directory of new Set(staged.map((file) => path.dirname(file.path)))) {
            fs.mkdirSync(directory, { recursive: true });
        }
        for (const file of staged) {
            fs.writeFileSync(file.temporaryPath, file.contents, file.encoding);
        }
        for (const file of staged) {
            fs.renameSync(file.temporaryPath, file.path);
        }
    } finally {
        for (const file of staged) {
            if (fs.existsSync(file.temporaryPath)) fs.unlinkSync(file.temporaryPath);
        }
    }
}

async function withBuildLock(key, build) {
    const previous = buildLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(build);
    buildLocks.set(key, current);
    try {
        return await current;
    } finally {
        if (buildLocks.get(key) === current) buildLocks.delete(key);
    }
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function coverLetterDate(date = new Date()) {
    return new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata"
    }).format(date);
}

export function renderCoverLetterHtml({ resume, job, coverLetter, date = new Date() }) {
    const cleanLetter = normalizeLineBreaks(coverLetter || "").trim();
    const company = job.company_name || job.company || "Hiring Company";
    const contact = [resume.email, resume.phone, resume.linkedin]
        .filter(Boolean)
        .map(escapeHtml)
        .join(" <span aria-hidden=\"true\">|</span> ");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(resume.fullName || "Candidate")} - Cover Letter</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #172033; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .cover-page {
      width: 210mm;
      height: 297mm;
      padding: 19mm 20mm 18mm;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .candidate-header {
      border-bottom: 1.5px solid #0f766e;
      padding-bottom: 5mm;
      margin-bottom: 7mm;
    }
    h1 { margin: 0 0 2.5mm; color: #12314d; font-size: 19pt; line-height: 1.08; }
    .contact { color: #475569; font-size: 9.75pt; line-height: 1.45; overflow-wrap: anywhere; }
    .date { margin: 0 0 5mm; color: #334155; font-size: 10.5pt; }
    .recipient { margin-bottom: 6mm; font-size: 10.5pt; line-height: 1.45; }
    .recipient strong { color: #12314d; }
    .letter-body {
      flex: 1 1 auto;
      min-height: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 10.75pt;
      line-height: 1.52;
      overflow: visible;
    }
  </style>
</head>
<body>
  <main class="cover-page">
    <header class="candidate-header">
      <h1>${escapeHtml(resume.fullName || "Candidate")}</h1>
      <div class="contact">${contact}</div>
    </header>
    <p class="date">${escapeHtml(coverLetterDate(date))}</p>
    <div class="recipient"><strong>Hiring Team</strong><br />${escapeHtml(company)}</div>
    <section class="letter-body">${escapeHtml(cleanLetter)}</section>
  </main>
</body>
</html>`;
}

async function renderCoverLetterPdf(html, sourceText) {
    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
        await page.setContent(html, { waitUntil: "load" });
        await page.emulateMedia({ media: "print" });
        const fit = await page.evaluate(() => {
            const body = document.querySelector(".letter-body");
            let fontPt = 10.75;
            while (body.scrollHeight > body.clientHeight + 1 && fontPt > 9.75) {
                fontPt = Math.max(9.75, fontPt - 0.25);
                body.style.fontSize = `${fontPt}pt`;
                body.style.lineHeight = fontPt <= 10 ? "1.42" : "1.48";
            }
            return { fontPt, overflow: body.scrollHeight > body.clientHeight + 1 };
        });
        if (fit.overflow) {
            throw new Error("Cover letter is too long to fit legibly on one A4 page");
        }

        const buffer = await page.pdf(pdfOptions());
        const layout = await inspectPdfBuffer(buffer, { sourceText });
        if (layout.pageCount !== 1 || !layout.textLayerPresent || layout.pdfTextRecall < MIN_RESUME_TEXT_RECALL) {
            throw new Error(
                `Cover letter PDF validation failed: pages=${layout.pageCount}, text recall=${Math.round(layout.pdfTextRecall * 100)}%`
            );
        }
        return { buffer, layout: { ...layout, bodyFontPt: fit.fontPt } };
    } finally {
        if (browser) await browser.close();
    }
}

export async function generateCoverLetterPdf({ job, coverLetter, companyName }) {
    const cleanLetter = normalizeLineBreaks(coverLetter || "").trim();
    if (!cleanLetter) throw new Error("No cover letter has been generated for this job");

    const resume = loadMasterResume();
    const dir = path.join(
        env.paths.output,
        "pdf",
        path.basename(workspaceDir(companyName || job.company_name, job.id))
    );
    const pdfPath = path.join(dir, "cover-letter.pdf");
    const html = renderCoverLetterHtml({ resume, job, coverLetter: cleanLetter });
    const rendered = await withBuildLock(`${dir}:cover-letter`, () => renderCoverLetterPdf(html, cleanLetter));
    publishAssetBundle([{ path: pdfPath, contents: rendered.buffer }]);
    return { path: pdfPath, layout: rendered.layout };
}

export async function generateApplicationAssets({
    job,
    coverLetter,
    resumeModifications,
    companyName,
    templateId
}) {
    const resume = loadMasterResume();
    const modifications =
        typeof resumeModifications === "string"
            ? JSON.parse(resumeModifications || "{}")
            : resumeModifications || {};
    const template = resolveTemplateId(templateId || job.resume_template);

    const dir = workspaceDir(companyName, job.id);
    const htmlPath = path.join(dir, `resume-${template}.html`);
    const pdfPath = path.join(dir, `resume-${template}.pdf`);
    const coverPath = path.join(dir, "cover_letter.txt");
    const outreachPath = path.join(dir, "outreach_email.txt");
    const linkedinNotePath = path.join(dir, "linkedin_outreach_note.txt");
    const linkedinCuriosityPath = path.join(dir, "linkedin_outreach_curiosity.txt");

    const html = renderResumeHtml(resume, modifications, { templateId: template });

    let pdfError = null;
    let layout = null;
    let assetsPublished = false;
    try {
        layout = await withBuildLock(dir, async () => {
            const rendered = await renderResumePdf(html, { strict: true });
            publishAssetBundle([
                { path: htmlPath, contents: html, encoding: "utf8" },
                { path: pdfPath, contents: rendered.buffer },
                { path: coverPath, contents: normalizeLineBreaks(coverLetter || ""), encoding: "utf8" },
                {
                    path: outreachPath,
                    contents: normalizeLineBreaks(modifications.outreachEmail || ""),
                    encoding: "utf8"
                },
                {
                    path: linkedinNotePath,
                    contents: normalizeLineBreaks(modifications.linkedinOutreachNote || ""),
                    encoding: "utf8"
                },
                {
                    path: linkedinCuriosityPath,
                    contents: normalizeLineBreaks(modifications.linkedinOutreachCuriosity || ""),
                    encoding: "utf8"
                }
            ]);
            return rendered.layout;
        });
        assetsPublished = true;
    } catch (error) {
        pdfError = error;
        console.error("[pdfGenerator] Playwright PDF failed:", error.message);
        layout = error.layout || null;
    }

    return {
        directory: dir,
        resumeHtmlPath: assetsPublished ? htmlPath : null,
        resumePdfPath: assetsPublished ? pdfPath : null,
        coverLetterPath: assetsPublished ? coverPath : null,
        outreachPath: assetsPublished ? outreachPath : null,
        linkedinNotePath: assetsPublished ? linkedinNotePath : null,
        linkedinCuriosityPath: assetsPublished ? linkedinCuriosityPath : null,
        pdfError: assetsPublished ? null : pdfError?.message || "PDF was not written",
        templateId: template,
        layout
    };
}
