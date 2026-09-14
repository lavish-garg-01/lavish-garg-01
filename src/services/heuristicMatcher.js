import { getDb } from "../database/connection.js";
import { evaluateMatchingPolicy } from "./matchingPolicy.js";
import { scoringTerms } from "./resumeStore.js";

const K1 = 1.2;
const B = 0.75;

function clamp(value, minimum = 0, maximum = 100) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function tokens(value = "") {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/c\+\+/g, " cplusplus ")
        .replace(/c#/g, " csharp ")
        .replace(/\.net\b/g, " dotnet ")
        .match(/[a-z0-9+#.]{2,}/g) || [];
}

function counts(values = []) {
    const map = new Map();
    for (const value of values) map.set(value, (map.get(value) || 0) + 1);
    return map;
}

export function buildBm25CorpusStats(rows = []) {
    const documents = rows.map((row) => ({ title: tokens(row.title), body: tokens(row.description) }));
    const df = new Map();
    for (const document of documents) {
        for (const term of new Set([...document.title, ...document.body])) df.set(term, (df.get(term) || 0) + 1);
    }
    const total = Math.max(1, documents.length);
    return {
        total,
        averageTitleLength: documents.reduce((sum, document) => sum + document.title.length, 0) / total || 1,
        averageBodyLength: documents.reduce((sum, document) => sum + document.body.length, 0) / total || 1,
        documentFrequency: df
    };
}

export function recentJobCorpus(db = getDb(), limit = 2000) {
    return buildBm25CorpusStats(db.prepare(`SELECT title, description FROM jobs
        WHERE created_at >= datetime('now', '-45 days') ORDER BY created_at DESC LIMIT ?`).all(limit));
}

function bm25Term(tf, length, averageLength, idf) {
    if (!tf) return 0;
    return idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (length / Math.max(1, averageLength)))));
}

export function bm25fScore(job = {}, queryValues = [], corpus = buildBm25CorpusStats([])) {
    const queryTerms = [...new Set(tokens(queryValues.join(" ")))];
    if (!queryTerms.length) return { score: 0, raw: 0, terms: [] };
    const titleTokens = tokens(job.title);
    const bodyTokens = tokens(job.description);
    const titleCounts = counts(titleTokens);
    const bodyCounts = counts(bodyTokens);
    let raw = 0;
    let maximum = 0;
    const terms = [];
    for (const term of queryTerms) {
        const frequency = corpus.documentFrequency.get(term) || 0;
        const idf = Math.log(1 + ((corpus.total - frequency + 0.5) / (frequency + 0.5)));
        const titlePart = bm25Term(titleCounts.get(term) || 0, titleTokens.length, corpus.averageTitleLength, idf) * 3;
        const bodyPart = bm25Term(bodyCounts.get(term) || 0, bodyTokens.length, corpus.averageBodyLength, idf);
        const contribution = titlePart + bodyPart;
        raw += contribution;
        maximum += idf * (K1 + 1) * 4;
        if (contribution > 0) terms.push({ term, contribution: Number(contribution.toFixed(3)) });
    }
    return {
        score: maximum ? Math.round(clamp((raw / maximum) * 180)) : 0,
        raw: Number(raw.toFixed(4)),
        terms: terms.sort((a, b) => b.contribution - a.contribution).slice(0, 16)
    };
}

export function evaluateHeuristicMatch(job = {}, resume = {}, profile = {}, {
    corpus = recentJobCorpus(),
    context = "DISCOVERY",
    saved = false,
    now = new Date()
} = {}) {
    const candidateSkills = [...new Set([
        ...scoringTerms(resume),
        ...(profile.skills || []),
        ...Object.values(resume.skillGroups || {}).flat()
    ].filter(Boolean))];
    const lexical = bm25fScore(job, [
        ...candidateSkills,
        ...(profile.preferredSkills || []),
        ...(profile.targetRoles || [])
    ], corpus);
    return evaluateMatchingPolicy(job, resume, { ...profile, skills: candidateSkills }, {
        lexical,
        context,
        saved,
        now
    });
}

export function shouldEscalateToAi(result = {}) {
    if (result.eligibility?.status === "INELIGIBLE") return false;
    const score = Number(result.matchScore || 0);
    const confidence = Number(result.confidence || 0);
    if (confidence < 0.72) return true;
    return score >= 62 && score <= 86 && confidence < 0.88;
}
