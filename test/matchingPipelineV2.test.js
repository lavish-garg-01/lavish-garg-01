import assert from "node:assert/strict";
import test from "node:test";
import { getDb } from "../src/database/connection.js";
import { normalizeProfilePhone } from "../src/repositories/copilotRepository.js";
import { adaptiveSourceSelection, sourceQuality, sourceQualityEvidence } from "../src/services/ingestionScheduler.js";
import { buildBm25CorpusStats, evaluateHeuristicMatch, shouldEscalateToAi } from "../src/services/heuristicMatcher.js";
import { buildCandidateResumeProfile, PARSER_VERSION } from "../src/services/candidateProfileBuilder.js";
import { canonicalJobUrl, jobContentFingerprint, pendingScoringCandidates, shouldIngestJob, upsertJob } from "../src/services/ingestion.js";
import { evaluateJobRequirements, extractJobRequirementModel } from "../src/services/jobRequirementModel.js";
import { classifyJobTitle, isTargetJobTitle } from "../src/services/roleTaxonomy.js";
import { filterClaimableSkills, skillMatch } from "../src/services/skillOntology.js";

function candidates(source, count, start = Date.now()) {
    return Array.from({ length: count }, (_, index) => ({
        id: `${source}-${index}`,
        source,
        postedAt: new Date(start - index * 60_000).toISOString()
    }));
}

test("adaptive ingestion gives every available source a slot and rewards fresh compatible yield", () => {
    const now = Date.now();
    const rows = [
        ...candidates("jobspy:linkedin", 40, now),
        ...candidates("naukri", 40, now),
        ...candidates("instahyre", 40, now),
        ...candidates("direct_ats", 40, now)
    ];
    const history = [
        { source: "jobspy:linkedin", totalFetched: 1000, totalInserted: 30, totalSelected: 100, totalMatched: 2, totalClose: 4 },
        { source: "naukri", totalFetched: 100, totalInserted: 80, totalSelected: 50, totalMatched: 38, totalClose: 6 },
        { source: "instahyre", totalFetched: 100, totalInserted: 55, totalSelected: 50, totalMatched: 20, totalClose: 8 },
        { source: "direct_ats", totalFetched: 80, totalInserted: 50, totalSelected: 40, totalMatched: 18, totalClose: 5 }
    ];

    const result = adaptiveSourceSelection(rows, 20, history);
    assert.equal(result.selected.length, 20);
    for (const source of ["jobspy:linkedin", "naukri", "instahyre", "direct_ats"]) {
        assert.ok(result.quotas[source] >= 1, `${source} receives exploration capacity`);
    }
    assert.ok(result.quotas.naukri > result.quotas["jobspy:linkedin"], "higher-yield Naukri receives more of the remaining budget");
    assert.ok(result.qualities.naukri > result.qualities["jobspy:linkedin"]);
    const selectedNaukri = result.selected.filter((row) => row.source === "naukri");
    assert.equal(selectedNaukri[0].id, "naukri-0", "the freshest candidate within a source is selected first");
});

test("source quality combines compatibility, unique yield, and recency instead of raw volume", () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const strong = sourceQuality({ totalFetched: 100, totalInserted: 70, totalSelected: 40, totalMatched: 30, totalClose: 4 }, now);
    const staleVolume = sourceQuality({ totalFetched: 5000, totalInserted: 100, totalSelected: 200, totalMatched: 5, totalClose: 5 }, old);
    assert.ok(strong > staleVolume);
    const sparse = sourceQualityEvidence({ totalFetched: 1, totalInserted: 1, totalSelected: 1, totalMatched: 1 }, now);
    assert.ok(sparse.compatiblePosterior < 1, "one lucky result is Bayesian-smoothed");
    assert.ok(sparse.uncertainty > 0, "sparse sources retain an exploration signal");
});

test("job requirements distinguish must-have, preferred, negated, and alternative skills", () => {
    const text = `Requirements:\nMust have Node.js and PostgreSQL.\nC# or Kotlin required.\nNice to have Kafka.\nReact experience is not required.`;
    const model = extractJobRequirementModel(text);
    assert.equal(model.find((item) => item.skill === "Node.js").kind, "REQUIRED");
    assert.equal(model.find((item) => item.skill === "Kafka").kind, "PREFERRED");
    assert.equal(model.find((item) => item.skill === "React").kind, "NEGATED");
    const result = evaluateJobRequirements(text, ["Node.js", "PostgreSQL", "Kotlin"]);
    assert.ok(result.score >= 85, "one evidenced alternative satisfies the C#/Kotlin group");
    assert.ok(!result.missing.some((item) => item.requirement === "C#"), "unselected alternatives are not reported missing");
    assert.ok(!result.requirements.includes("React"), "negated skills are excluded from fit scoring");
});

