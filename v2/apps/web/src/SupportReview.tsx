import { useEffect, useRef, useState } from "react";
import type { CandidateApi, SupportGrant } from "./api.js";

export function CandidateSupport({api,itemId,available}:{api:CandidateApi;itemId:string;available:boolean}) {
  const [code,setCode]=useState(""),[preview,setPreview]=useState<SupportGrant|null>(null),[grants,setGrants]=useState<SupportGrant[]>([]);
  const [duration,setDuration]=useState<15|60>(15),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const refresh=async()=>setGrants((await api.noteSupport(itemId)).grants);
  return <details><summary>Share this note with support (optional)</summary>
    <p>Share only this question and answer, never your profile or résumé. Verify the operator identity through your trusted support channel. Viewing or sharing does not train or change autofill. Revoking stops future reads; it cannot erase copies already seen.</p>
    {available&&<div><label>Support request code<input aria-label="Support request code" value={code} disabled={busy} onChange={e=>{setCode(e.target.value);setPreview(null);setConfirmed(false);}} /></label>
      <button disabled={busy||!code.trim()} onClick={async()=>{setBusy(true);setMessage("");setPreview(null);setConfirmed(false);try{setPreview(await api.previewSupport(code.trim(),itemId));}catch{setMessage("Request unavailable. It must match this note’s application failure and an active operator. Support may be disabled.");}finally{setBusy(false);}}}>Review support request</button>
      {preview&&<div><p>Operator: {preview.subject} · Identity provider: {preview.issuer}</p><p>Case: {preview.caseId} · Purpose: {preview.purpose}</p>
        <label>Access duration<select aria-label="Access duration" disabled={busy} value={duration} onChange={e=>{setDuration(Number(e.target.value) as 15|60);setConfirmed(false);}}><option value={15}>15 minutes</option><option value={60}>60 minutes</option></select></label>
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I approve this operator viewing the question and answer shown above.</label>
        <button disabled={busy||!confirmed||preview.status!=="PENDING"} onClick={async()=>{setBusy(true);setMessage("");try{const g=await api.approveSupport(preview.id,itemId,duration);setPreview(null);setConfirmed(false);setMessage(`Support access: ${g.status}. Expires ${g.expiresAt?new Date(g.expiresAt).toLocaleString():"now"}.`);await refresh();}catch{setPreview(null);setConfirmed(false);setMessage("Approval not confirmed. Check existing grants before retrying.");}finally{setBusy(false);}}}>Approve access to this note</button></div>}
    </div>}
    <button disabled={busy} onClick={async()=>{setBusy(true);try{await refresh();setMessage("");}catch{setGrants([]);setMessage("Cannot load grants. Support may be disabled or access unavailable.");}finally{setBusy(false);}}}>Check existing support grants</button>
    {grants.map(g=><div key={g.id}><p>{g.subject} · {g.purpose} · {g.status} · {g.expiresAt?new Date(g.expiresAt).toLocaleString():"Unapproved"}</p>{g.status!=="REVOKED"&&<button disabled={busy} onClick={async()=>{setBusy(true);try{await api.revokeSupport(g.id);setMessage("Access revoked. Previously viewed copies cannot be recalled.");await refresh();}catch{setMessage("Revocation not confirmed. Retry or contact support.");}finally{setBusy(false);}}}>Revoke support access</button>}</div>)}
    <p role="status">{message}</p>
  </details>;
}

export function OperatorSupport({api,caseId}:{api:CandidateApi;caseId:string}) {
  const [purpose,setPurpose]=useState("DEBUG_AUTOFILL"),[grants,setGrants]=useState<SupportGrant[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [privateView,setPrivateView]=useState<Awaited<ReturnType<CandidateApi["readSupport"]>>|null>(null);
  const sequence=useRef(0);
  const request=useRef<{id:string;purpose:string}|null>(null);
  // Clear promptly on focus loss; ignore late network replies after hide/unmount.
  useEffect(()=>{const clear=()=>{sequence.current++;setPrivateView(null);};clear();setGrants([]);setMessage("");request.current=null;window.addEventListener("blur",clear);document.addEventListener("visibilitychange",clear);return()=>{sequence.current++;window.removeEventListener("blur",clear);document.removeEventListener("visibilitychange",clear);};},[api,caseId]);
  useEffect(()=>{if(!privateView)return;const timer=setTimeout(()=>setPrivateView(null),Math.max(0,Math.min(30000,new Date(privateView.expiresAt).getTime()-Date.now())));return()=>clearTimeout(timer);},[privateView]);
  const refresh=async()=>setGrants((await api.operatorSupport(caseId)).grants);
  return <details onToggle={e=>{if(!e.currentTarget.open){sequence.current++;setPrivateView(null);}}}><summary>Candidate-approved private review</summary>
    <p>Request one note only when value-free diagnostics are insufficient. Send the code through your existing trusted support channel. No access until the candidate explicitly approves. Private text is cleared after 30 seconds or on focus loss; do not copy it into case metadata or logs.</p>
    <label>Review purpose<select aria-label="Review purpose" disabled={busy} value={purpose} onChange={e=>{setPurpose(e.target.value);request.current=null;}}>{["DEBUG_AUTOFILL","DEBUG_REPRESENTATION","DEBUG_LEARNING"].map(p=><option key={p}>{p}</option>)}</select></label>
    <button disabled={busy} onClick={async()=>{setBusy(true);setPrivateView(null);try{if(!request.current)request.current={id:crypto.randomUUID(),purpose};const g=await api.requestSupport(caseId,request.current.purpose,request.current.id);setMessage(`Support request code: ${g.id}. Pending requests expire after 24 hours.`);request.current=null;await refresh();}catch{setGrants([]);setMessage("Request not confirmed. Retry reuses its identity; check MFA and role access.");}finally{setBusy(false);}}}>Create consent request</button>
    <button disabled={busy} onClick={async()=>{setBusy(true);sequence.current++;setPrivateView(null);try{await refresh();}catch{setGrants([]);setMessage("Access unavailable. Reauthenticate and check service status.");}finally{setBusy(false);}}}>Refresh support requests</button>
    {grants.map(g=><div key={g.id}><p>{g.id} · {g.status} · {g.purpose}</p>{g.status==="APPROVED"&&<button disabled={busy} onClick={async()=>{setBusy(true);setPrivateView(null);const current=++sequence.current;try{const result=await api.readSupport(g.id);if(current===sequence.current&&new Date(result.expiresAt).getTime()>Date.now())setPrivateView(result);}catch{setPrivateView(null);setMessage("Private access denied or expired. Refresh consent status.");}finally{setBusy(false);}}}>View approved note</button>}</div>)}
    {privateView&&<section aria-label="Approved private note"><h3>{privateView.evidence.question}</h3><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{privateView.evidence.answer}</p><button onClick={()=>{sequence.current++;setPrivateView(null);}}>Hide private note</button></section>}
    <p role="status">{message}</p>
  </details>;
}
