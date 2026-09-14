import {sql,type Kysely} from "kysely";
import type {V2Database} from "./index.js";

/** Trusted maintenance only. Counts/version metadata, never note payloads or fingerprint digests. */
export async function learningFingerprintKeyStatus(db:Kysely<V2Database>,activeVersion:number,historicalVersions:readonly number[]=[]){
  if(!Number.isSafeInteger(activeVersion)||activeVersion<1||historicalVersions.length>4||historicalVersions.some(v=>!Number.isSafeInteger(v)||v<1||v>=activeVersion)||new Set(historicalVersions).size!==historicalVersions.length)throw new Error("Invalid fingerprint version inventory.");
  const available=new Set([activeVersion,...historicalVersions]);
  const result=await sql<{source:string;key_version:number|null;rows:string}>`
    SELECT 'NOTE_EVIDENCE' AS source,fingerprint_key_version AS key_version,count(*)::text AS rows FROM candidate_learning_inbox GROUP BY fingerprint_key_version
    UNION ALL SELECT 'NOTE_RECEIPT',fingerprint_key_version,count(*)::text FROM candidate_learning_note_confirmations GROUP BY fingerprint_key_version
    UNION ALL SELECT 'PENDING_OBSERVATION',fingerprint_key_version,count(*)::text FROM candidate_learning_observations WHERE status='RECORDED' AND expires_at>clock_timestamp() GROUP BY fingerprint_key_version
    ORDER BY source,key_version NULLS FIRST
  `.execute(db);
  const groups=result.rows.map(row=>({...row,availability:row.key_version===null?"UNVERSIONED_LEGACY":available.has(row.key_version)?"CONFIGURED":"MISSING"}));
  return {scope:"LEARNING_REPLAY_ONLY" as const,activeVersion,groups,status:groups.some(g=>g.availability==="MISSING")?"MISSING_HISTORICAL_KEYS":groups.some(g=>g.availability==="UNVERSIONED_LEGACY")?"LEGACY_REVIEW_REQUIRED":"KNOWN_VERSIONS_CONFIGURED",containsCandidateValue:false as const};
}
