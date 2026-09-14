/**
 * Structural selectors are the only learned locator data allowed to leave a
 * session. They must never contain candidate values, so the sanitizer keeps
 * short attribute/id selectors and rejects anything that looks like a script
 * fragment or an unbounded blob.
 */
export function safeStructuralSelectors(candidates = []) {
    return [...new Set((Array.isArray(candidates) ? candidates : [])
        .map((candidate) => String(candidate || "").trim())
        .filter((candidate) => candidate && candidate.length <= 300 && !/[{};]/.test(candidate)))]
        .slice(0, 8);
}

export function hasStructuralSelectors(candidates = []) {
    return safeStructuralSelectors(candidates).length > 0;
}
