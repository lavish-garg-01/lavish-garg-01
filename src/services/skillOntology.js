function key(value = "") {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/c\+\+/g, "cplusplus")
        .replace(/c#/g, "csharp")
        .replace(/\.net\b/g, "dotnet")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const GROUPS = Object.freeze([
    { canonical: "Node.js", aliases: ["node", "nodejs", "node js"], capability: "server-side-javascript" },
    { canonical: "JavaScript", aliases: ["javascript", "ecmascript"], capability: "programming-language" },
    { canonical: "TypeScript", aliases: ["typescript"], capability: "typed-javascript" },
    { canonical: "Express.js", aliases: ["express", "expressjs", "express js"], capability: "node-web-framework" },
    { canonical: "React", aliases: ["react", "reactjs", "react js"], capability: "frontend-framework" },
    { canonical: "Angular", aliases: ["angular", "angularjs"], capability: "frontend-framework" },
    { canonical: "Vue.js", aliases: ["vue", "vuejs", "vue js"], capability: "frontend-framework" },
    { canonical: "Java", aliases: ["java"], capability: "jvm-language" },
    { canonical: "Kotlin", aliases: ["kotlin"], capability: "jvm-language" },
    { canonical: "Spring Boot", aliases: ["spring boot", "springboot", "spring framework"], capability: "jvm-web-framework" },
    { canonical: "Python", aliases: ["python", "python3"], capability: "programming-language" },
    { canonical: "Go", aliases: ["golang", "go language"], capability: "programming-language" },
    { canonical: "PHP", aliases: ["php"], capability: "programming-language" },
    { canonical: "Laravel", aliases: ["laravel"], capability: "php-web-framework" },
    { canonical: "C#", aliases: ["csharp", "c sharp"], capability: "dotnet-language" },
    { canonical: ".NET", aliases: ["dotnet", "asp net", "aspnet"], capability: "dotnet-framework" },
    { canonical: "PostgreSQL", aliases: ["postgresql", "postgres", "postgre sql"], capability: "relational-database" },
    { canonical: "MySQL", aliases: ["mysql", "my sql"], capability: "relational-database" },
    { canonical: "SQL", aliases: ["sql", "relational database", "rdbms"], capability: "relational-database" },
    { canonical: "MongoDB", aliases: ["mongodb", "mongo db", "mongo"], capability: "document-database" },
    { canonical: "Redis", aliases: ["redis"], capability: "cache-key-value" },
    { canonical: "Kafka", aliases: ["apache kafka", "kafka"], capability: "event-streaming" },
    { canonical: "RabbitMQ", aliases: ["rabbitmq", "rabbit mq"], capability: "message-broker" },
    { canonical: "Apache Pulsar", aliases: ["apache pulsar", "pulsar"], capability: "event-streaming" },
    { canonical: "AWS", aliases: ["aws", "amazon web services"], capability: "cloud-platform" },
    { canonical: "GCP", aliases: ["gcp", "google cloud", "google cloud platform"], capability: "cloud-platform" },
    { canonical: "Azure", aliases: ["azure", "microsoft azure"], capability: "cloud-platform" },
    { canonical: "Docker", aliases: ["docker", "containers", "containerization"], capability: "containers" },
    { canonical: "Kubernetes", aliases: ["kubernetes", "k8s"], capability: "container-orchestration" },
    { canonical: "Terraform", aliases: ["terraform", "infrastructure as code", "iac"], capability: "infrastructure-as-code" },
    { canonical: "Prometheus", aliases: ["prometheus"], capability: "observability" },
    { canonical: "Grafana", aliases: ["grafana"], capability: "observability" },
    { canonical: "Datadog", aliases: ["datadog", "data dog"], capability: "observability" },
    { canonical: "REST", aliases: ["rest", "rest api", "restful", "restful api"], capability: "api-design" },
    { canonical: "GraphQL", aliases: ["graphql", "graph ql"], capability: "api-design" },
    { canonical: "Microservices", aliases: ["microservices", "micro services", "service oriented architecture"], capability: "distributed-services" },
    { canonical: "Python data", aliases: ["pandas", "numpy", "scikit learn", "sklearn"], capability: "data-analysis" },
    { canonical: "Machine Learning", aliases: ["machine learning", "ml", "predictive modeling"], capability: "machine-learning" },
    { canonical: "Spark", aliases: ["apache spark", "spark", "pyspark"], capability: "distributed-data-processing" },
    { canonical: "Airflow", aliases: ["apache airflow", "airflow"], capability: "workflow-orchestration" },
    { canonical: "Power BI", aliases: ["power bi", "powerbi"], capability: "business-intelligence" },
    { canonical: "Tableau", aliases: ["tableau"], capability: "business-intelligence" },
    { canonical: "Product discovery", aliases: ["product discovery", "customer discovery", "user research"], capability: "product-management" },
    { canonical: "Product analytics", aliases: ["product analytics", "amplitude", "mixpanel"], capability: "product-analytics" },
    { canonical: "Roadmapping", aliases: ["product roadmap", "roadmapping", "roadmap"], capability: "product-management" },
    { canonical: "Agile", aliases: ["agile", "scrum", "kanban"], capability: "delivery-management" }
]);

const BY_ALIAS = new Map();
for (const group of GROUPS) {
    for (const alias of [group.canonical, ...group.aliases]) BY_ALIAS.set(key(alias), group);
}

const RELATED = Object.freeze({
    "event-streaming": new Set(["message-broker"]),
    "message-broker": new Set(["event-streaming"]),
    "cloud-platform": new Set(["infrastructure-as-code", "containers", "container-orchestration"]),
    "observability": new Set(["cloud-platform"]),
    "relational-database": new Set(["document-database"]),
    "api-design": new Set(["distributed-services", "node-web-framework", "jvm-web-framework"]),
    "frontend-framework": new Set(["typed-javascript", "programming-language"]),
    "business-intelligence": new Set(["data-analysis", "product-analytics"]),
    "data-analysis": new Set(["business-intelligence", "machine-learning"]),
    "product-management": new Set(["product-analytics", "delivery-management"])
});

export function canonicalSkill(value = "") {
    const normalized = key(value);
    const group = BY_ALIAS.get(normalized);
    return group ? { canonical: group.canonical, capability: group.capability, normalized } : {
        canonical: String(value || "").trim(), capability: null, normalized
    };
}

export function skillMatch(requirement, candidateSkills = []) {
    const requested = canonicalSkill(requirement);
    let best = { type: "NONE", credit: 0, claimable: false, requirement: requested.canonical, evidence: null };
    for (const candidate of candidateSkills || []) {
        const owned = canonicalSkill(candidate);
        if (!requested.normalized || !owned.normalized) continue;
        if (requested.normalized === owned.normalized) {
            return { type: "EXACT", credit: 1, claimable: true, requirement: requested.canonical, evidence: candidate };
        }
        if (requested.canonical === owned.canonical && requested.capability) {
            return { type: "ALIAS", credit: 0.98, claimable: true, requirement: requested.canonical, evidence: candidate };
        }
        if (requested.capability && requested.capability === owned.capability) {
            const sameCapability = { type: "EQUIVALENT_CAPABILITY", credit: 0.78, claimable: false, requirement: requested.canonical, evidence: candidate };
            if (sameCapability.credit > best.credit) best = sameCapability;
        } else if (requested.capability && owned.capability && RELATED[requested.capability]?.has(owned.capability)) {
            const related = { type: "TRANSFERABLE", credit: 0.58, claimable: false, requirement: requested.canonical, evidence: candidate };
            if (related.credit > best.credit) best = related;
        }
    }
    return best;
}

export function extractKnownSkills(text = "") {
    const normalized = ` ${key(text)} `;
    const found = [];
    for (const group of GROUPS) {
        if ([group.canonical, ...group.aliases].some((alias) => {
            const needle = key(alias);
            return needle.length > 1 && normalized.includes(` ${needle} `);
        })) found.push(group.canonical);
    }
    return [...new Set(found)];
}

export function evaluateSkillRequirements(jobText = "", candidateSkills = []) {
    const requirements = extractKnownSkills(jobText);
    const matches = requirements.map((requirement) => skillMatch(requirement, candidateSkills));
    const totalCredit = matches.reduce((sum, match) => sum + match.credit, 0);
    return {
        requirements,
        matches,
        score: requirements.length ? Math.round((totalCredit / requirements.length) * 100) : 50,
        exact: matches.filter((match) => ["EXACT", "ALIAS"].includes(match.type)),
        transferable: matches.filter((match) => ["EQUIVALENT_CAPABILITY", "TRANSFERABLE"].includes(match.type)),
        missing: matches.filter((match) => match.type === "NONE")
    };
}

export function filterClaimableSkills(skills = [], candidateSkills = []) {
    return [...new Set((skills || []).filter((skill) => skillMatch(skill, candidateSkills).claimable))];
}

export const SKILL_GROUPS = GROUPS;
