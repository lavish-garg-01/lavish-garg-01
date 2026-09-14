import { useCallback, useEffect, useState } from "react";
import type { CandidateApi } from "./api.js";
import { OperatorSupport } from "./SupportReview.js";
import { ReviewedExports } from "./ReviewedExports.js";

type Case=Awaited<ReturnType<CandidateApi["operatorCases"]>>["cases"][number];
function MergeCase({api,source,cases,onSaved}:{api:CandidateApi;source:Case;cases:Case[];onSaved:()=>Promise<void>}) {
  const [targetId,setTarget]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const target=cases.find(c=>c.id===targetId);
  useEffect(()=>setConfirmed(false),[source.revision,target?.revision]);
  return <details><summary>Merge duplicate case</summary><p>Move this evidence group into another open case. Original history and private consent stay attached to their original IDs. This is not a repair or release; no automatic unmerge is available.</p>
    <label>Keep this target case<select aria-label={`Merge target for ${source.id}`} disabled={busy} value={targetId} onChange={e=>{setTarget(e.target.value);setConfirmed(false);}}><option value="">Select target</option>{cases.filter(c=>c.id!==source.id&&["OPEN","INVESTIGATING"].includes(c.status)).map(c=><option key={c.id} value={c.id}>{c.stage} · {c.code} · {c.id}</option>)}</select></label>
    {target&&<p>Source revision {source.revision} → target revision {target.revision}. Affected runs will be deduplicated, not added together.</p>}
    <label><input type="checkbox" disabled={busy||!target} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed both cases and confirm they belong together.</label>
    <button disabled={busy||!target||!confirmed} onClick={async()=>{if(!target)return;setBusy(true);setError("");try{await api.operatorMerge(source.id,{requestId:crypto.randomUUID(),targetCaseId:target.id,expectedSourceRevision:source.revision,expectedTargetRevision:target.revision,confirmed:true});await onSaved();}catch{setConfirmed(false);setError("Merge not confirmed. Refresh both cases before retrying.");}finally{setBusy(false);}}}>Merge into selected case</button>{error&&<p role="alert">{error}</p>}
  </details>;
}

function CaseDetails({api, caseId, onSaved}: {api:CandidateApi;caseId:string;onSaved:()=>Promise<void>}) {
  const [detail,setDetail]=useState<Awaited<ReturnType<CandidateApi["operatorDetail"]>>|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const load=async()=>{setBusy(true);setError("");try{setDetail(await api.operatorDetail(caseId));}catch{setDetail(null);setError("Cannot load this review. Check access and retry.");}finally{setBusy(false);}};
  return <div><button disabled={busy} onClick={()=>void load()}>Load review & timeline</button>{error&&<p role="alert">{error}</p>}{detail&&<div>
    <p>Choose a packaged synthetic test reference. Attaching it is not proof that the case passed evaluation.</p>
    <label>Responsible layer<select aria-label="Responsible layer" disabled={busy} value={detail.layer} onChange={event=>setDetail({...detail,layer:event.target.value})}>{["UNASSIGNED","SCAN","SEMANTICS","REPRESENTATION","EXECUTION","LEARNING","AUTHORIZATION"].map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Synthetic reproduction<select aria-label="Synthetic reproduction" disabled={busy} value={detail.reproduction} onChange={event=>setDetail({...detail,reproduction:event.target.value})}>{["NONE","ADAPTIVE_AUTOFILL","PRIVATE_NOTE","LEARNING_RECOVERY","OPERATOR_REVIEW"].map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Expected behavior<select aria-label="Expected behavior" disabled={busy} value={detail.expectedBehavior} onChange={event=>setDetail({...detail,expectedBehavior:event.target.value})}>{["UNSPECIFIED","PRESERVE_CANDIDATE_EDIT","FILL_VERIFIED_VALUE","REQUIRE_CONFIRMATION","REJECT_UNAUTHORIZED_ACCESS","REPLAY_ORIGINAL_RESULT","REPORT_INCOMPLETE_SCAN"].map(value=><option key={value}>{value}</option>)}</select></label>
    <button disabled={busy} onClick={async()=>{setBusy(true);try{await api.operatorEdit(caseId,{requestId:crypto.randomUUID(),expectedRevision:detail.revision,layer:detail.layer,reproduction:detail.reproduction,expectedBehavior:detail.expectedBehavior});await onSaved();await load();}catch{setError("Not saved. Reload to check revision and access.");setBusy(false);}}}>Save review</button>
    {detail.mergedInto&&<p>This historical case is now grouped under {detail.mergedInto}.</p>}
    {detail.members&&<div><h3>Original evidence groups</h3>{detail.members.map(member=><p key={member.id}>{member.stage} · {member.code} · {member.release} · {member.id}</p>)}</div>}
    <h3>Recent case history</h3>{detail.timeline.map((entry,index)=><p key={index}>{entry.action} · {entry.status??"review metadata"} · {new Date(entry.at).toLocaleString()} · {entry.caseId}</p>)}
  </div>}</div>;
}

export function OperatorReview({ api }: { api: CandidateApi }) {
  const [cases, setCases] = useState<Awaited<ReturnType<CandidateApi["operatorCases"]>>["cases"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setCases((await api.operatorCases()).cases); }
    catch { setCases([]); setError("Operator access requires an enabled service, a provisioned platform role and recent MFA. Reauthenticate or contact the operator administrator."); }
    finally { setBusy(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  return <section className="card"><h1>Autofill review workspace</h1><p>Value-free failure counts are not success rates. Private notes require separate, time-limited candidate consent. No document or profile access. Changing status does not activate a fix.</p>
    <button disabled={busy} onClick={() => void load()}>Refresh cases</button>{error && <p role="alert">{error}</p>}
    {cases.map(item => <article key={item.id}><h2>{item.stage} · {item.code}</h2><p>{item.release} · {item.affectedRuns} affected runs · {item.status} · Revision {item.revision}</p>
      <p>Assigned to: {item.assigneeSubject ? `${item.assigneeSubject} · ${item.assigneeIssuer}` : "Unassigned"}. Assignment coordinates work; it does not grant private access.</p>
      {(item.assigneeSubject ? ["RELEASE","ADMIN_RELEASE"] as const : ["CLAIM"] as const).map(action=><button key={action} disabled={busy || action==="CLAIM"&&["RESOLVED","DISMISSED"].includes(item.status)} onClick={async()=>{
        setBusy(true);try{await api.operatorAssign(item.id,item.revision,action,crypto.randomUUID());await load();}catch{setError("Assignment not changed. Refresh; releasing another operator’s case requires an administrator.");setBusy(false);}
      }}>{action==="CLAIM"?"Claim case":action==="RELEASE"?"Release my case":"Release assignment (admin only)"}</button>)}
      {(["OPEN","INVESTIGATING","RESOLVED","DISMISSED"] as const).filter(status => status !== item.status).map(status => <button key={status} disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api.operatorTransition(item.id, item.revision, status, crypto.randomUUID()); await load(); }
        catch { setError("Case changed or access expired. Refresh before trying again."); setBusy(false); }
      }}>{status.toLowerCase().replaceAll("_", " ")}</button>)}
      <CaseDetails api={api} caseId={item.id} onSaved={load}/>
      <OperatorSupport api={api} caseId={item.id}/>
      <MergeCase api={api} source={item} cases={cases} onSaved={load}/>
      <ReviewedExports api={api} caseId={item.id}/>
    </article>)}
  </section>;
}
