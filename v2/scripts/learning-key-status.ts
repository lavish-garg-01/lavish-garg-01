import {createDatabase,learningFingerprintKeyStatus} from "@job-hunter-v2/database";
import {readApiConfig} from "../apps/api/src/config.js";

// Explicit operator invocation, read-only metadata. Does not rotate/configure keys or migrate.
try{
  const config=readApiConfig();
  if(!config.DATABASE_URL||!config.CANDIDATE_VALUE_HMAC_SECRET)throw new Error("Configuration unavailable");
  const db=createDatabase({connectionString:config.DATABASE_URL});
  try{
    const report=await learningFingerprintKeyStatus(db,config.CANDIDATE_VALUE_HMAC_KEY_VERSION,config.CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS?.map(k=>k.keyVersion));
    console.log(JSON.stringify(report,null,2));
    if(report.status!=="KNOWN_VERSIONS_CONFIGURED")process.exitCode=2;
  }finally{await db.destroy();}
}catch{
  console.error("Could not inspect learning key coverage. Check API configuration, database access and migration 0033. No data or keys were changed.");
  process.exitCode=1;
}
