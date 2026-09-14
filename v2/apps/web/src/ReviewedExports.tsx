import { useState } from "react";
import type { CandidateApi } from "./api.js";
export function ReviewedExports({api,caseId}:{api:CandidateApi;caseId:string}){
  const [data,setData]=useState<Awaited<ReturnType<CandidateApi["reviewedArtifacts"]>>|null>(null),[key,setKey]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [manifest,setManifest]=useState<Record<string,unknown>|null>(null);
  const load=async()=>{setData(await api.reviewedArtifacts(caseId));};
  const act=async(work:()=>Promise<unknown>)=>{setBusy(true);setMessage("");setManifest(null);try{await work();await load();}catch{setData(null);setMessage("Action not confirmed. Refresh; check MFA, independent administrator approval, evaluation and revision. This feature may be disabled.");}finally{setBusy(false);}};
  return <details><summary>Reviewed strategy exports</summary><p>Review existing registered strategy definitions. This prepares an auditable export only: it does not deploy code, start a canary or change application autofill. Existing Q rollout gates remain mandatory.</p>
    <button disabled={busy} onClick={()=>void act(async()=>{})}>Load reviewed artifacts</button>
    {data&&<div><label>Registered strategy<select aria-label="Registered strategy" disabled={busy} value={key} onChange={e=>setKey(e.target.value)}><option value="">Choose a version</option>{data.strategyKeys.map(k=><option key={k}>{k}</option>)}</select></label><button disabled={busy||!key} onClick={()=>void act(()=>api.proposeReviewed(caseId,key))}>Propose exact version</button>
      {data.artifacts.map(a=>{const approval=a.approvals.find(p=>p.evaluation_id===a.evaluation?.id);return <article key={a.id}><h3>{a.strategy_key}</h3><p>Artifact {a.id} · proposed by {a.subject}</p><p style={{overflowWrap:"anywhere"}}>Hash: {a.artifact_hash}</p><p>{a.evaluation?(a.evaluation.passed&&a.evaluation.live?"Passing evaluation — synthetic browser corpus":"Evaluation failed, superseded or expired"):"Independent evaluation required"}</p>
        <p>Trusted evaluator command: <code>npm run review:evaluate -- {a.id}</code>. Operator-supplied passing proofs are not accepted.</p>
        <button disabled={busy||!a.evaluation?.passed||!a.evaluation.live} onClick={()=>{if(window.confirm("Approve this exact artifact and evaluation? You must be a different administrator from its proposer."))void act(()=>api.approveReviewed(a.id,a.artifact_hash,a.evaluation!.id));}}>Approve evaluated artifact</button>
        <button disabled={busy||!approval||!a.evaluation?.passed||!a.evaluation.live} onClick={()=>{if(window.confirm("Prepare this approved export? This does not deploy or activate autofill behavior."))void act(()=>api.prepareReviewed(a.id,approval!.id,data.state.revision));}}>Prepare approved export</button>
      </article>;})}
      <p>Export selection revision {data.state.revision} · {data.state.disabled?"Disabled":"Prepared, not deployed"}</p>
      <button disabled={busy} onClick={()=>void act(()=>api.controlReviewed("DISABLE",data.state.revision))}>Disable exports</button>
      <button disabled={busy||!data.state.current_id} onClick={()=>{if(window.confirm("Restore the original previous export, only if its approval and evaluation remain valid?"))void act(()=>api.controlReviewed("ROLLBACK",data.state.revision));}}>Roll back export selection</button>
      <button disabled={busy||data.state.disabled} onClick={async()=>{setBusy(true);setManifest(null);try{setManifest(await api.reviewedManifest());}catch{setMessage("Manifest unavailable: disabled, incompatible, stale evaluation or revoked approval authority.");}finally{setBusy(false);}}}>View verified manifest</button>
    </div>}{manifest&&<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(manifest,null,2)}</pre>}{message&&<p role="alert">{message}</p>}
  </details>;
}
