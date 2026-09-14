import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { CandidateTruthService,HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { IdentityService,StaticIdentityTokenVerifier } from "@job-hunter-v2/auth";
import { CandidateSessionService } from "@job-hunter-v2/onboarding";
import { KyselyIdentityRepository,KyselyCandidateTruthRepository,KyselyCandidateBootstrapRepository,KyselyStrategyRepository,type V2Database } from "@job-hunter-v2/database";
import { StrategyIntelligenceService } from "@job-hunter-v2/strategy-intelligence";
import { AdminAuth } from "./admin-auth.js";
import { AdminWorkspace } from "./admin-workspace.js";
import { AdminRepresentationResolver } from "./admin-runtime.js";
import { createApi } from "./app.js";

/** Isolated synthetic database. Never reads the developer .env or employer pages. */
export async function adminFixture() {
  const pg=new PGlite();const directory=new URL("../../../database/migrations/",import.meta.url);
  for(const file of (await readdir(directory)).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort()) await pg.exec(await readFile(new URL(file,directory),"utf8"));
  const db=new Kysely<V2Database>({dialect:new PGliteDialect({pglite:pg})});
  const fingerprinter=new HmacCandidateValueFingerprinter("admin-fixture-secret-".repeat(3),1);
  const truth=new CandidateTruthService(new KyselyCandidateTruthRepository(db),fingerprinter);
  const sessions=new CandidateSessionService(new StaticIdentityTokenVerifier(async()=>({provider:"TEST",providerSubject:"admin-test-candidate",email:"asha@example.test",tokenId:null,expiresAt:new Date(Date.now()+3600000)})),new IdentityService(new KyselyIdentityRepository(db)),truth,new KyselyCandidateBootstrapRepository(db));
  const user=await sessions.authenticate("Bearer synthetic-candidate");
  const strategies=new StrategyIntelligenceService(new KyselyStrategyRepository(db),"admin-fixture-strategy-secret".repeat(3));await strategies.initialize();
  const cluster=await strategies.cluster({capability:"NATIVE_TEXT",representationKind:"TEXT",representationId:"TEXT@1",structuralFingerprint:"a".repeat(64),siteFamily:"OTHER"});
  const runtime=new AdminRepresentationResolver();
  const workspace=new AdminWorkspace(db,"admin@example.test",fingerprinter,runtime,strategies);await workspace.refresh();
  const auth=new AdminAuth("admin@example.test","synthetic-admin-password");
  const app=await createApi({admin:{auth,workspace},corsOrigin:"http://admin.example.test"});
  return {pg,db,workspace,app,user,cluster,runtime,close:async()=>{await app.close();await db.destroy();}};
}