test("candidate profile contact validation rejects labels and normalizes real phone numbers", () => {
    assert.equal(normalizeProfilePhone("Mobile"), "");
    assert.equal(normalizeProfilePhone("+91 700 909 1401"), "+917009091401");
    assert.equal(normalizeProfilePhone("7009091401"), "7009091401");
});

test("career routing supports software, data, and product without matching unrelated titles", () => {
    assert.deepEqual(classifyJobTitle("Salesforce Developer"), {
        family: "SOFTWARE_ENGINEERING", track: "GENERAL_SOFTWARE", confidence: 0.98, label: "Software engineering"
    });
    assert.equal(classifyJobTitle("Senior Data Science Manager").family, "DATA_AI");
    assert.equal(classifyJobTitle("Technical Product Manager").family, "PRODUCT_MANAGEMENT");
    assert.equal(isTargetJobTitle("Data Analyst", ["SOFTWARE_ENGINEERING"]), false);
    assert.equal(isTargetJobTitle("Data Analyst", ["DATA_AI"]), true);
    assert.equal(isTargetJobTitle("Account Executive", ["SOFTWARE_ENGINEERING", "DATA_AI", "PRODUCT_MANAGEMENT"]), false);
});

test("global ingestion quality gates do not depend on the current candidate profile", () => {
    const marker = Date.now();
    const job = {
        company: `Global Data Company ${marker}`,
        title: "Data Engineer",
        location: "Pune, India",
        description: "Build SQL and Python data pipelines.",
        url: `https://jobs.global-registry.invalid/data-${marker}`,
        source: "direct_ats",
        postedAt: new Date().toISOString()
    };
    assert.equal(shouldIngestJob(job, { careerProfiles: ["SOFTWARE_ENGINEERING"] }).ok, true);
    assert.equal(shouldIngestJob(job, { careerProfiles: ["PRODUCT_MANAGEMENT"] }).ok, true);
});

test("heuristic matching separates capability, preference, eligibility, and AI uncertainty", () => {
    const corpus = buildBm25CorpusStats([
        { title: "Backend Engineer", description: "Node.js PostgreSQL AWS Docker REST microservices" },
        { title: "PHP Engineer", description: "PHP Laravel MySQL REST services" },
        { title: "Data Analyst", description: "SQL Tableau product analytics" }
    ]);
    const resume = {
        skills: ["Node.js", "Express.js", "PHP", "Laravel", "PostgreSQL", "Redis", "Kafka", "AWS", "Docker", "REST", "Microservices"],
        skillGroups: {},
        experience: []
    };
    const profile = {
        careerProfiles: ["SOFTWARE_ENGINEERING"],
        targetRoles: ["Node.js Backend Engineer"],
        preferredSkills: ["Node.js", "PostgreSQL"],
        preferredLocations: ["Bengaluru"],
        totalExperienceYears: 4,
        searchProfileVersion: 7
    };
    const description = `${"Node.js PostgreSQL AWS Docker REST Microservices Redis. ".repeat(30)} Minimum 3 years experience.`;
    const nodeResult = evaluateHeuristicMatch({ title: "Backend Engineer", description, location: "Bengaluru, India" }, resume, profile, { corpus });
    const phpResult = evaluateHeuristicMatch({ title: "PHP Backend Engineer", description: "PHP Laravel MySQL REST services. Minimum 3 years experience.", location: "Bengaluru, India" }, resume, profile, { corpus });
    const seniorMismatch = evaluateHeuristicMatch({ title: "Backend Engineer", description: `${description} Minimum 8 years experience.`, yoe_min: 8, location: "India" }, resume, profile, { corpus });
    assert.deepEqual(nodeResult.versions, {
        profileVersion: 7,
        jobMatchVersion: 1,
        algorithmVersion: "matching-policy-v1.3"
    });

    assert.equal(nodeResult.scoringMethod, "MATCHING_POLICY_V1");
    assert.equal(nodeResult.breakdown.roleClassification.family, "SOFTWARE_ENGINEERING");
    assert.ok(nodeResult.matchScore > phpResult.matchScore, "preferred Node.js role outranks an otherwise supported PHP role");
    assert.equal(shouldEscalateToAi(nodeResult), false, "high-evidence deterministic decisions avoid OpenAI");
    assert.equal(seniorMismatch.experienceCompatible, false);
    assert.ok(seniorMismatch.matchScore <= 35, "hard experience mismatch overrides all soft scores");
    assert.equal(shouldEscalateToAi({ matchScore: 74, confidence: 0.55 }), true);
});

test("related technology earns partial matching credit but cannot become a resume claim", () => {
    const postgres = skillMatch("Postgres", ["PostgreSQL"]);
    const pulsar = skillMatch("Apache Pulsar", ["Kafka"]);
    assert.equal(postgres.type, "ALIAS");
    assert.equal(postgres.claimable, true);
    assert.equal(pulsar.type, "EQUIVALENT_CAPABILITY");
    assert.equal(pulsar.claimable, false);
    assert.deepEqual(filterClaimableSkills(["Postgres", "Apache Pulsar"], ["PostgreSQL", "Kafka"]), ["Postgres"]);
});

