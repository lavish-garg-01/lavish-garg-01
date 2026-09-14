const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const DEFAULT_MIN_READABLE_FONT_PT = 10;
const MIN_SAFE_MARGIN_MM = 12;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
    return typeof value === "boolean" ? value : null;
}

function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function keywordLabel(value) {
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (!value || typeof value !== "object") return "";
    return String(value.skill || value.keyword || value.label || value.name || "").trim();
}

function stringList(value) {
    if (Array.isArray(value)) return value.map(keywordLabel).filter(Boolean);
    if (typeof value !== "string") return [];
    return value
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

/** Canonical form used for token-boundary keyword comparisons. */
function canonicalText(value = "") {
    return String(value)
        .normalize("NFKC")
        .toLowerCase()
        .replace(/c\+\+/g, " cplusplus ")
        .replace(/c#/g, " csharp ")
        .replace(/\.net\b/g, " dotnet ")
        .replace(/\bnode(?:\s|\.)?js\b/g, " nodejs ")
        .replace(/\bexpress(?:\s|\.)?js\b/g, " expressjs ")
        .replace(/\bnext(?:\s|\.)?js\b/g, " nextjs ")
        .replace(/\breact(?:\s|\.)?js\b/g, " reactjs ")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function containsPhrase(canonicalHaystack, value) {
    const needle = canonicalText(value);
    return Boolean(needle) && ` ${canonicalHaystack} `.includes(` ${needle} `);
}

function uniqueKeywords(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const label = keywordLabel(value);
        const key = canonicalText(label);
        if (!label || !key || seen.has(key)) continue;
        seen.add(key);
        result.push(label);
    }
    return result;
}

function fallbackPlainText(resume, modifications) {
    const roles = Array.isArray(resume.experience) ? resume.experience : [];
    const education = Array.isArray(resume.education) ? resume.education : [];
    const projects = Array.isArray(resume.projects) ? resume.projects : [];
    const skillGroups = resume.skillGroups && typeof resume.skillGroups === "object"
        ? Object.values(resume.skillGroups).flat()
        : [];
    const roleText = roles.flatMap((role) => [
        role.title,
        role.company,
        ...(Array.isArray(role.bullets) ? role.bullets : [])
    ]);
    const educationText = education.flatMap((entry) => [entry.degree, entry.school]);
    const projectText = projects.flatMap((project) => [
        project.name,
        ...(Array.isArray(project.bullets) ? project.bullets : [])
    ]);

    return [
        resume.fullName,
        resume.email,
        resume.phone,
        resume.linkedin,
        modifications.resumeSummary || resume.summary,
        ...skillGroups,
        ...stringList(resume.skills),
        ...roleText,
        ...educationText,
        ...projectText
    ]
        .filter(Boolean)
        .join("\n")
        .trim();
}

function makeFit(diagnostics) {
    const pageWidthMm = finiteNumber(diagnostics.pageWidthMm);
    const pageHeightMm = finiteNumber(diagnostics.pageHeightMm);
    const dimensionsAreA4 =
        pageWidthMm !== null &&
        pageHeightMm !== null &&
        Math.abs(pageWidthMm - A4_WIDTH_MM) <= 2 &&
        Math.abs(pageHeightMm - A4_HEIGHT_MM) <= 2;
    const pageSize = diagnostics.pageSize || (dimensionsAreA4 ? "A4" : null);
    const pageCount = finiteNumber(diagnostics.pageCount);
    const fillPercent = finiteNumber(diagnostics.fillPercent);
    const minFontPt = finiteNumber(diagnostics.minFontPt);
    const marginMm = finiteNumber(diagnostics.marginMm);
    const pdfBytes = finiteNumber(diagnostics.pdfBytes);
    const pdfTextRecall = finiteNumber(diagnostics.pdfTextRecall);
    const profile = parseObject(diagnostics.profile);
    const configuredMinimumReadableFontPt = finiteNumber(profile.minimumReadableFontPt);
    const minimumReadableFontPt =
        configuredMinimumReadableFontPt !== null && configuredMinimumReadableFontPt > 0
            ? configuredMinimumReadableFontPt
            : DEFAULT_MIN_READABLE_FONT_PT;

    return {
        pageSize,
        pageCount: pageCount === null ? null : Math.max(0, Math.round(pageCount)),
        fillPercent: fillPercent === null ? null : Math.max(0, Math.round(fillPercent)),
        overflow: booleanOrNull(diagnostics.overflow),
        clipped: booleanOrNull(diagnostics.clipped),
        minFontPt: minFontPt === null ? null : Math.round(minFontPt * 100) / 100,
        marginMm: marginMm === null ? null : Math.round(marginMm * 100) / 100,
        pdfBytes: pdfBytes === null ? null : Math.max(0, Math.round(pdfBytes)),
        tagged: booleanOrNull(diagnostics.tagged),
        textLayerPresent: booleanOrNull(diagnostics.textLayerPresent),
        pdfTextRecall: pdfTextRecall === null ? null : clamp(pdfTextRecall, 0, 1),
        minimumReadableFontPt: Math.round(minimumReadableFontPt * 100) / 100
    };
}

function readinessLabel(score) {
    if (score >= 90) return "Excellent readiness";
    if (score >= 80) return "Strong readiness";
    if (score >= 70) return "Good with minor fixes";
    if (score >= 55) return "Needs attention";
    return "High-risk resume file";
}

function jobMatchLabel(score, keywordCount) {
    if (!keywordCount) return "No target keywords available";
    if (score >= 85) return "High keyword coverage";
    if (score >= 70) return "Strong keyword coverage";
    if (score >= 50) return "Moderate keyword coverage";
    return "Low keyword coverage";
}

function checkResult(id, status, title, detail, suggestion, earned, weight) {
    return { id, status, title, detail, suggestion, earned, weight };
}

function publicCheck({ earned: _earned, weight: _weight, ...check }) {
    return check;
}

/**
 * Produces a deterministic resume-file and keyword-readiness report.
 * This is a transparent heuristic, not a prediction for every employer ATS.
 */
export function analyzeResumeReadiness({
    resume = {},
    modifications = {},
    job = {},
    templateId = "classic",
    diagnostics = {}
} = {}) {
    const safeResume = parseObject(resume);
    const safeModifications = parseObject(modifications);
    const safeJob = parseObject(job);
    const safeDiagnostics = parseObject(diagnostics);
    const analysis = parseObject(safeJob.ai_analysis);
    const fit = makeFit(safeDiagnostics);
    const extractedText = String(safeDiagnostics.plainText || "").trim();
    const hasPdfTextDiagnostics = fit.textLayerPresent !== null || fit.pdfTextRecall !== null;
    const plainText = hasPdfTextDiagnostics
        ? extractedText
        : extractedText || fallbackPlainText(safeResume, safeModifications);
    const canonicalResume = canonicalText(plainText);
    const noSelectableText =
        fit.textLayerPresent === false ||
        fit.pdfTextRecall === 0 ||
        (hasPdfTextDiagnostics && !extractedText);
    const incompletePdfText =
        !noSelectableText && fit.pdfTextRecall !== null && fit.pdfTextRecall < 0.98;

    const targetKeywords = uniqueKeywords([
        ...stringList(safeModifications.keywordsToEmphasize),
        ...stringList(analysis.matchedSkills),
        ...stringList(analysis.missingSkills)
    ]);
    const matched = targetKeywords.filter((keyword) => containsPhrase(canonicalResume, keyword));
    const missing = targetKeywords.filter((keyword) => !containsPhrase(canonicalResume, keyword));
    const jobMatchScore = targetKeywords.length
        ? clamp(Math.round((matched.length / targetKeywords.length) * 100), 0, 100)
        : null;
    const jobMatch = {
        score: jobMatchScore,
        label: jobMatchLabel(jobMatchScore, targetKeywords.length),
        matched,
        missing
    };

    const scoredChecks = [];
    const hasMultiColumn = Boolean(safeDiagnostics.hasMultiColumnLayout);
    const hasTable = Boolean(safeDiagnostics.hasTable);
    const hasImage = Boolean(safeDiagnostics.hasImage);
    const hasSvg = Boolean(safeDiagnostics.hasSvg);
    const pdfTooLarge = fit.pdfBytes !== null && fit.pdfBytes > 2_500_000;
    const pdfTextDiagnosticsUnavailable = fit.textLayerPresent === null || fit.pdfTextRecall === null;
    let parserPoints = 15;
    if (hasMultiColumn) parserPoints -= 8;
    if (hasTable) parserPoints -= 4;
    if (hasImage) parserPoints -= 4;
    if (hasSvg) parserPoints -= 2;
    if (fit.tagged === false) parserPoints -= 2;
    if (pdfTooLarge) parserPoints -= 5;
    if (incompletePdfText) parserPoints -= 8;
    if (pdfTextDiagnosticsUnavailable) parserPoints -= 5;
    if (noSelectableText) parserPoints = 0;
    parserPoints = clamp(parserPoints, 0, 15);
    const parserRisks = [
        noSelectableText ? "no selectable PDF text layer" : "",
        incompletePdfText
            ? `only ${Math.round(fit.pdfTextRecall * 100)}% of source text recovered from the PDF`
            : "",
        pdfTextDiagnosticsUnavailable ? "PDF text-layer postflight unavailable" : "",
        hasMultiColumn ? "multi-column reading order" : "",
        hasTable ? "table-based layout" : "",
        hasImage ? "image or canvas content" : "",
        hasSvg ? "SVG decoration" : "",
        fit.tagged === false ? "untagged PDF" : "",
        pdfTooLarge ? "PDF larger than 2.5 MB" : ""
    ].filter(Boolean);
    const parserStatus =
        noSelectableText || incompletePdfText || hasMultiColumn || hasTable || hasImage || pdfTooLarge
        ? "fail"
        : parserRisks.length
          ? "warning"
          : "pass";
    scoredChecks.push(
        checkResult(
            "parser-structure",
            parserStatus,
            "Parser-safe structure",
            parserRisks.length
                ? `Potential parsing risks: ${parserRisks.join(", ")}.`
                : `The final PDF has selectable text with ${Math.round(fit.pdfTextRecall * 100)}% source-text recall${fit.tagged === true ? ", a tagged structure" : ""}, and a simple single-column layout.`,
            parserRisks.length
                ? "Regenerate the PDF with a complete selectable text layer; use one column and remove parser-risk layout elements."
                : "Keep validating the generated PDF bytes, not only the source HTML.",
            parserPoints,
            15
        )
    );

    const diagnosticHeadings = !hasPdfTextDiagnostics && Array.isArray(safeDiagnostics.headings)
        ? safeDiagnostics.headings.map((heading) => canonicalText(heading)).filter(Boolean)
        : [];
    const lineHeadings = plainText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && line.length <= 64)
        .map(canonicalText);
    const headings = diagnosticHeadings.length ? diagnosticHeadings : lineHeadings;
    const expectedSections = [
        { name: "Summary", test: /\b(summary|professional profile)\b/ },
        { name: "Skills", test: /\b(skills|core competencies|technical competencies)\b/ },
        { name: "Experience", test: /\b(experience|employment history|work history)\b/ },
        { name: "Education", test: /\b(education|academic background)\b/ }
    ];
    const missingSections = expectedSections
        .filter((section) => !headings.some((heading) => section.test.test(heading)))
        .map((section) => section.name);
    const sectionRatio = (expectedSections.length - missingSections.length) / expectedSections.length;
    scoredChecks.push(
        checkResult(
            "standard-sections",
            missingSections.length === 0 ? "pass" : missingSections.length <= 1 ? "warning" : "fail",
            "Standard section headings",
            missingSections.length
                ? `Missing or non-standard headings: ${missingSections.join(", ")}.`
                : "Summary, Skills, Experience, and Education headings are present.",
            missingSections.length
                ? "Use conventional section names so parsers can classify the content reliably."
                : "Keep these conventional headings unchanged.",
            15 * sectionRatio,
            15
        )
    );

    const email = String(safeResume.email || "").trim();
    const phoneDigits = String(safeResume.phone || "").replace(/\D/g, "");
    const hasEmail = email
        ? plainText.toLowerCase().includes(email.toLowerCase())
        : /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(plainText);
    const textDigits = plainText.replace(/\D/g, "");
    const hasPhone = phoneDigits.length >= 7 && textDigits.includes(phoneDigits);
    const contactCount = Number(hasEmail) + Number(hasPhone);
    scoredChecks.push(
        checkResult(
            "contact-details",
            contactCount === 2 ? "pass" : contactCount === 1 ? "warning" : "fail",
            "Contact details",
            contactCount === 2
                ? "Email and phone number are present as selectable text."
                : `Selectable contact details found: ${hasEmail ? "email" : "no email"}, ${hasPhone ? "phone" : "no phone"}.`,
            contactCount === 2
                ? "Keep contact details in the main text layer."
                : "Add both a professional email address and phone number near the top of the resume.",
            contactCount * 5,
            10
        )
    );

    const roles = Array.isArray(safeResume.experience) ? safeResume.experience : [];
    const roleFields = roles.flatMap((role) => [role.title, role.company]).filter(Boolean);
    const presentRoleFields = roleFields.filter((value) => containsPhrase(canonicalResume, value)).length;
    const roleRatio = roleFields.length ? presentRoleFields / roleFields.length : 0;
    scoredChecks.push(
        checkResult(
            "experience-content",
            roleRatio >= 0.9 ? "pass" : roleRatio >= 0.5 ? "warning" : "fail",
            "Experience content",
            roles.length
                ? `${presentRoleFields} of ${roleFields.length} expected role titles and employer names were found in extracted text.`
                : "No experience roles are present in the resume data.",
            roleRatio >= 0.9
                ? "Keep each title and employer in selectable text above its achievement bullets."
                : "Restore missing role titles or employer names and verify the PDF text extraction order.",
            10 * roleRatio,
            10
        )
    );

    const education = Array.isArray(safeResume.education) ? safeResume.education : [];
    const educationFields = education.flatMap((entry) => [entry.degree, entry.school]).filter(Boolean);
    const presentEducationFields = educationFields.filter((value) => containsPhrase(canonicalResume, value)).length;
    const educationRatio = educationFields.length ? presentEducationFields / educationFields.length : 0;
    scoredChecks.push(
        checkResult(
            "education-content",
            educationRatio >= 0.9 ? "pass" : educationRatio >= 0.5 ? "warning" : "fail",
            "Education content",
            education.length
                ? `${presentEducationFields} of ${educationFields.length} expected degree and school fields were found in extracted text.`
                : "No education entry is present in the resume data.",
            educationRatio >= 0.9
                ? "Keep the degree and institution in selectable text."
                : "Add or restore the degree and institution, then verify extraction from the final PDF.",
            5 * educationRatio,
            5
        )
    );

    const pageSizeText = String(fit.pageSize || "").toUpperCase();
    const pageWidthMm = finiteNumber(safeDiagnostics.pageWidthMm);
    const pageHeightMm = finiteNumber(safeDiagnostics.pageHeightMm);
    const isA4 = pageSizeText.includes("A4") || (
        pageWidthMm !== null &&
        pageHeightMm !== null &&
        Math.abs(pageWidthMm - A4_WIDTH_MM) <= 2 &&
        Math.abs(pageHeightMm - A4_HEIGHT_MM) <= 2
    );
    const pageSizeKnown = Boolean(pageSizeText) || (pageWidthMm !== null && pageHeightMm !== null);
    const wrongPageSize = pageSizeKnown && !isA4;
    const invalidPageCount = fit.pageCount !== null && fit.pageCount !== 1;
    const pageFitCritical =
        wrongPageSize ||
        invalidPageCount ||
        fit.overflow === true ||
        fit.clipped === true ||
        noSelectableText ||
        incompletePdfText;
    let pageFitPoints = 0;
    if (!pageFitCritical) {
        if (isA4) pageFitPoints += 4;
        if (fit.pageCount === 1) pageFitPoints += 6;
        if (fit.overflow === false) pageFitPoints += 5;
        if (fit.clipped === false) pageFitPoints += 5;
    }
    const pageFitKnown =
        pageSizeKnown &&
        fit.pageCount !== null &&
        fit.overflow !== null &&
        fit.clipped !== null &&
        fit.textLayerPresent !== null &&
        fit.pdfTextRecall !== null;
    const pageFitHealthy =
        isA4 &&
        fit.pageCount === 1 &&
        fit.overflow === false &&
        fit.clipped === false &&
        fit.textLayerPresent === true &&
        fit.pdfTextRecall >= 0.98;
    const pageFitProblems = [
        wrongPageSize ? `page size is ${fit.pageSize || "not A4"}` : "",
        invalidPageCount ? `${fit.pageCount} PDF pages` : "",
        fit.overflow === true ? "content overflow" : "",
        fit.clipped === true ? "clipped content" : "",
        noSelectableText ? "no selectable PDF text" : "",
        incompletePdfText ? `${Math.round(fit.pdfTextRecall * 100)}% PDF text recall` : ""
    ].filter(Boolean);
    scoredChecks.push(
        checkResult(
            "a4-one-page-fit",
            pageFitHealthy ? "pass" : pageFitCritical ? "fail" : "warning",
            "A4 one-page fit",
            pageFitProblems.length
                ? `Critical final-PDF issue(s): ${pageFitProblems.join(", ")}.`
                : pageFitKnown
                  ? `${fit.pageSize}; ${fit.pageCount} page; no overflow or clipping; selectable text recall ${Math.round(fit.pdfTextRecall * 100)}%.`
                : "One or more final page-fit diagnostics are unavailable.",
            pageFitHealthy
                ? "Keep one A4 page with no hidden overflow or clipping."
                : "Regenerate the PDF and shorten lower-priority content if it cannot fit within the safe page box.",
            pageFitPoints,
            20
        )
    );

    let marginPoints = 2.5;
    let marginStatus = "warning";
    let marginDetail = "Margin measurement is unavailable.";
    if (fit.marginMm !== null) {
        if (fit.marginMm >= MIN_SAFE_MARGIN_MM) {
            marginPoints = 5;
            marginStatus = "pass";
            marginDetail = `${fit.marginMm} mm page margins provide a safe print boundary.`;
        } else if (fit.marginMm >= 10) {
            marginPoints = 3;
            marginStatus = "warning";
            marginDetail = `${fit.marginMm} mm margins are usable but tighter than the preferred ${MIN_SAFE_MARGIN_MM} mm.`;
        } else {
            marginPoints = 0;
            marginStatus = "fail";
            marginDetail = `${fit.marginMm} mm margins are too close to the page edge.`;
        }
    }
    scoredChecks.push(
        checkResult(
            "safe-margins",
            marginStatus,
            "Safe page margins",
            marginDetail,
            marginStatus === "pass"
                ? "Keep at least 12 mm of internal page padding."
                : "Increase internal page padding to at least 12 mm on every side.",
            marginPoints,
            5
        )
    );

    const minimumReadableFontPt = fit.minimumReadableFontPt;
    const warningFontFloorPt = Math.max(8, minimumReadableFontPt - 0.5);
    let fontPoints = 5;
    let fontStatus = "warning";
    let fontDetail = "Smallest-font measurement is unavailable.";
    if (fit.minFontPt !== null) {
        if (fit.minFontPt >= minimumReadableFontPt) {
            fontPoints = 10;
            fontStatus = "pass";
            fontDetail = `The smallest measured text is ${fit.minFontPt} pt.`;
        } else if (fit.minFontPt >= warningFontFloorPt) {
            fontPoints = 5;
            fontStatus = "warning";
            fontDetail = `The smallest measured text is ${fit.minFontPt} pt, below this layout's ${minimumReadableFontPt} pt readability threshold.`;
        } else {
            fontPoints = 0;
            fontStatus = "fail";
            fontDetail = `The smallest measured text is only ${fit.minFontPt} pt.`;
        }
    }
    scoredChecks.push(
        checkResult(
            "readable-type",
            fontStatus,
            "Readable typography",
            fontDetail,
            fontStatus === "pass"
                ? `Keep all text at or above this layout's ${minimumReadableFontPt} pt threshold.`
                : `Shorten content before reducing text below this layout's ${minimumReadableFontPt} pt threshold.`,
            fontPoints,
            10
        )
    );

    let fillPoints = 5;
    let fillStatus = "warning";
    let fillDetail = "Page-fill measurement is unavailable.";
    let fillSuggestion = "Inspect the final rendered PDF before applying.";
    if (fit.fillPercent !== null) {
        fillDetail = `Resume content uses ${fit.fillPercent}% of the available page height.`;
        if (fit.fillPercent >= 86 && fit.fillPercent <= 97) {
            fillPoints = 10;
            fillStatus = "pass";
            fillSuggestion = "Keep page usage between roughly 86% and 97% for balanced whitespace.";
        } else if (fit.fillPercent >= 75 && fit.fillPercent <= 100) {
            fillPoints = 6;
            fillStatus = "warning";
            fillSuggestion = fit.fillPercent < 86
                ? "Add relevant, evidence-based detail rather than artificially enlarging text."
                : "Reduce a low-priority bullet or small spacing before the page overflows.";
        } else {
            fillPoints = 0;
            fillStatus = "fail";
            fillSuggestion = fit.fillPercent < 75
                ? "Add substantive achievements or projects; do not use oversized typography merely to fill space."
                : "Shorten or remove lower-priority content until everything fits without clipping.";
        }
    }
    scoredChecks.push(
        checkResult(
            "balanced-page-fill",
            fillStatus,
            "Balanced page fill",
            fillDetail,
            fillSuggestion,
            fillPoints,
            10
        )
    );

    scoredChecks.push(
        checkResult(
            "job-keywords",
            !targetKeywords.length ? "info" : jobMatchScore >= 70 ? "pass" : jobMatchScore >= 50 ? "warning" : "fail",
            "Job keyword coverage",
            targetKeywords.length
                ? `${matched.length} of ${targetKeywords.length} supplied job keywords appear in the selected resume text.`
                : "No supplied job-analysis keywords were available for comparison.",
            !targetKeywords.length
                ? "Run job analysis or supply target keywords to calculate job-match coverage."
                : missing.length
                ? `Review these terms and add only those you can substantiate: ${missing.join(", ")}.`
                : "Keep every included keyword grounded in genuine experience.",
            0,
            0
        )
    );

    const totalWeight = scoredChecks.reduce((sum, check) => sum + check.weight, 0);
    const earnedPoints = scoredChecks.reduce((sum, check) => sum + check.earned, 0);
    const rawReadinessScore = totalWeight
        ? clamp(Math.round((earnedPoints / totalWeight) * 100), 0, 100)
        : 0;
    const criticalFailures = [
        noSelectableText ? "The PDF has no selectable text." : "",
        invalidPageCount ? `The PDF contains ${fit.pageCount} pages instead of one.` : "",
        fit.overflow === true ? "Content overflows the A4 page box." : "",
        fit.clipped === true ? "Content is clipped or omitted from the final PDF." : "",
        incompletePdfText ? `Only ${Math.round(fit.pdfTextRecall * 100)}% of source text was recovered from the PDF.` : "",
        wrongPageSize ? "The final PDF is not A4." : ""
    ].filter(Boolean);
    const contentFailures = [
        contactCount === 0 ? "No selectable email address or phone number was found." : "",
        contactCount === 1 ? "Only one selectable contact method was found." : ""
    ].filter(Boolean);
    const criticalScoreCap = noSelectableText ? 20 : criticalFailures.length ? 49 : 100;
    const contactScoreCap = contactCount === 0 ? 69 : contactCount === 1 ? 89 : 100;
    const readinessScore = Math.min(rawReadinessScore, criticalScoreCap, contactScoreCap);
    const checks = scoredChecks.map(publicCheck);
    const readinessChecks = scoredChecks.filter((check) => check.weight > 0);
    const failureCount = readinessChecks.filter((check) => check.status === "fail").length;
    const warningCount = readinessChecks.filter((check) => check.status === "warning").length;
    const readiness = {
        score: readinessScore,
        label: readinessLabel(readinessScore),
        summary: `${failureCount} failed and ${warningCount} warning check(s).${criticalFailures.length ? ` Critical file-integrity failures: ${criticalFailures.join(" ")}` : ""}${contentFailures.length ? ` Critical content issue: ${contentFailures.join(" ")}` : ""} Deterministic heuristic only; employer ATS behavior varies.`,
        criticalFailures,
        contentFailures
    };

    return {
        templateId: String(templateId || "classic").trim().toLowerCase() || "classic",
        readiness,
        jobMatch,
        fit,
        checks,
        plainText
    };
}
