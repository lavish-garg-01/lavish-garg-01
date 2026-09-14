import { createHash,randomUUID } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import { join,relative } from "node:path";
import { z } from "zod";
import { createDatabase,ReviewedExportRepository,KyselyStrategyRepository,assertReviewDatabaseRole } from "@job-hunter-v2/database";
import { StrategyIntelligenceService } from "@job-hunter-v2/strategy-intelligence";
import { validateStrategyOffline } from "./strategy-offline.js";

// Trusted local/CI runner, not a public proof-upload channel. Never prints definitions or credentials.
const artifactId=z.uuid().parse(process.argv[2]);
if(!process.env.REVIEW_EVALUATOR_DATABASE_URL)throw new Error("Trusted worker requires a dedicated REVIEW_EVALUATOR_DATABASE_URL.");
const root=new URL("../",import.meta.url).pathname;
async function sources(dir:string):Promise<string[]>{const entries=await readdir(dir,{withFileTypes:true});const files:string[]=[];for(const entry of entries){if(["node_modules",".local-data"].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())files.push(...await sources(path));else if(/\.(ts|tsx|js|mjs|json)$/.test(entry.name))files.push(path);}return files;}
async function corpusHash(){const hash=createHash("sha256");const files=[...await sources(join(root,"apps/extension/src")),...await sources(join(root,"packages")),join(root,"scripts/strategy-offline.ts"),join(root,"scripts/reviewed-export-evaluate.ts"),join(root,"package-lock.json")].sort();for(const file of files){hash.update(relative(root,file));hash.update("\0");hash.update(await readFile(file));hash.update("\0");}return hash.digest("hex");}
const database=createDatabase({connectionString:process.env.REVIEW_EVALUATOR_DATABASE_URL});
try{
  await assertReviewDatabaseRole(database,"evaluator");
  // The fixture's legacy attestation is discarded. Never share the live Q signing key.
  const q=new StrategyIntelligenceService(new KyselyStrategyRepository(database),randomUUID()+randomUUID());
  const result=await new ReviewedExportRepository(database).evaluate(artifactId,{run:async definition=>{
    const suiteHash=await corpusHash();
    try{const proof=await validateStrategyOffline(definition,randomUUID(),q);const unchanged=suiteHash===await corpusHash();return {suiteHash,passed:unchanged&&Object.values(proof.checks).every(Boolean)};}catch{return {suiteHash,passed:false};}
  }});
  console.log(JSON.stringify({artifactId,...result,mode:"INDEPENDENT_SYNTHETIC_BROWSER_EVALUATION"}));if(!result.passed)process.exitCode=1;
}catch{console.error("Reviewed evaluation failed; no private details emitted.");process.exitCode=1;}finally{await database.destroy();}
