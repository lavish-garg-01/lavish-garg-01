import { useCallback, useEffect, useRef, useState } from "react";
import "./admin.css";

// This inspector intentionally accepts heterogeneous allowlisted records; writes are validated by server command schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const base = (import.meta.env?.VITE_API_URL as string|undefined)?.replace(/\/$/,"") ?? "http://127.0.0.1:3100";
const tokenKey="job-hunter-admin-session";
const menus=[
  ["overview","Overview","◈"],["users","People & knowledge","◎"],["canonicals","Canonical registry","◇"],["proposals","Canonical proposals","＋"],
  ["representations","Representation lab","⇄"],["strategies","Strategy control","⌘"],["applications","Applications","↗"],["runs","Application runs","▷"],
  ["evidence","Field execution","≋"],["learning","Learning observations","⤴"],["failures","Failure review","!"],["ai","AI health & usage","✦"],
  ["jobs","Job catalog","▤"],["documents","Documents","▧"],["workers","Background jobs","⚙"],["audit","Audit trail","↺"]
] as const;
type Section=typeof menus[number][0];
const descriptions:Record<Section,string>={workers:"Monitor queued work, leases, retries and terminal failures. Payloads are kept private.",overview:"A live view of your system. Evidence counts are not application success rates.",users:"Inspect each candidate’s scoped knowledge, provenance and answer history. Edits create new versions.",canonicals:"Shared meanings, aliases and safety policies. Alias edits keep the built-in scope and type guards.",proposals:"Review unresolved concepts. New fields require runtime and policy support before activation.",representations:"Control safe formatting defaults and preview the actual resolver. Explicit form units win.",strategies:"Inspect definitions and cluster state. Offline proof and canary gates cannot be bypassed.",applications:"Track applications without manufacturing submission or learning evidence.",runs:"Follow active, paused and completed application sessions.",evidence:"Inspect the representation and verification outcomes of individual field operations.",learning:"Inspect observed corrections and checkpoints. Observation alone does not establish verified truth.",failures:"Triage failures. Resolving a review case does not deploy a fix.",ai:"Provider responses, latency, token counts and rejection codes. No prompts or API keys exposed.",jobs:"Browse the current catalog and lifecycle status.",documents:"Document metadata only. Private storage keys and file contents are not exposed here.",audit:"Append-only history of admin changes and private graph access."};
const pretty=(value:unknown)=>JSON.stringify(value,null,2);
const label=(value:string)=>value.replaceAll("_"," ").toLowerCase();
const short=(value:unknown)=>typeof value==="object"?JSON.stringify(value):String(value??"—");
function Json({value}:{value:unknown}) { return <pre className="adm-json">{pretty(value)}</pre>; }

