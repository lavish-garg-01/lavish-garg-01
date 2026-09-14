import Database from "better-sqlite3";

const SUPPORTED_NODE_MAJOR = 24;
const actualVersion = process.versions.node;
const actualMajor = Number(actualVersion.split(".")[0]);

if (actualMajor !== SUPPORTED_NODE_MAJOR) {
    throw new Error(
        `Unsupported Node.js ${actualVersion}. This project requires Node.js ${SUPPORTED_NODE_MAJOR}.x. `
        + "Run `nvm use` from the project root, then reinstall dependencies with `npm install`."
    );
}

let db;
try {
    db = new Database(":memory:");
    db.prepare("SELECT 1 AS ready").get();
} catch (error) {
    throw new Error(
        "The better-sqlite3 native module is not built for the active Node.js runtime. "
        + "Run `nvm use 24`, then `npm rebuild better-sqlite3`.",
        { cause: error }
    );
} finally {
    db?.close();
}

console.log(`Runtime ready: Node.js ${actualVersion}, better-sqlite3 ABI ${process.versions.modules}.`);
