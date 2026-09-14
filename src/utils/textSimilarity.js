/**
 * Normalize job text for ghost-listing / duplicate detection.
 */
export function normalizeText(value = "") {
    return String(value)
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function bigramSet(text) {
    const normalized = normalizeText(text);
    const grams = new Set();
    if (normalized.length < 2) {
        if (normalized) grams.add(normalized);
        return grams;
    }
    for (let i = 0; i < normalized.length - 1; i += 1) {
        grams.add(normalized.slice(i, i + 2));
    }
    return grams;
}

/**
 * Sørensen–Dice coefficient on character bigrams (0–1).
 * Values ≥ 0.95 strongly indicate near-duplicate job descriptions.
 */
export function diceCoefficient(a = "", b = "") {
    const left = bigramSet(a);
    const right = bigramSet(b);
    if (!left.size || !right.size) {
        return 0;
    }

    let overlap = 0;
    for (const gram of left) {
        if (right.has(gram)) {
            overlap += 1;
        }
    }
    return (2 * overlap) / (left.size + right.size);
}

export function isNearDuplicate(a, b, threshold = 0.95) {
    return diceCoefficient(a, b) >= threshold;
}
