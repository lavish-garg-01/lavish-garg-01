import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const runtimeRoots = [resolve(root, "apps"), resolve(root, "packages")];
const packageDependencies = new Map([
  ["contracts", new Set()],
  ["ai", new Set(["contracts"])],
  ["strategy-intelligence", new Set(["contracts", "ai"])],
  ["domain", new Set()],
  ["auth", new Set(["contracts", "domain"])],
  ["entitlements", new Set(["contracts", "domain"])],
  ["candidate-truth", new Set(["contracts", "domain"])],
  ["repeatable-entities", new Set(["contracts", "domain"])],
  ["form-graph", new Set(["contracts"])],
  ["declaration-policy", new Set(["contracts"])],
  ["field-intelligence", new Set(["candidate-truth", "contracts", "domain", "repeatable-entities"])],
  ["execution", new Set(["candidate-truth", "contracts", "domain", "declaration-policy", "field-intelligence", "form-graph"])],
  ["verified-learning", new Set(["candidate-truth", "contracts", "domain"])],
  ["job-intelligence", new Set(["candidate-truth", "contracts", "domain"])],
  ["onboarding", new Set(["auth", "candidate-truth", "contracts", "domain"])],
  ["database", new Set(["ai", "auth", "candidate-truth", "contracts", "declaration-policy", "domain", "entitlements", "job-intelligence", "onboarding", "repeatable-entities", "verified-learning"])],
  ["api", new Set(["ai", "auth", "candidate-truth", "contracts", "database", "declaration-policy", "domain", "entitlements", "execution", "field-intelligence", "form-graph", "job-intelligence", "onboarding", "repeatable-entities", "verified-learning"])],
  ["extension", new Set(["contracts", "form-graph"])]
]);
packageDependencies.get("database").add("strategy-intelligence");
packageDependencies.get("api").add("strategy-intelligence");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && !["dist", "node_modules"].includes(entry.name)) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const runtimeRoot of runtimeRoots) {
  for (const file of await sourceFiles(runtimeRoot)) {
    const content = await readFile(file, "utf8");
    const name = relative(root, file);
    const checks = [
      [/from\s+["'][^"']*(?:\.\.\/){2,}(?:src|extension|web)\//, "V2 runtime imports V1 implementation"],
      [/\bisPaid\b/, "isPaid-style entitlement branching is forbidden"],
      [/\bFORM_[AB]\b|\bForm [AB]\b/, "Form A/Form B may only exist in fixtures"],
      [/\beval\s*\(|new\s+Function\s*\(/, "runtime code evaluation is forbidden"]
    ];
    if (!name.endsWith(".test.ts")) {
      checks.push(
        [
          /(?:from\s+["']better-sqlite3["']|require\s*\(\s*["']better-sqlite3["']\s*\))/, 
          "V2 runtime cannot open the V1 SQLite database"
        ],
        [
          /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:candidate_profiles|candidate_fact_memory|candidate_answers|resume_versions|form_answers)\b/i,
          "V2 runtime cannot read or write V1 tables"
        ]
      );
    }
    for (const [pattern, message] of checks) {
      if (pattern.test(content)) violations.push(`${name}: ${message}`);
    }

    const segments = name.split("/");
    const owner = segments[0] === "apps" || segments[0] === "packages" ? segments[1] : undefined;
    if (owner && packageDependencies.has(owner)) {
      for (const match of content.matchAll(/from\s+["']@job-hunter-v2\/([^"']+)["']/g)) {
        const dependency = match[1];
        if (dependency && dependency !== owner && !packageDependencies.get(owner)?.has(dependency)) {
          violations.push(`${name}: ${owner} cannot import @job-hunter-v2/${dependency}`);
        }
      }
    }

    if (!name.startsWith("packages/ai/") && /from\s+["'](?:openai|@google\/generative-ai|groq-sdk)["']/.test(content)) {
      violations.push(`${name}: AI provider SDKs belong behind packages/ai adapters`);
    }
    if (!name.endsWith(".test.ts") && !name.startsWith("packages/ai/") &&
      /api\.openai\.com|api\.groq\.com|generativelanguage\.googleapis\.com|from\s+["'](?:@google\/genai|@anthropic-ai\/sdk)["']/.test(content)) {
      violations.push(`${name}: direct model HTTP/SDK calls belong behind packages/ai adapters`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("V2 architecture checks passed.");
}
