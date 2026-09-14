import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { closeDb, getDb } from "../src/database/connection.js";
import { defineMigration, runMigrations } from "../src/database/migrationRunner.js";
import {
    assertRepositoryContract,
    assertSqliteRepositoryContract,
    CONNECTED_JOBS_REPOSITORY_CONTRACT,
    sqliteRepositoryShape
} from "../src/database/repositoryContract.js";

test("file migrations create a pre-change backup, apply once, and checksum-lock history", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-migration-contract-"));
    const databasePath = path.join(directory, "source.db");
    const db = new Database(databasePath);
    try {
        db.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('before');");
        const migration = defineMigration({
            id: "0001_example_table",
            description: "Create an example table",
            up(database) {
                database.exec("CREATE TABLE example (id TEXT PRIMARY KEY)");
            },
            verify(database) {
                return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='example'").get());
            }
        });

        const result = runMigrations(db, {
            migrations: [migration],
            databasePath,
            now: new Date("2026-08-28T10:00:00.000Z")
        });
        assert.deepEqual(result.applied, ["0001_example_table"]);
        assert.ok(result.backupPath && fs.existsSync(result.backupPath));
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM example").get().count, 0);
        assert.equal(db.prepare("SELECT backup_path FROM schema_migrations WHERE id=?").get(migration.id).backup_path, result.backupPath);

        const backup = new Database(result.backupPath, { readonly: true });
        try {
            assert.equal(backup.prepare("SELECT value FROM marker").get().value, "before");
            assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='example'").get(), undefined);
        } finally {
            backup.close();
        }

        assert.deepEqual(runMigrations(db, { migrations: [migration], databasePath }).applied, []);
        const editedHistory = defineMigration({
            id: migration.id,
            description: "Illegally edit an applied migration",
            up(database) { database.exec("CREATE TABLE changed_history (id TEXT)"); }
        });
        assert.throws(() => runMigrations(db, { migrations: [editedHistory], databasePath }), /was modified/);
    } finally {
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("a failed migration rolls back its schema changes and is not recorded", () => {
    const db = new Database(":memory:");
    try {
        const migration = defineMigration({
            id: "0001_failure_case",
            description: "Prove transactional rollback",
            up(database) { database.exec("CREATE TABLE should_rollback (id TEXT)"); },
            verify() { return false; }
        });
        assert.throws(() => runMigrations(db, { migrations: [migration] }), /verification failed/);
        assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='should_rollback'").get(), undefined);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 0);
    } finally {
        db.close();
    }
});

test("the SQLite backend satisfies the adapter-neutral Connected Jobs repository contract", () => {
    try {
        const db = getDb();
        assert.equal(assertSqliteRepositoryContract(db), true);
        const shape = sqliteRepositoryShape(db);
        assert.equal(assertRepositoryContract(shape), true);
        assert.equal(CONNECTED_JOBS_REPOSITORY_CONTRACT.version, 5);

        const drifted = structuredClone(shape);
        drifted.tables.jobs.columns = drifted.tables.jobs.columns.filter((column) => column !== "content_fingerprint");
        assert.throws(() => assertRepositoryContract(drifted), /missing column jobs.content_fingerprint/);
    } finally {
        closeDb();
    }
});
