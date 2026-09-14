import { closeDb } from "../src/database/connection.js";
import { phase1AcceptanceReport } from "../src/services/phase1Acceptance.js";

const report = phase1AcceptanceReport();
console.log(JSON.stringify(report, null, 2));
closeDb();
if (!report.safety.passed) process.exitCode = 1;
