import { extractKnownSkills, skillMatch } from "./skillOntology.js";

const HEADING = /^(requirements?|required qualifications?|minimum qualifications?|basic qualifications?|must have|what you(?:'|’)ll need|what (?:we(?:'|’)re looking for|you bring)|skills? and experience|required skills?|preferred qualifications?|nice to have|good to have|bonus|responsibilities|what you(?:'|’)ll do)\s*:?$/i;
const REQUIRED = /\b(?:must|required|minimum|at least|proficien(?:t|cy)|strong (?:knowledge|experience)|hands-on|expertise|experience (?:with|in))\b/i;
const PREFERRED = /\b(?:preferred|nice to have|good to have|bonus|plus|desirable|advantage)\b/i;
const NEGATED = /\b(?:not required|no (?:prior )?experience (?:is )?required|need not have|without requiring)\b/i;
const RESPONSIBILITY = /\b(?:responsibilities|what you(?:'|’)ll do|day to day)\b/i;

function clean(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function segments(text = "") {
    return String(text || "")
        .replace(/<[^>]+>/g, "\n")
        .split(/\n+|(?<=[.!?;])\s+(?=[A-Z0-9])/)
        .map(clean)
        .filter(Boolean)
        .slice(0, 800);
}

function sectionType(line = "", current = "CONTEXT") {
    const value = clean(line).replace(/[:\s]+$/, "");
    if (!HEADING.test(value)) return current;
    if (PREFERRED.test(value)) return "PREFERRED";
    if (RESPONSIBILITY.test(value)) return "CONTEXT";
    return "REQUIRED";
}

function importanceFor(line, section) {
    if (NEGATED.test(line)) return { kind: "NEGATED", weight: 0 };
    if (PREFERRED.test(line) || section === "PREFERRED") return { kind: "PREFERRED", weight: 0.45 };
    if (REQUIRED.test(line) || section === "REQUIRED") return { kind: "REQUIRED", weight: 1 };
    return { kind: "CONTEXT", weight: 0.25 };
}

function alternativeGroup(line, skills) {
    if (skills.length < 2 || !/\b(?:or|either)\b|\//i.test(line)) return null;
    return `alternative:${skills.map((skill) => skill.toLowerCase()).sort().join("|")}`;
}

export function extractJobRequirementModel(text = "") {
    const rows = [];
    let section = "CONTEXT";
    for (const line of segments(text)) {
        const nextSection = sectionType(line, section);
        if (HEADING.test(line.replace(/[:\s]+$/, ""))) {
            section = nextSection;
            continue;
        }
        section = nextSection;
        const skills = extractKnownSkills(line);
        if (!skills.length) continue;
        const importance = importanceFor(line, section);
        const group = alternativeGroup(line, skills);
        for (const skill of skills) {
            rows.push({
                skill,
                kind: importance.kind,
                weight: importance.weight,
                alternativeGroup: group,
                evidence: line.slice(0, 500)
            });
        }
    }

    const merged = new Map();
    for (const row of rows) {
        const key = row.skill.toLowerCase();
        const prior = merged.get(key);
        if (!prior || row.weight > prior.weight) merged.set(key, row);
    }
    return [...merged.values()];
}

export function evaluateJobRequirements(text = "", candidateSkills = []) {
    const requirements = extractJobRequirementModel(text).filter((item) => item.weight > 0);
    if (!requirements.length) {
        return {
            requirements: [], matches: [], score: 50, evidenceCoverage: 0,
            exact: [], transferable: [], missing: [], groups: []
        };
    }
    const evaluated = requirements.map((requirement) => ({
        ...requirement,
        match: skillMatch(requirement.skill, candidateSkills)
    }));
    const units = [];
    const consumedGroups = new Set();
    for (const item of evaluated) {
        if (!item.alternativeGroup) {
            units.push({ weight: item.weight, credit: item.match.credit, items: [item] });
            continue;
        }
        if (consumedGroups.has(item.alternativeGroup)) continue;
        consumedGroups.add(item.alternativeGroup);
        const alternatives = evaluated.filter((candidate) => candidate.alternativeGroup === item.alternativeGroup);
        units.push({
            weight: Math.max(...alternatives.map((candidate) => candidate.weight)),
            credit: Math.max(...alternatives.map((candidate) => candidate.match.credit)),
            items: alternatives
        });
    }
    const denominator = units.reduce((sum, unit) => sum + unit.weight, 0);
    const numerator = units.reduce((sum, unit) => sum + unit.weight * unit.credit, 0);
    const bestAlternative = new Map(units.filter((unit) => unit.items.length > 1).map((unit) => {
        const best = [...unit.items].sort((a, b) => b.match.credit - a.match.credit)[0];
        return [unit.items[0].alternativeGroup, best?.match.credit > 0 ? best.skill : null];
    }));
    const matches = evaluated.map((item) => ({
        ...item.match,
        importance: item.kind,
        weight: item.weight,
        evidenceText: item.evidence,
        alternativeGroup: item.alternativeGroup,
        satisfiedByAlternative: Boolean(item.alternativeGroup
            && bestAlternative.get(item.alternativeGroup)
            && bestAlternative.get(item.alternativeGroup) !== item.skill)
    }));
    return {
        requirements: requirements.map((item) => item.skill),
        matches,
        score: denominator ? Math.round((numerator / denominator) * 100) : 50,
        evidenceCoverage: Math.min(1, requirements.length / 5),
        exact: matches.filter((match) => ["EXACT", "ALIAS"].includes(match.type)),
        transferable: matches.filter((match) => ["EQUIVALENT_CAPABILITY", "TRANSFERABLE"].includes(match.type)),
        missing: matches.filter((match) => match.type === "NONE" && !match.satisfiedByAlternative),
        groups: units.map((unit) => ({
            alternatives: unit.items.map((item) => item.skill),
            weight: unit.weight,
            credit: unit.credit
        }))
    };
}
