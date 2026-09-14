import assert from "node:assert/strict";
import test from "node:test";
import {HmacCandidateValueFingerprinter,candidateFingerprintMatches} from "./candidate-truth-service.js";

const oldSecret="synthetic-old-fingerprint-secret-32-bytes",newSecret="synthetic-new-fingerprint-secret-32-bytes";
const value={schemaVersion:1 as const,dataClass:"CANDIDATE_PRIVATE" as const,kind:"STRING" as const,value:"synthetic private answer"};
test("fingerprint history is verification-only, version-bound and bounded",()=>{
  const old=new HmacCandidateValueFingerprinter(oldSecret,1),active=new HmacCandidateValueFingerprinter(newSecret,2,[{keyVersion:1,secret:oldSecret}]);
  assert.equal(active.fingerprint(value).keyVersion,2);
  assert.notEqual(active.fingerprint(value).digest,old.fingerprint(value).digest);
  assert.equal(candidateFingerprintMatches(active,value,old.fingerprint(value)),true);
  assert.equal(candidateFingerprintMatches(active,value,{digest:old.fingerprint(value).digest,keyVersion:null}),true);
  assert.equal(candidateFingerprintMatches(active,value,{digest:old.fingerprint(value).digest,keyVersion:2}),false);
  assert.equal(candidateFingerprintMatches(active,{...value,value:"changed"},old.fingerprint(value)),false);
  assert.equal(candidateFingerprintMatches(new HmacCandidateValueFingerprinter(newSecret,2),value,old.fingerprint(value)),false);
  assert.equal(candidateFingerprintMatches(active,value,{digest:"invalid",keyVersion:1}),false);
  for(const history of [[{keyVersion:2,secret:oldSecret}],[{keyVersion:0,secret:oldSecret}],[{keyVersion:1,secret:"short"}],[{keyVersion:1,secret:newSecret}],[{keyVersion:1,secret:oldSecret},{keyVersion:1,secret:oldSecret}],Array.from({length:5},(_,i)=>({keyVersion:i+1,secret:oldSecret}))])assert.throws(()=>new HmacCandidateValueFingerprinter(newSecret,2,history));
});
