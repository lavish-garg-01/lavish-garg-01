import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const steps = [
    ["runtime and SQLite ABI", ["scripts/check_runtime.js"]],
    ["startup and local UI", ["scripts/check_start.js"]],
    ["backend/extension contract synchronization", ["scripts/generate_extension_contract_validator.js", "--check"]],
    ["architecture ownership", ["scripts/check_architecture_index.js"]],
    ["complete regression and replay corpus", ["scripts/run_tests.js"]]
];

for (const [label, args] of steps) {
    console.log(`\n[Phase 0] ${label}`);
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        env: { ...process.env, NODE_ENV: "test" },
        stdio: "inherit"
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        console.error(`[Phase 0] FAILED: ${label}`);
        process.exit(result.status ?? 1);
    }
}

console.log("\nPhase 0 acceptance passed: runtime, startup, architecture, privacy, browser, and replay gates are green.");
