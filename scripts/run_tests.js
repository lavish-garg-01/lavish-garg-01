import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-tests-"));
const databasePath = path.join(directory, "tests.db");
const files = fs.readdirSync(path.join(root, "test"))
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => path.join("test", name));

try {
    const result = spawnSync(process.execPath, ["--test", ...files], {
        cwd: root,
        env: { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: "test" },
        stdio: "inherit"
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
