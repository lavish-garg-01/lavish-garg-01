import { createDatabase, purgeExpiredLearningInbox } from "@job-hunter-v2/database";

// Run only from trusted maintenance tooling. The DB credential never enters output.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for maintenance.");
const database = createDatabase({ connectionString: process.env.DATABASE_URL });
try {
  let purged = 0;
  for (let batch = 0; batch < 10; batch++) {
    const result = await purgeExpiredLearningInbox(database);
    purged += result.purged;
    if (result.purged < 1000) break;
  }
  console.log(JSON.stringify({ purged, batchLimit: 10, note: "Expired ciphertext only; replay tombstones and profile answers are preserved." }));
} catch {
  console.error("Learning inbox cleanup failed. Check maintenance database access and migrations; no private details emitted.");
  process.exitCode = 1;
} finally { await database.destroy(); }
