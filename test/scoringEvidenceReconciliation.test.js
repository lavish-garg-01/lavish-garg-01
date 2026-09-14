import assert from "node:assert/strict";
import test from "node:test";
import { reconcileModelSkillClaims } from "../src/services/openai.js";

test("scoring evidence reconciliation fixes the live Bolna alternative-language and voice-AI gaps", () => {
    const resume = {
        skills: ["Node.js", "Python", "WebSocket", "RTMP", "HLS"],
        experience: [{ bullets: ["Integrated real-time AI voice models with Exotel Voice Streaming."] }]
    };
    const result = reconcileModelSkillClaims({
        matchScore: 80,
        explanation: "The candidate lacks Python or Go and does not mention voice AI orchestration. Backend experience is strong.",
        matchedSkills: ["Node.js"],
        missingSkills: ["Python", "Go", "Voice AI orchestration", "Real-time media pipelines", "Kubernetes"],
        coachingNudges: ["Add Python to the resume.", "Gain Voice AI orchestration experience.", "Learn Kubernetes."]
    }, {
        description: "2+ years using Python, Go, Java, Node.js, or a similar language.\nPreferred: voice AI orchestration and real-time media pipelines."
    }, resume);
    assert.deepEqual(result.missingSkills, ["Kubernetes"]);
    assert.ok(result.matchedSkills.includes("Python"));
    assert.ok(result.matchedSkills.includes("Go"));
    assert.ok(result.matchedSkills.includes("Voice AI orchestration"));
    assert.ok(result.matchedSkills.includes("Real-time media pipelines"));
    assert.doesNotMatch(result.explanation, /lacks Python/i);
    assert.deepEqual(result.coachingNudges, ["Learn Kubernetes."]);
});

test("scoring evidence reconciliation keeps genuinely missing mandatory skills", () => {
    const result = reconcileModelSkillClaims({ matchedSkills: ["Node.js"], missingSkills: ["Kubernetes"], explanation: "Kubernetes is required.", coachingNudges: [] },
        { description: "Kubernetes is required." }, { skills: ["Node.js"] });
    assert.deepEqual(result.missingSkills, ["Kubernetes"]);
});
