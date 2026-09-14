import {readFile,readdir} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {Kysely,PGliteDialect} from "kysely";
import type {V2Database} from "@job-hunter-v2/database";
import {runLearningJourney} from "./learning-journey.js";
// No DATABASE_URL access: this executable always uses a fresh in-memory database.
const pg=new PGlite(),db=new Kysely<V2Database>({dialect:new PGliteDialect({pglite:pg})});
try{
  const dir=new URL('../database/migrations/',import.meta.url);for(const file of(await readdir(dir)).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort())await pg.exec(await readFile(new URL(file,dir),'utf8'));
  const report=await runLearningJourney(db);console.log(JSON.stringify(report,null,2));if(report.wrong!==0||report.correct!==57||report.baselineCorrect!==0)process.exitCode=1;
}finally{await db.destroy();}
