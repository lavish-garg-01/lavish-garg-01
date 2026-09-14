import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLineBreaks } from "../src/utils/textFormatting.js";

test("converts escaped newline sequences into real line breaks", () => {
    assert.equal(
        normalizeLineBreaks("Hello\\n\\nHiring Team\\r\\nRegards"),
        "Hello\n\nHiring Team\nRegards"
    );
});

test("normalizes platform line endings without changing ordinary text", () => {
    assert.equal(normalizeLineBreaks("First\r\nSecond\rThird"), "First\nSecond\nThird");
    assert.equal(normalizeLineBreaks("Node.js / systems"), "Node.js / systems");
});