test("layout-section resume parsing preserves evidence and routes data candidates correctly", () => {
    const profile = buildCandidateResumeProfile({
        text: `Riya Sharma
riya.sharma@example.in
+91 9876543210
https://www.linkedin.com/in/riyasharma

WORK EXPERIENCE
Senior Data Analyst
Acme Analytics
Jan 2022 - Present
• Built SQL and Python reporting pipelines and Tableau dashboards for product analytics.

EDUCATION
B.Tech Computer Science
Delhi University
Aug 2017 - Jun 2021

SKILLS
Python SQL Tableau Power BI Product analytics`
    });
    assert.equal(profile.parserVersion, PARSER_VERSION);
    assert.equal(profile.experience[0].title, "Senior Data Analyst");
    assert.equal(profile.experience[0].company, "Acme Analytics");
    assert.ok(profile.experience[0].evidence?.dateRange);
    assert.equal(profile.education[0].institution, "Delhi University");
    assert.ok(profile.skills.includes("Tableau"));
    assert.ok(profile.searchSuggestions.careerProfiles.includes("DATA_AI"));
    assert.equal(profile.reviewRequired, true, "unverified extraction remains candidate-reviewable");
});

test("repeat discovery skips unchanged jobs, rescores material fresh updates, and rejects stale updates", () => {
    const db = getDb();
    const marker = Date.now();
    const url = `https://jobs.freshness-lock.invalid/backend-${marker}`;
    const base = {
        company: `Freshness Lock ${marker}`,
        title: "Backend Engineer",
        location: "Bengaluru, India",
        description: "Node.js backend role. Minimum 2 years experience.",
        url,
        source: "direct_ats",
        date_posted: new Date().toISOString()
    };
    const candidate = { careerProfiles: ["SOFTWARE_ENGINEERING"] };
    const first = upsertJob(base, { profile: candidate });
    assert.equal(first.inserted, true);
    assert.equal(db.prepare("SELECT match_version FROM jobs WHERE id=?").get(first.id).match_version, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_raw_snapshots WHERE job_id=?").get(first.id).count, 1);
    db.prepare("UPDATE jobs SET status='MATCHED' WHERE id=?").run(first.id);

    const unchanged = upsertJob(base, { profile: candidate });
    assert.equal(unchanged.queuedForScoring, false);
    assert.match(unchanged.reason, /unchanged/);
    assert.equal(db.prepare("SELECT discovery_count FROM jobs WHERE id=?").get(first.id).discovery_count, 2);
    assert.equal(db.prepare("SELECT match_version FROM jobs WHERE id=?").get(first.id).match_version, 1);
    const richer = upsertJob({ ...base, description: `${base.description} AWS Docker PostgreSQL REST microservices.` }, { profile: candidate });
    assert.equal(richer.queuedForScoring, true);
    assert.equal(db.prepare("SELECT match_version FROM jobs WHERE id=?").get(first.id).match_version, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_raw_snapshots WHERE job_id=?").get(first.id).count, 2);

    db.prepare("UPDATE jobs SET status='MATCHED' WHERE id=?").run(first.id);
    const stale = upsertJob({
        ...base,
        date_posted: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        description: `${base.description} ${"old detail ".repeat(40)}`
    }, { profile: candidate });
    assert.equal(stale.queuedForScoring, false);
    assert.match(stale.reason, /older than/);
    assert.equal(canonicalJobUrl(`${url}?utm_source=test`), canonicalJobUrl(url));
    assert.notEqual(jobContentFingerprint(base), jobContentFingerprint({ ...base, description: `${base.description} changed` }));
});

test("fresh pending backlog remains eligible for the next balanced processing run", () => {
    const db = getDb();
    const marker = Date.now();
    db.prepare(`INSERT INTO jobs (id, title, description, url, canonical_url, source, status, posted_at)
        VALUES (?, 'Data Analyst', 'SQL analytics', ?, ?, 'instahyre', 'PENDING', CURRENT_TIMESTAMP)`).run(
        `pending-backlog-${marker}`, `https://jobs.backlog.invalid/${marker}`,
        `https://jobs.backlog.invalid/${marker}`
    );
    db.prepare(`INSERT INTO jobs (id, title, description, url, canonical_url, source, status, posted_at)
        VALUES (?, 'Old Role', 'Old', ?, ?, 'naukri', 'PENDING', datetime('now', '-90 days'))`).run(
        `old-backlog-${marker}`, `https://jobs.backlog.invalid/old-${marker}`,
        `https://jobs.backlog.invalid/old-${marker}`
    );
    const ids = pendingScoringCandidates(db, { maxAgeDays: 30 }).map((item) => item.id);
    assert.ok(ids.includes(`pending-backlog-${marker}`));
    assert.ok(!ids.includes(`old-backlog-${marker}`));
});
