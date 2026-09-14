# Database migration contract

`src/database/schema.sql` and the legacy compatibility function in
`src/database/connection.js` form the checksum-locked `0000_legacy_baseline`
migration. They are frozen after Phase 0.

All future database changes must:

1. Create an append-only module in `src/database/migrations/` with
   `defineMigration({ id, description, up, verify })`.
2. Use an ID such as `0001_job_lifecycle`; never edit or delete an applied ID.
3. Export the migration from `src/database/migrations/index.js`.
4. Prefer expand → backfill → verify → contract. Do not drop or rename data in
   the same release that stops writing the old shape.
5. Update `CONNECTED_JOBS_REPOSITORY_CONTRACT` when a repository starts relying
   on a new table or column.
6. Add a migration test against a copy or temporary database.

Before any pending file-database migration, the runner creates a SQLite backup
under `<database directory>/backups/`. Each migration is also wrapped in a
transaction and verified before commit. The backup path and checksum are stored
in `schema_migrations`.

Rollback procedure:

1. Stop the backend and preserve the failed database plus its WAL files.
2. Copy the backup named in `schema_migrations.backup_path` back to the configured
   database path.
3. Start the previous application version and run its startup check.

SQLite and the future Postgres/Supabase adapter must both pass the same
adapter-neutral repository contract before serving traffic.
