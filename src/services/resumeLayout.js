const DEFAULT_PROFILE = {
    hardMinFontPt: 9.5,
    minFontPt: 10,
    maxFontPt: 11.5,
    minLineHeight: 1.16,
    maxLineHeight: 1.32,
    minSectionGapPx: 4,
    maxSectionGapPx: 10,
    minItemGapPx: 3,
    maxItemGapPx: 7,
    minBulletGapPx: 0,
    maxBulletGapPx: 2,
    minMarginMm: 12.7,
    preferredMarginMm: 14,
    sparseMarginMm: 16,
    horizontalMarginMm: 13,
    targetFill: 0.94,
    minTargetFill: 0.86,
    maxTargetFill: 0.97,
    maxExtraGapPx: 16
};

const TEMPLATE_PROFILES = {
    classic: { maxFontPt: 11.5, maxSectionGapPx: 10 },
    split: { maxFontPt: 11.25, maxSectionGapPx: 9 },
    ats: { maxFontPt: 11.5, maxSectionGapPx: 10 },
    compact: { maxFontPt: 11.25, maxSectionGapPx: 8 }
};

export const A4 = Object.freeze({ widthMm: 210, heightMm: 297 });

export function getResumeFitProfile(templateId = "classic") {
    return Object.freeze({
        ...DEFAULT_PROFILE,
        ...(TEMPLATE_PROFILES[templateId] || TEMPLATE_PROFILES.classic)
    });
}

function safeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function resumeLayoutMarkup(templateId = "classic") {
    const profile = getResumeFitProfile(templateId);

    return {
        head: `<style id="resume-layout-system">
@page { size: A4 portrait; margin: 0; }
html, body {
  width: ${A4.widthMm}mm;
  min-height: ${A4.heightMm}mm;
  margin: 0;
  padding: 0;
  background: #fff;
}
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.resume-page {
  box-sizing: border-box;
  width: ${A4.widthMm}mm;
  height: ${A4.heightMm}mm;
  margin: 0;
  padding: var(--resume-margin-y, ${profile.preferredMarginMm}mm)
           var(--resume-margin-x, ${profile.horizontalMarginMm}mm);
  overflow: visible;
  background: #fff;
  font-size: var(--resume-font-size, ${profile.minFontPt}pt);
  line-height: var(--resume-line-height, ${profile.minLineHeight});
}
.resume-content { box-sizing: border-box; width: 100%; }
.resume-section + .resume-section {
  margin-top: calc(var(--resume-section-gap, 0px) + var(--resume-extra-gap, 0px));
}
.resume-section,
.role,
.edu-line {
  break-inside: avoid;
  page-break-inside: avoid;
}
@media print {
  html, body { height: ${A4.heightMm}mm; }
  .resume-page { overflow: visible; }
}
</style>`,
        body: `<script id="resume-fit-runtime">
(() => {
  "use strict";
  const profile = ${safeJson(profile)};
  const page = document.querySelector(".resume-page");
  const content = document.querySelector(".resume-content");

  function round(value, places = 2) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  function lerp(min, max, amount) {
    return min + (max - min) * amount;
  }

  function setVar(name, value) {
    page.style.setProperty(name, value);
  }

  function applyDensity(amount, marginMm, extraGapPx = 0, minimumFontPt = profile.minFontPt) {
    const density = Math.max(0, Math.min(1, amount));
    setVar("--resume-font-size", round(lerp(minimumFontPt, profile.maxFontPt, density), 3) + "pt");
    setVar("--resume-line-height", String(round(lerp(profile.minLineHeight, profile.maxLineHeight, density), 4)));
    setVar("--resume-section-gap", round(lerp(profile.minSectionGapPx, profile.maxSectionGapPx, density), 3) + "px");
    setVar("--resume-item-gap", round(lerp(profile.minItemGapPx, profile.maxItemGapPx, density), 3) + "px");
    setVar("--resume-bullet-gap", round(lerp(profile.minBulletGapPx, profile.maxBulletGapPx, density), 3) + "px");
    setVar("--resume-margin-y", round(marginMm, 3) + "mm");
    setVar("--resume-margin-x", profile.horizontalMarginMm + "mm");
    setVar("--resume-extra-gap", round(extraGapPx, 3) + "px");
  }

  function measure() {
    const pageRect = page.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const pageStyle = getComputedStyle(page);
    const paddingTop = parseFloat(pageStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(pageStyle.paddingBottom) || 0;
    const paddingLeft = parseFloat(pageStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(pageStyle.paddingRight) || 0;
    const availableHeight = page.clientHeight - paddingTop - paddingBottom;
    const availableWidth = page.clientWidth - paddingLeft - paddingRight;
    const innerTop = pageRect.top + paddingTop;
    const innerBottom = pageRect.bottom - paddingBottom;
    const innerLeft = pageRect.left + paddingLeft;
    const innerRight = pageRect.right - paddingRight;
    let highest = contentRect.top;
    let lowest = contentRect.top;
    let farthestLeft = contentRect.left;
    let farthestRight = contentRect.left;
    let minimumFontPx = Number.POSITIVE_INFINITY;
    let clippedByContainer = false;
    const elements = [content, ...content.querySelectorAll("*")];

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width || rect.height) {
        highest = Math.min(highest, rect.top);
        lowest = Math.max(lowest, rect.bottom);
        farthestLeft = Math.min(farthestLeft, rect.left);
        farthestRight = Math.max(farthestRight, rect.right);
      }
      if (element.textContent.trim() && style.display !== "none" && style.visibility !== "hidden") {
        const size = parseFloat(style.fontSize);
        if (Number.isFinite(size) && size > 0) minimumFontPx = Math.min(minimumFontPx, size);
      }
      const clipsX = ["hidden", "clip"].includes(style.overflowX);
      const clipsY = ["hidden", "clip"].includes(style.overflowY);
      if ((clipsX && element.scrollWidth > element.clientWidth + 0.75) ||
          (clipsY && element.scrollHeight > element.clientHeight + 0.75) ||
          (style.clipPath && style.clipPath !== "none")) {
        clippedByContainer = true;
      }
    }

    const contentHeight = Math.max(content.scrollHeight, lowest - contentRect.top);
    const contentWidth = Math.max(content.scrollWidth, farthestRight - contentRect.left);
    const verticalOverflow =
      contentHeight > availableHeight + 0.75 ||
      highest < innerTop - 0.75 ||
      lowest > innerBottom + 0.75;
    const horizontalOverflow =
      contentWidth > availableWidth + 0.75 ||
      farthestLeft < innerLeft - 0.75 ||
      farthestRight > innerRight + 0.75;
    const marginMm = (paddingTop * 25.4) / 96;

    return {
      pageSize: "A4",
      pageWidthMm: ${A4.widthMm},
      pageHeightMm: ${A4.heightMm},
      pageCount: verticalOverflow ? 2 : 1,
      availableHeightPx: round(availableHeight),
      contentHeightPx: round(contentHeight),
      fillRatio: round(contentHeight / Math.max(availableHeight, 1), 4),
      fillPercent: Math.round((contentHeight / Math.max(availableHeight, 1)) * 100),
      overflow: verticalOverflow || horizontalOverflow,
      verticalOverflow,
      horizontalOverflow,
      clipped: clippedByContainer,
      minFontPt: round(((Number.isFinite(minimumFontPx) ? minimumFontPx : 0) * 72) / 96, 2),
      marginMm: round(marginMm, 2),
      textLength: content.innerText.trim().length
    };
  }

  function searchDensity(marginMm, minimumFontPt) {
    applyDensity(0, marginMm, 0, minimumFontPt);
    let first = measure();
    if (first.overflow || first.fillRatio > profile.maxTargetFill) {
      return { density: 0, metrics: first };
    }

    applyDensity(1, marginMm, 0, minimumFontPt);
    const largest = measure();
    if (!largest.overflow && largest.fillRatio <= profile.maxTargetFill) {
      return { density: 1, metrics: largest };
    }

    let low = 0;
    let high = 1;
    let best = { density: 0, metrics: first };
    for (let index = 0; index < 18; index += 1) {
      const middle = (low + high) / 2;
      applyDensity(middle, marginMm, 0, minimumFontPt);
      const metrics = measure();
      if (!metrics.overflow && metrics.fillRatio <= profile.maxTargetFill) {
        best = { density: middle, metrics };
        low = middle;
      } else {
        high = middle;
      }
    }
    applyDensity(best.density, marginMm, 0, minimumFontPt);
    return { ...best, metrics: measure() };
  }

  async function fit() {
    if (!page || !content) {
      return { ready: true, error: "Resume page wrapper is missing", overflow: true, clipped: true };
    }
    if (document.fonts?.ready) await document.fonts.ready;

    let marginMm = profile.preferredMarginMm;
    let result = searchDensity(marginMm, profile.minFontPt);

    if (result.metrics.overflow) {
      marginMm = profile.minMarginMm;
      result = searchDensity(marginMm, profile.minFontPt);
    }

    if (result.metrics.overflow) {
      result = searchDensity(profile.minMarginMm, profile.hardMinFontPt);
      marginMm = profile.minMarginMm;
    }

    if (result.density === 1 && result.metrics.fillRatio < profile.minTargetFill) {
      marginMm = profile.sparseMarginMm;
      result = searchDensity(marginMm, profile.minFontPt);
    }

    if (!result.metrics.overflow && result.metrics.fillRatio < profile.targetFill) {
      const sections = content.querySelectorAll(":scope > .resume-section").length;
      if (sections > 1) {
        const missingHeight = profile.targetFill * result.metrics.availableHeightPx - result.metrics.contentHeightPx;
        const extraGapPx = Math.max(0, Math.min(profile.maxExtraGapPx, missingHeight / (sections - 1)));
        applyDensity(result.density, marginMm, extraGapPx, result.metrics.minFontPt < profile.minFontPt ? profile.hardMinFontPt : profile.minFontPt);
      }
    }

    const metrics = measure();
    metrics.ready = true;
    metrics.targetFillPercent = Math.round(profile.targetFill * 100);
    metrics.readabilityWarning = metrics.minFontPt < profile.minFontPt;
    metrics.profile = {
      minimumReadableFontPt: profile.minFontPt,
      targetFillPercent: Math.round(profile.targetFill * 100),
      minimumMarginMm: profile.minMarginMm
    };
    page.dataset.fit = metrics.overflow ? "overflow" : "ready";
    window.__resumeFit = { ready: true, metrics, fit };
    window.dispatchEvent(new CustomEvent("resume-fit-complete", { detail: metrics }));
    return metrics;
  }

  window.__resumeFit = { ready: false, metrics: null, fit };
  fit().catch((error) => {
    window.__resumeFit = {
      ready: true,
      metrics: { ready: true, overflow: true, clipped: true, error: error.message },
      fit
    };
  });
})();
</script>`
    };
}
