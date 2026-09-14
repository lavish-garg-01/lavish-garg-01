import { env } from "../config/environment.js";
import { semanticTextForEmbedding, normalizeSemanticText } from "../contracts/fieldSemanticDescriptor.js";
import { listCanonicalExamples, saveCanonicalExampleEmbedding } from "../repositories/fieldSemanticRepository.js";
import { createSharedCanonicalEmbeddings } from "./openai.js";
import { getFeatureFlag } from "../repositories/featureFlagRepository.js";
import {
    getCachedSemanticEmbedding,
    saveCachedSemanticEmbedding
} from "../repositories/canonicalSemanticCacheRepository.js";

const EMBEDDING_MODEL = "text-embedding-3-small";

function semanticTokens(value = "") {
    const normalized = normalizeSemanticText(value)
        .replace(/\bemployer\b/g, "company")
        .replace(/\borganisation\b/g, "organization")
        .replace(/\bcompensation\b|\bctc\b/g, "salary")
        .replace(/\bmobile\b|\btelephone\b/g, "phone")
        .replace(/\bjoining\b/g, "start");
    return new Set(normalized.split(/\s+/).filter((token) => token.length > 1));
}

function lexicalSimilarity(left, right) {
    const a = semanticTokens(left);
    const b = semanticTokens(right);
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    const union = new Set([...a, ...b]).size;
    const containment = intersection / Math.min(a.size, b.size);
    return (intersection / union) * 0.65 + containment * 0.35;
}

function cosine(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftNorm += left[index] * left[index];
        rightNorm += right[index] * right[index];
    }
    return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

function parseEmbedding(value) {
    try { return JSON.parse(value || "null"); } catch { return null; }
}

export async function nearestCanonicals(descriptor, { limit = 8 } = {}) {
    if (!getFeatureFlag("canonical.semantic-search", env.canonicalization.semanticSearchEnabled).enabled
        || descriptor.flags.skipLearning) return [];
    const inputText = semanticTextForEmbedding(descriptor);
    const examples = listCanonicalExamples().map((row) => ({
        ...row,
        lexical: lexicalSimilarity(inputText, `${row.example_text} ${row.description || ""}`),
        embedding: parseEmbedding(row.embedding_json)
    })).sort((left, right) => right.lexical - left.lexical).slice(0, 18);
    if (!examples.length) return [];

    let inputEmbedding = null;
    if (env.canonicalization.embeddingsEnabled) {
        inputEmbedding = getCachedSemanticEmbedding({
            semanticFingerprint: descriptor.fingerprints.semantic,
            inputText,
            model: EMBEDDING_MODEL
        });
        const missing = examples.filter((row) => !row.embedding || row.embedding_model !== EMBEDDING_MODEL);
        const texts = [
            ...(!inputEmbedding ? [inputText] : []),
            ...missing.map((row) => `${row.example_text} | ${row.description || row.label || ""}`)
        ];
        const embeddings = await createSharedCanonicalEmbeddings(texts);
        const exampleOffset = inputEmbedding ? 0 : 1;
        if (!inputEmbedding) {
            inputEmbedding = embeddings[0] || null;
            if (inputEmbedding) saveCachedSemanticEmbedding({
                semanticFingerprint: descriptor.fingerprints.semantic,
                inputText,
                model: EMBEDDING_MODEL,
                embedding: inputEmbedding
            });
        }
        missing.forEach((row, index) => {
            const embedding = embeddings[index + exampleOffset];
            if (!embedding) return;
            row.embedding = embedding;
            saveCanonicalExampleEmbedding(row.id, embedding, EMBEDDING_MODEL);
        });
    }

    const byCanonical = new Map();
    for (const row of examples) {
        const vector = inputEmbedding && row.embedding ? cosine(inputEmbedding, row.embedding) : 0;
        const similarity = inputEmbedding ? (vector * 0.82) + (row.lexical * 0.18) : row.lexical;
        const candidate = {
            key: row.canonical_field_key,
            label: row.label,
            description: row.description || row.label,
            similarity: Number(similarity.toFixed(4)),
            lexicalSimilarity: Number(row.lexical.toFixed(4)),
            vectorSimilarity: inputEmbedding ? Number(vector.toFixed(4)) : null,
            example: row.example_text
        };
        const existing = byCanonical.get(candidate.key);
        if (!existing || candidate.similarity > existing.similarity) byCanonical.set(candidate.key, candidate);
    }
    return [...byCanonical.values()].sort((left, right) => right.similarity - left.similarity).slice(0, Math.max(1, limit));
}