export function AdminDashboard() {
  const [token,setToken]=useState(()=>sessionStorage.getItem(tokenKey)??"");
  const [section,setSection]=useState<Section>("overview");
  const [data,setData]=useState<Row>({}),[registry,setRegistry]=useState<Row>({definitions:[],configurations:[]});
  const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[offset,setOffset]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [live,setLive]=useState(false);
  const [selection,setSelection]=useState<Row|null>(null),[graph,setGraph]=useState<Row|null>(null);
  const [edit,setEdit]=useState<{title:string;endpoint:string;payload:Row}|null>(null),[text,setText]=useState(""),[reason,setReason]=useState("");
  const [preview,setPreview]=useState<Row|null>(null),[previewText,setPreviewText]=useState("");
  const sequence=useRef(0),detailSequence=useRef(0);
  const busyRef=useRef(busy);busyRef.current=busy;
  useEffect(()=>{
    if(!edit&&!preview)return;
    const previous=document.activeElement as HTMLElement|null,priorOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
    const keydown=(event:KeyboardEvent)=>{
      const dialog=document.querySelector<HTMLElement>('[role="dialog"]');if(!dialog)return;
      if(event.key==="Escape"&&!busyRef.current){event.preventDefault();setEdit(null);setPreview(null);}
      if(event.key!=="Tab")return;
      const controls=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary')].filter(node=>node.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",keydown);
    const dialog=document.querySelector<HTMLElement>('[role="dialog"]');if(!dialog?.contains(document.activeElement))dialog?.querySelector<HTMLElement>('input,textarea,button')?.focus();
    return()=>{document.body.style.overflow=priorOverflow;document.removeEventListener("keydown",keydown);previous?.focus();};
  },[Boolean(edit),Boolean(preview)]);
  const request=useCallback(async(path:string,body?:unknown)=>{
    const response=await fetch(`${base}/v1/admin${path}`,{method:body===undefined?"GET":"POST",headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{"Content-Type":"application/json"}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const result=await response.json().catch(()=>({}));
    if(response.status===401 && path!=="/login"){sequence.current++;detailSequence.current++;sessionStorage.removeItem(tokenKey);setToken("");setBusy(false);setError("Your admin session expired or the API restarted. Sign in again.");setGraph(null);setSelection(null);setEdit(null);setPreview(null);setData({});setRegistry({definitions:[],configurations:[]});}
    if(!response.ok) throw new Error(response.status===404?"Admin API is not enabled. Set ADMIN_EMAIL and ADMIN_PASSWORD in v2/.env, run the database migration, and restart the API.":result.error?.message??`Request failed (${response.status}).`);
    return result as Row;
  },[token]);
  const load=useCallback(async()=>{
    if(!token)return;const seq=++sequence.current;setBusy(true);setError("");
    try {
      const path=section==="overview"?"/overview":["canonicals","representations"].includes(section)?"/registry":`/resources/${section}?search=${encodeURIComponent(query)}&offset=${offset}`;
      const result=await request(path);
      if(seq!==sequence.current)return;setData(result);if(result.definitions)setRegistry(result);
    }catch(e){if(seq===sequence.current){setError(String((e as Error).message));setData({});}}
    finally{if(seq===sequence.current)setBusy(false);}
  },[token,section,request,query,offset]);
  useEffect(()=>{void load();return()=>{sequence.current++;};},[load]);
  useEffect(()=>{if(!live||!token||edit||preview)return;const timer=window.setInterval(()=>{if(!busyRef.current)void load();},15000);return()=>window.clearInterval(timer);},[live,token,load,Boolean(edit),Boolean(preview)]);
  const navigate=(next:Section)=>{detailSequence.current++;setSection(next);setSelection(null);setGraph(null);setSearch("");setQuery("");setOffset(0);setError("");setNotice("");setData({});};
  const openEdit=(title:string,endpoint:string,payload:Row)=>{setEdit({title,endpoint,payload});setText(pretty(payload));setReason("");setError("");};
  const inspect=async(row:Row)=>{
    const seq=++detailSequence.current;setSelection(row);setGraph(null);setError("");
    if(section==="users")try{const result=await request(`/candidates/${row.id}`);if(seq===detailSequence.current)setGraph(result);}catch(e){setError((e as Error).message);}
  };
  const save=async()=>{
    if(!edit||busy)return;setBusy(true);setError("");
    try{
      const body=JSON.parse(text);await request(edit.endpoint,{...body,reason});
      const candidateId=graph?.candidate?.id;setEdit(null);setNotice("Saved. The change is recorded in the audit trail.");setSelection(null);
      if(candidateId)setGraph(await request(`/candidates/${candidateId}`));await load();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const config=(kind:string,key:string,defaults:Row)=>{
    const current=(registry.configurations??[]).find((c:Row)=>c.kind===kind&&c.key===key);
    openEdit(`${kind==="CANONICAL"?"Edit meaning & aliases":"Edit representation defaults"} · ${key}`,"/configuration",{kind,key,expectedRevision:current?.revision??0,value:current?.value??defaults});
  };
  const editAnswer=(answer?:Row)=>{
    if(!graph)return;
    const item=answer?{itemKey:crypto.randomUUID(),canonicalKey:answer.canonicalKey,normalizedValue:answer.normalizedValue,entityId:answer.entityId,entityType:answer.entityType,scopeType:answer.scopeType,requestedScope:answer.scope,context:answer.scope,expectedCurrentVersionId:answer.answerVersionId}
      :{itemKey:crypto.randomUUID(),canonicalKey:"CURRENT_LOCATION",normalizedValue:{schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",kind:"STRING",value:""},scopeType:"GLOBAL",expectedCurrentVersionId:null};
    openEdit(answer?`Revise ${answer.label}`:"Add a verified answer",`/candidates/${graph.candidate.id}/answers`,{idempotencyKey:crypto.randomUUID(),items:[item]});
  };
  const representationPreview=(key:string)=>{
    setPreview({canonicalKey:key});setPreviewText(pretty({canonicalKey:key,label:key==="CURRENT_CTC"?"Current CTC":label(key),controlType:"TEXT",options:[],value:{schemaVersion:1,dataClass:"CANDIDATE_PRIVATE",...(key.includes("CTC")?{kind:"MONEY",amountExact:"1400000",currency:"INR",period:"YEAR"}:key==="TOTAL_EXPERIENCE"?{kind:"DURATION",months:44}:{kind:"STRING",value:"Example"})}}));setError("");
  };
  if(!token)return <div className="adm-login"><div className="adm-login-intro"><a href="#jobs">JH / Job Hunter</a><span className="adm-eyebrow">OPERATIONS WORKSPACE</span><h1>Understand every answer.<br/>Improve every application.</h1><p>Your private control room for candidate knowledge, field intelligence, runtime strategies and execution quality.</p><small>Local development access · No Supabase required</small></div><form className="adm-login-form" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setError("");const form=new FormData(e.currentTarget);
    try{const result=await request("/login",{email:form.get("email"),password:form.get("password")});sessionStorage.setItem(tokenKey,result.token);setToken(result.token);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }}><span className="adm-eyebrow">ADMINISTRATOR ACCESS</span><h2>Welcome back.</h2><p>Sign in with the credentials in your API environment file.</p><label>Email<input autoComplete="username" name="email" type="email" required/></label><label>Password<input autoComplete="current-password" name="password" type="password" required/></label>{error&&<p className="adm-error" role="alert">{error}</p>}<button disabled={busy} className="adm-primary">{busy?"Signing in…":"Open admin workspace →"}</button><details><summary>First-time setup</summary><p>In <code>v2/.env</code>, set <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> (at least 12 characters). Run <code>npm run db:migrate</code>, then restart <code>npm run dev:api</code>.</p><p>Use only on your local machine. This temporary login is intentionally disabled in production.</p></details></form></div>;
  const columns=data.items?.length?Object.keys(data.items[0]).filter(k=>!["state","details"].includes(k)).slice(0,7):[];
  const definitions=(registry.definitions??[]).filter((d:Row)=>`${d.key} ${d.description}`.toLowerCase().includes(search.toLowerCase()));
return <div className="adm-shell"><aside className="adm-sidebar" inert={Boolean(edit||preview)}><a className="adm-brand" href="#jobs"><b>JH</b><span>Job Hunter<small>Admin workspace</small></span></a><nav aria-label="Admin sections">{menus.map(([id,title,icon])=><button key={id} aria-current={section===id?"page":undefined} onClick={()=>navigate(id)}><span>{icon}</span>{title}</button>)}</nav><div className="adm-sidebar-bottom"><span className="adm-dot"/>Local admin · private access<button onClick={async()=>{try{await request("/logout",{});}catch{/* Clear the local session even when the API is unreachable. */}sequence.current++;detailSequence.current++;sessionStorage.removeItem(tokenKey);setToken("");setGraph(null);setData({});setSelection(null);setEdit(null);setPreview(null);}}>Sign out</button><a href="#jobs">← Back to application</a></div></aside>
    <main className="adm-main" inert={Boolean(edit||preview)}><header className="adm-topbar"><span>CONTROL ROOM <i>/</i> {menus.find(m=>m[0]===section)?.[1]}</span><div className="adm-live-controls"><label><input type="checkbox" checked={live} onChange={e=>setLive(e.target.checked)}/>Auto-refresh · 15s</label><button disabled={busy} onClick={()=>void load()}>↻ Refresh</button></div></header><div className="adm-body"><div className="adm-page-heading"><div><span className="adm-eyebrow">JOB HUNTER INTELLIGENCE</span><h1>{menus.find(m=>m[0]===section)?.[1]}</h1><p>{descriptions[section]}</p></div>{busy&&<span role="status">Loading…</span>}</div>
    {error&&<div className="adm-error" role="alert">{error}</div>}{notice&&<div className="adm-notice" role="status">{notice}</div>}
    {section==="overview"?<><div className="adm-metrics">{Object.entries(data.counts??{}).map(([key,value])=><article key={key}><span>{label(key)}</span><strong>{String(value)}</strong></article>)}</div><div className="adm-two"><section className="adm-card"><h2>AI · last 24 hours</h2>{data.ai?.length?data.ai.map((row:Row,i:number)=><div className="adm-summary-row" key={i}><div><b>{row.provider}</b><p>{row.model_profile}</p></div><div>{row.accepted}/{row.calls} accepted<p>{row.latency_ms??"—"} ms average</p></div></div>):<p>No AI calls recorded in the last 24 hours.</p>}</section><section className="adm-card"><h2>Make changes with evidence</h2><ol><li>Inspect the user’s scoped answer and provenance.</li><li>Check field execution and AI rejection codes.</li><li>Preview representation changes or review a strategy.</li><li>Retest on a form and compare verified results.</li></ol><p>Strategies: {data.strategyEnabled?"enabled; guarded lifecycle":"disabled in API configuration"}. Sessions expire after eight hours or an API restart.</p></section></div></>
    :["canonicals","representations"].includes(section)?<><div className="adm-toolbar"><input aria-label="Search registry" placeholder="Find a canonical field…" value={search} onChange={e=>setSearch(e.target.value)}/><span>{definitions.length} definitions</span></div><div className="adm-registry">{definitions.map((d:Row)=>{const settings=(registry.configurations??[]).find((c:Row)=>c.kind===(section==="canonicals"?"CANONICAL":"REPRESENTATION")&&c.key===d.key);return <article className="adm-card" key={d.key}><div className="adm-card-top"><h2>{label(d.key)}</h2><span className="adm-badge">{d.valueType}</span></div><code>{d.key}</code><p>{settings?.value?.description??d.description}</p>{section==="canonicals"?<><div className="adm-tags"><span>{d.policy.answerClass}</span><span>{d.policy.reuseMode}</span><span>{d.policy.riskTier}</span></div><details><summary>Aliases & safety policy</summary><Json value={{aliases:d.aliases,policy:d.policy}}/></details><button onClick={()=>config("CANONICAL",d.key,{description:d.description,aliases:[]})}>Edit aliases & description</button></>:<><p>Configuration: {settings?`revision ${settings.revision} · ${settings.value.enabled?"enabled":"disabled"}`:"built-in defaults"}</p><div className="adm-actions"><button onClick={()=>config("REPRESENTATION",d.key,{enabled:true,moneyScale:"AUTO",experienceUnit:"AUTO",notes:""})}>Edit defaults</button><button onClick={()=>representationPreview(d.key)}>Preview output</button></div></>}</article>;})}</div></>
    :<><form className="adm-toolbar" onSubmit={e=>{e.preventDefault();setOffset(0);setQuery(search);}}><input aria-label="Search records" placeholder="Search email, ID, status or reason…" value={search} onChange={e=>setSearch(e.target.value)}/><button>Search</button>{section==="proposals"&&<button type="button" onClick={()=>openEdit("Propose a canonical field","/configuration",{kind:"PROPOSAL",key:"NEW_FIELD",expectedRevision:0,value:{description:"",valueType:"STRING",aliases:[],status:"PROPOSED",notes:""}})}>＋ Propose field</button>}{section==="strategies"&&<button type="button" onClick={async()=>{try{setSelection(await request("/strategy-definitions"));}catch(e){setError((e as Error).message);}}}>View definitions</button>}{section==="proposals"&&<button type="button" onClick={async()=>{try{const r=await request("/registry");setRegistry(r);setSelection({proposedFields:r.configurations.filter((c:Row)=>c.kind==="PROPOSAL")});}catch(e){setError((e as Error).message);}}}>Proposed field definitions</button>}</form>
    <div className="adm-table-wrap"><table><thead><tr>{columns.map((c:string)=><th key={c}>{label(c)}</th>)}<th>Inspect</th></tr></thead><tbody>{(data.items??[]).map((row:Row,i:number)=><tr key={short(row.id??row.cluster??row.descriptor_fingerprint??i)}>{columns.map((c:string)=><td key={c} title={short(row[c])}>{["status","verification_status","account_type"].includes(c)?<span className="adm-badge">{short(row[c])}</span>:short(row[c])}</td>)}<td><button aria-label={`Inspect record ${i+1}`} onClick={()=>void inspect(row)}>Open →</button></td></tr>)}</tbody></table>{!busy&&!data.items?.length&&<div className="adm-empty"><h2>No records found</h2><p>Try another search, or return after the system has recorded activity.</p></div>}</div><div className="adm-pagination"><span>Records {data.items?.length?offset+1:0}–{offset+(data.items?.length??0)}</span><button disabled={offset===0||busy} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button><button disabled={!data.hasMore||busy} onClick={()=>setOffset(offset+50)}>Next</button></div></>}
    {graph&&<section className="adm-card adm-graph"><div className="adm-card-top"><h2>Candidate knowledge graph</h2><button onClick={()=>editAnswer()}>＋ Add answer</button></div><p>Candidate → scope → entity → canonical answer → source/version. Private data: do not share screenshots. Legal declarations, consent and protected facts still require candidate confirmation.</p><div className="adm-graph-root">◎ {graph.candidate.id}</div>
    {selection&&["ACTIVE","SUSPENDED"].includes(selection.status)&&<div className="adm-actions"><button onClick={()=>openEdit(`${selection.status==="ACTIVE"?"Suspend":"Reactivate"} account`,"/operate",{kind:"ACCOUNT",id:selection.account_id,expectedStatus:selection.status,status:selection.status==="ACTIVE"?"SUSPENDED":"ACTIVE"})}>{selection.status==="ACTIVE"?"Suspend account access":"Reactivate account"}</button></div>}
    {Object.entries((graph.snapshot?.answers??[]).reduce((acc:Record<string,Row[]>,a:Row)=>{const key=`${a.scopeType} · ${a.entityType??"PROFILE"}${a.entityId?` · ${a.entityId}`:""} · ${JSON.stringify(a.scope)}`;(acc[key]??=[]).push(a);return acc;},{})).map(([group,values])=><section className="adm-graph-group" key={group}><h3>{group}</h3><div className="adm-answer-grid">{(values as Row[]).map(a=><article key={a.answerVersionId}><b>{a.label}</b><p>{short(a.normalizedValue.value??a.normalizedValue.amountExact??a.normalizedValue.months??a.normalizedValue)}</p><small>{a.source} → {a.trustState}</small><details><summary>Value, scope & provenance</summary><Json value={a}/></details><button onClick={()=>editAnswer(a)}>Revise answer</button></article>)}</div></section>)}
    <details><summary>Version history (latest 100) & entity nodes</summary>{(graph.history??[]).filter((a:Row)=>!a.current).map((a:Row)=>{
      const current=(graph.snapshot?.answers??[]).find((v:Row)=>v.canonicalKey===a.canonicalKey&&v.entityId===a.entityId&&v.scopeType===a.scopeType&&JSON.stringify(v.scope)===JSON.stringify(a.scope));
      return <article key={a.answerVersionId}><p>{a.label} · {new Date(a.createdAt).toLocaleString()}</p><Json value={a.normalizedValue}/><button onClick={()=>openEdit(`Restore ${a.label}`,`/candidates/${graph.candidate.id}/restore`,{versionId:a.answerVersionId,expectedCurrentVersionId:current?.answerVersionId??null,idempotencyKey:crypto.randomUUID()})}>Restore as a new version</button></article>;
    })}<Json value={{history:graph.history,entities:graph.entities}}/></details></section>}
    {selection&&!graph&&<section className="adm-card adm-inspector"><div className="adm-card-top"><h2>Record inspector</h2><button onClick={()=>setSelection(null)}>Close</button></div>{section==="users"?<p>Loading private knowledge graph…</p>:<Json value={selection}/>}
    {section==="failures"&&selection.id&&<div className="adm-actions">{["OPEN","INVESTIGATING","RESOLVED","DISMISSED"].filter(s=>s!==selection.status).map(status=><button key={status} onClick={()=>openEdit(`Mark case ${label(status)}`,"/failure-review",{id:selection.id,expectedRevision:selection.revision,status})}>{label(status)}</button>)}</div>}
    {section==="proposals"&&selection.descriptor_fingerprint&&<div className="adm-actions">{["PENDING_REVIEW","RESOLVED","REJECTED"].filter(s=>s!==selection.status).map(status=><button key={status} onClick={()=>openEdit("Review canonical evidence","/canonical-review",{candidateId:selection.candidate_id,fingerprint:selection.descriptor_fingerprint,expectedStatus:selection.status,status})}>{label(status)}</button>)}</div>}
    {selection.proposedFields?.map((p:Row)=><button key={p.key} onClick={()=>openEdit(`Review ${p.key}`,"/configuration",{kind:p.kind,key:p.key,expectedRevision:p.revision,value:p.value})}>{p.key} · {p.value.status}</button>)}
    {section==="jobs"&&selection.id&&<div className="adm-actions">{["ACTIVE","STALE","CLOSED","EXPIRED"].filter(s=>s!==selection.status).map(status=><button key={status} onClick={()=>openEdit(`Mark job ${label(status)}`,"/operate",{kind:"JOB",id:selection.id,expectedStatus:selection.status,status})}>{label(status)}</button>)}</div>}
    {section==="runs"&&["ACTIVE","AUTHORIZED","PAUSED"].includes(selection.status)&&<button onClick={()=>openEdit("Abort this application run","/operate",{kind:"ABORT_RUN",id:selection.id,expectedStatus:selection.status})}>Abort run</button>}
    {section==="workers"&&selection.status==="DEAD"&&selection.job_type==="Q_STRATEGY"&&<button onClick={()=>openEdit("Retry failed strategy work","/operate",{kind:"RETRY_WORKER",id:selection.id,expectedAttempts:selection.attempt_count})}>Retry with three additional attempts</button>}
    {section==="strategies"&&selection.cluster&&<><p>Changes use the current revision. Canary activation requires an independently attested, recent offline proof and a stable fallback.</p><div className="adm-actions">{["PROPOSE","APPROVE_OFFLINE","START_CANARY","EVALUATE","DISABLE","REJECT","ROLLBACK","RETIRE"].map(action=><button key={action} onClick={()=>openEdit(`${label(action)} strategy`,"/strategy",{cluster:selection.cluster,key:selection.state?.order?.[0]??"STRATEGY_KEY",expectedRevision:selection.revision,idempotencyKey:crypto.randomUUID(),action,...(["PROPOSE","APPROVE_OFFLINE"].includes(action)?{payload:{}}:{})})}>{label(action)}</button>)}</div></>}
    </section>}
    </div></main>
    {edit&&<div className="adm-overlay"><section className="adm-dialog" role="dialog" aria-modal="true" aria-label={edit.title}><div className="adm-card-top"><h2>{edit.title}</h2><button disabled={busy} onClick={()=>setEdit(null)}>Cancel</button></div><p>Advanced editor · Keep typed values, scope and expected revision intact. Existing answers are never overwritten in place.</p><label>Validated change payload<textarea className="adm-code-editor" value={text} onChange={e=>setText(e.target.value)} spellCheck={false}/></label><label>Reason for this change<input autoFocus value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain the evidence supporting this change" minLength={8} maxLength={1000}/></label>{error&&<p className="adm-error" role="alert">{error}</p>}<button className="adm-primary" disabled={busy||reason.trim().length<8} onClick={()=>void save()}>{busy?"Saving…":"Validate & save audited change"}</button></section></div>}
    {preview&&<div className="adm-overlay"><section className="adm-dialog" role="dialog" aria-modal="true" aria-label="Representation preview"><div className="adm-card-top"><h2>Representation preview</h2><button onClick={()=>setPreview(null)}>Close</button></div><p>No data is saved or entered on employer forms. This calls the configured runtime resolver.</p><label>Sample field and typed value<textarea className="adm-code-editor" value={previewText} onChange={e=>setPreviewText(e.target.value)}/></label><button disabled={busy} onClick={async()=>{setBusy(true);setError("");try{setPreview({result:await request("/representation-preview",JSON.parse(previewText))});}catch(e){setPreview({});setError((e as Error).message);}finally{setBusy(false);}}}>Run preview</button>{error&&<p role="alert" className="adm-error">{error}</p>}{preview.result&&<Json value={preview.result}/>}</section></div>}
  </div>;
}
