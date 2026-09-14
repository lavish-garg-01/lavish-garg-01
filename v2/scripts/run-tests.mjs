import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !["dist", "node_modules"].includes(entry.name)) {
      tests.push(...(await findTests(path)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      tests.push(path);
    }
  }
  return tests;
}

const tests = [
  ...(await findTests(new URL("../apps", import.meta.url).pathname)),
  ...(await findTests(new URL("../packages", import.meta.url).pathname)),
  ...(await findTests(new URL("../tests", import.meta.url).pathname))
].sort();

if (tests.length === 0) {
  throw new Error("No V2 tests were found.");
}

// Node 24.8 on arm64 can crash in V8's Wasm tier-up cleanup while PGlite test
// files tear down. Keep files serial and disable tier-up only for that affected
// runtime; repository tests still exercise their own intentional concurrency.
const affectedWasmRuntime = process.arch === "arm64" && /^24\.8\./.test(process.versions.node);
const child = spawn(process.execPath, [
  ...(affectedWasmRuntime ? ["--no-wasm-tier-up"] : []),
  "--import", "tsx", "--test", "--test-concurrency=1", ...tests
], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
