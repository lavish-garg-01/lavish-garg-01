export function normalizeLineBreaks(value = "") {
    return String(value)
        .replace(/\r\n?/g, "\n")
        .replace(/\\r\\n|\\n|\\r/g, "\n")
        .replace(/\u2028|\u2029/g, "\n");
}
