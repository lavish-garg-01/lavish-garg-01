import { defineMigration } from "../migrationRunner.js";

export const employerEntityExactAliasesMigration = defineMigration({
    id: "0014_employer_entity_exact_aliases",
    description: "Allow exact duplicate employer signatures to map distinct source company ids to one controlled employer group",
    up(db) {
        db.exec(`
            CREATE TABLE employer_entities_v2 (
                id TEXT PRIMARY KEY,
                employer_group_id TEXT NOT NULL,
                company_id TEXT,
                normalized_name TEXT NOT NULL,
                normalized_domain TEXT NOT NULL DEFAULT '',
                legal_name TEXT,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(employer_group_id) REFERENCES employer_entity_groups(id),
                FOREIGN KEY(company_id) REFERENCES companies(id),
                UNIQUE(company_id)
            );
            INSERT INTO employer_entities_v2
                (id, employer_group_id, company_id, normalized_name, normalized_domain,
                 legal_name, status, created_at, updated_at)
            SELECT id, employer_group_id, company_id, normalized_name, normalized_domain,
                   legal_name, status, created_at, updated_at
            FROM employer_entities;
            DROP TABLE employer_entities;
            ALTER TABLE employer_entities_v2 RENAME TO employer_entities;
            CREATE INDEX employer_entity_exact_name
                ON employer_entities(normalized_name, status);
            CREATE INDEX employer_entity_exact_domain
                ON employer_entities(normalized_domain, status);
        `);
    },
    verify(db) {
        const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employer_entities'").get()?.sql || "";
        return /UNIQUE\s*\(\s*company_id\s*\)/i.test(sql)
            && !/UNIQUE\s*\(\s*normalized_name\s*,\s*normalized_domain\s*\)/i.test(sql);
    }
});
