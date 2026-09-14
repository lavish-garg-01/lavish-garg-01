import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MIGRATION_ID = /^\d{4}_[a-z0-9_]+$/;

function checksum(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function migrationTableExists(db) {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
}

function ensureMigrationTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            checksum TEXT NOT NULL,
            backup_path TEXT,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function sqliteLiteral(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

function createBackup(db, databasePath, backupDirectory, nextMigrationId, now = new Date()) {
    if (!databasePath || databasePath === ":memory:") return null;
    const absoluteDatabasePath = path.resolve(databasePath);
    if (!fs.existsSync(absoluteDatabasePath)) return null;

    const directory = backupDirectory || path.join(path.dirname(absoluteDatabasePath), "backups");
    fs.mkdirSync(directory, { recursive: true });
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const destination = path.join(directory, `${path.basename(absoluteDatabasePath)}.${timestamp}.${nextMigrationId}.bak`);

    db.pragma("wal_checkpoint(FULL)");
    db.exec(`VACUUM INTO ${sqliteLiteral(destination)}`);
    return destination;
}

export function defineMigration({ id, description, up, verify, checksumSource = null }) {
    if (!MIGRATION_ID.test(String(id || ""))) {
        throw new Error(`Migration id must match ${MIGRATION_ID}: ${id || "<missing>"}`);
    }
    if (!String(description || "").trim()) throw new Error(`Migration ${id} requires a description.`);
    if (typeof up !== "function") throw new Error(`Migration ${id} requires an up(db) function.`);
    if (verify !== undefined && typeof verify !== "function") throw new Error(`Migration ${id} verify must be a function.`);
    const source = checksumSource ?? `${id}\n${description}\n${up.toString()}\n${verify?.toString() || ""}`;
    return Object.freeze({ id, description: String(description).trim(), up, verify, checksum: checksum(source) });
}

/**
 * Applies append-only SQLite migrations.
 *
 * Every non-memory migration batch gets a point-in-time backup. Every
 * migration is transactional, verified before commit, and checksum-locked so
 * an already-applied file cannot be edited silently.
 */
export function runMigrations(db, {
    migrations = [],
    databasePath = db.name,
    backupDirectory,
    now = new Date()
} = {}) {
    const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
    const ids = new Set();
    for (const migration of ordered) {
        if (!migration?.id || !migration?.checksum || typeof migration.up !== "function") {
            throw new Error("All migrations must be created with defineMigration().");
        }
        if (ids.has(migration.id)) throw new Error(`Duplicate migration id: ${migration.id}`);
        ids.add(migration.id);
    }

    const hasTable = migrationTableExists(db);
    const appliedRows = hasTable
        ? db.prepare("SELECT id, checksum FROM schema_migrations ORDER BY id").all()
        : [];
    const known = new Map(ordered.map((migration) => [migration.id, migration]));
    for (const row of appliedRows) {
        const migration = known.get(row.id);
        if (!migration) throw new Error(`Applied migration ${row.id} is missing from the migration registry.`);
        if (migration.checksum !== row.checksum) {
            throw new Error(`Applied migration ${row.id} was modified. Add a new migration instead of editing history.`);
        }
    }

    const appliedIds = new Set(appliedRows.map((row) => row.id));
    const pending = ordered.filter((migration) => !appliedIds.has(migration.id));
    if (!pending.length) return { applied: [], backupPath: null };

    const backupPath = createBackup(db, databasePath, backupDirectory, pending[0].id, now);
    ensureMigrationTable(db);
    const insert = db.prepare(`INSERT INTO schema_migrations
        (id, description, checksum, backup_path) VALUES (?, ?, ?, ?)`);
    const findApplied = db.prepare("SELECT checksum FROM schema_migrations WHERE id = ?");
    const applied = [];

    for (const migration of pending) {
        const apply = db.transaction(() => {
            // Another local process can finish the same pending migration while
            // this process waits for SQLite's write lock (for example Node's
            // parallel test workers or two local app commands). Re-check after
            // entering the transaction so stale pre-lock state never replays DDL.
            const concurrent = findApplied.get(migration.id);
            if (concurrent) {
                if (concurrent.checksum !== migration.checksum) {
                    throw new Error(`Applied migration ${migration.id} was modified. Add a new migration instead of editing history.`);
                }
                return false;
            }
            migration.up(db);
            const verified = migration.verify?.(db);
            if (verified === false) throw new Error(`Migration ${migration.id} verification failed.`);
            insert.run(migration.id, migration.description, migration.checksum, backupPath);
            return true;
        });
        // IMMEDIATE obtains the write reservation before the in-transaction
        // re-check, avoiding a deferred read-to-write upgrade race.
        if (apply.immediate()) applied.push(migration.id);
    }

    return { applied, backupPath: applied.length ? backupPath : null };
}
