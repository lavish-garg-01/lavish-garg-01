#!/usr/bin/env node
import { createRequire } from "node:module";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { readV1CandidateTruthExport } from "./lib/v1-candidate-truth-export.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const databasePath = argument("--database");
const userId = argument("--user");
const outputPath = argument("--output");
if (!databasePath || !userId || !outputPath) {
  console.error(
    "Usage: node scripts/export-v1-candidate-truth.mjs --database <v1.sqlite> --user <v1-user> --output <private.json>"
  );
  process.exitCode = 2;
} else {
  const requireFromV1 = createRequire(new URL("../../package.json", import.meta.url));
  const Database = requireFromV1("better-sqlite3");
  const database = new Database(resolve(databasePath), { readonly: true, fileMustExist: true });
  try {
    const snapshot = readV1CandidateTruthExport(database, userId);
    const output = await open(resolve(outputPath), "wx", 0o600);
    try {
      await output.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8" });
    } finally {
      await output.close();
    }
    console.log(
      `Exported ${snapshot.sources.length} candidate-owned records; excluded ${snapshot.exclusions[0].count} shared form-memory records.`
    );
  } finally {
    database.close();
  }
}

