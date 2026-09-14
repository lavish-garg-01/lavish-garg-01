import { closeDb } from "../src/database/connection.js";
import { nextCertificationBatch, seedCareerTargetsFromJobs } from "../src/services/certificationCampaign.js";

const limit = Math.max(1, Math.min(5000, Number(process.argv[2]) || 5000));
const summary = seedCareerTargetsFromJobs({ limit });
console.log(JSON.stringify({ summary, next: nextCertificationBatch({ limit: 25 }).map((item) => ({
    id: item.id, companyName: item.company_name, careerUrl: item.career_url,
    portalKind: item.portal_kind, supportTier: item.support_tier, status: item.status
})) }, null, 2));
closeDb();
