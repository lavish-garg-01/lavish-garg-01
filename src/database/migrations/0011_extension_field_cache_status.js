import { defineMigration } from "../migrationRunner.js";

export const extensionFieldCacheStatusMigration = defineMigration({
    id: "0011_extension_field_cache_status",
    description: "Track pending versus successfully resolved extension field deltas",
    up(db) {
        db.exec(`
            ALTER TABLE extension_run_field_cache
                ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING';
        `);
    },
    verify(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(extension_run_field_cache)").all().map((column) => column.name));
        return columns.has("status");
    }
});

