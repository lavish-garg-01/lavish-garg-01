import { useCallback, useEffect, useState } from "react";
import { ApiError, type CandidateApi, type LearningNoteInput } from "./api.js";
import { displayValue } from "./profile-ux.js";
import { CandidateSupport } from "./SupportReview.js";

function ConfirmNote({ api, itemId, initialAnswer }: { api: CandidateApi; itemId: string; initialAnswer: string }) {
  const [key, setKey] = useState("");
  const [answer, setAnswer] = useState(initialAnswer);
  const [review, setReview] = useState<{ input: LearningNoteInput; display: string; previous: string } | null>(null);
  const [currency, setCurrency] = useState("");
  const [scale, setScale] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(false);
  const [otherLabel,setOtherLabel]=useState("");
  const [scope,setScope]=useState<"GLOBAL"|"APPLICATION">("GLOBAL");
  const applicationOnly=["START_DATE","WORK_MODE_REQUIREMENT","HEARING_SOURCE"].includes(key);
  const effectiveScope=applicationOnly?"APPLICATION":key==="LAST_WORKING_DAY"?scope:"GLOBAL";
  const date=key==="LAST_WORKING_DAY"||key==="START_DATE";
  const money = key === "CURRENT_CTC" || key === "EXPECTED_CTC";
  const numeric = money || key === "NOTICE_PERIOD" || key === "TOTAL_EXPERIENCE";
  return <div>
    <p>Map only if this note answers the selected field. General facts can become your global default. Joining dates, job-specific commitments and referral sources stay with this note's original application. Declarations and individual employment records still need their dedicated controls.</p>
    <label>Profile field<select aria-label="Profile field" value={key} disabled={busy || saved} onChange={event => { setKey(event.target.value); setReview(null);setScope("GLOBAL");setOtherLabel(""); setAnswer(["CURRENT_CTC","EXPECTED_CTC","NOTICE_PERIOD","TOTAL_EXPERIENCE","LAST_WORKING_DAY","START_DATE","WORK_MODE_REQUIREMENT","HEARING_SOURCE"].includes(event.target.value) ? "" : initialAnswer); }}><option value="">Choose a field</option>{["FIRST_NAME","LAST_NAME","FULL_NAME","EMAIL","CURRENT_LOCATION","LINKEDIN_URL","GITHUB_URL","PORTFOLIO_URL","CURRENT_CTC","EXPECTED_CTC","NOTICE_PERIOD","TOTAL_EXPERIENCE","LAST_WORKING_DAY","START_DATE","WORK_MODE_REQUIREMENT","HEARING_SOURCE"].map(value => <option key={value} value={value}>{value.toLowerCase().replaceAll("_", " ")}</option>)}</select></label>
    {key==="LAST_WORKING_DAY"&&<label>Reuse scope<select aria-label="Reuse scope" value={scope} disabled={busy||saved} onChange={event=>{setScope(event.target.value as "GLOBAL"|"APPLICATION");setReview(null);}}><option value="GLOBAL">Global profile default</option><option value="APPLICATION">Original application only</option></select></label>}
    {effectiveScope==="APPLICATION"&&<p>This answer will not become a global default or apply to unrelated jobs.</p>}
    {money && <fieldset disabled={busy || saved}><legend>Salary units — choose explicitly</legend>
      <label>Currency<select aria-label="Currency" value={currency} onChange={event => { setCurrency(event.target.value); setReview(null); }}><option value="">Choose currency</option>{["INR","USD","EUR","GBP","AED","SGD","CAD","AUD"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Amount scale<select aria-label="Amount scale" value={scale} onChange={event => { setScale(event.target.value); setReview(null); }}><option value="">Choose scale</option><option value="BASE">Full amount (1400000)</option><option value="LAKH">Lakh (14)</option><option value="CRORE">Crore (0.14)</option></select></label>
      <label>Pay period<select aria-label="Pay period" value={period} onChange={event => { setPeriod(event.target.value); setReview(null); }}><option value="">Choose period</option><option value="YEAR">Per year</option><option value="MONTH">Per month</option></select></label>
    </fieldset>}
    {key === "NOTICE_PERIOD" && <p>Enter days, such as 45. This is a notice duration, not a promised joining date.</p>}
    {key === "TOTAL_EXPERIENCE" && <p>Enter total months, such as 44 for 3 years 8 months. Do not enter a range or rounded years.</p>}
    {key === "LAST_WORKING_DAY" && <p>Choose an actual confirmed last working day. Never calculate this from your notice period.</p>}
    {key==="START_DATE"&&<p>Choose a calendar date you can commit to for this application. We do not derive it from notice days.</p>}
    {key==="WORK_MODE_REQUIREMENT"||key==="HEARING_SOURCE"?<label>Reviewed answer<select aria-label="Reviewed answer" value={answer} disabled={busy||saved} onChange={event=>{setAnswer(event.target.value);setOtherLabel("");setReview(null);}}><option value="">Choose explicitly</option>{(key==="WORK_MODE_REQUIREMENT"?["YES","NO"]:["LINKEDIN","COMPANY_WEBSITE","EMPLOYEE_REFERRAL","JOB_BOARD","RECRUITER","OTHER"]).map(value=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label>:<label>Reviewed answer<input type={date ? "date" : "text"} inputMode={numeric ? "decimal" : "text"} value={answer} maxLength={key.endsWith("_URL") ? 2048 : 500} disabled={busy || saved} onChange={event => { setAnswer(event.target.value); setReview(null); }} /></label>}
    {key==="HEARING_SOURCE"&&answer==="OTHER"&&<label>Other source<input value={otherLabel} maxLength={120} disabled={busy||saved} onChange={event=>{setOtherLabel(event.target.value);setReview(null);}}/></label>}
    <button disabled={!key || !answer.trim() || (key==="HEARING_SOURCE"&&answer==="OTHER"&&!otherLabel.trim()) || (money && (!currency || !scale || !period)) || busy || saved} onClick={async () => {
      setBusy(true); setStatus("");
      try {
        const input: LearningNoteInput = { canonicalKey: key, answer: answer.trim(), expectedCurrentVersionId: null, confirmedGlobalDefault: effectiveScope==="GLOBAL",...(effectiveScope==="APPLICATION"?{scope:"APPLICATION" as const}:{}),...(key==="HEARING_SOURCE"&&answer==="OTHER"?{otherLabel:otherLabel.trim()}:{}),
          ...(money ? { currency, scale, period } : key === "NOTICE_PERIOD" ? { unit: "DAYS" } : key === "TOTAL_EXPERIENCE" ? { unit: "MONTHS" } : {}) };
        const preview = await api.previewLearningNote(itemId, input);
        if(preview.scope!==effectiveScope)throw new Error("Server scope mismatch. Refresh the app before saving.");
        input.expectedCurrentVersionId=preview.expectedCurrentVersionId;
        const current = preview.currentValue;
        const previous = current ? `${displayValue(current)}${key === "NOTICE_PERIOD" ? " days" : current.kind === "MONEY" ? ` per ${String(current.period).toLowerCase().replaceAll("_", " ")}` : ""}` : "No saved default";
        setReview({ input, display: preview.display, previous });
      } catch (error) { setStatus(error instanceof ApiError ? error.message : "Could not prepare review. Check value and units, open Profile or retry."); } finally { setBusy(false); }
    }}>Review profile change</button>
    {review && !saved && <div><p>Saving as: {effectiveScope==="GLOBAL"?"Global profile default":"Original application only"}</p><p>Current default: {review.previous}</p><p>New default: {review.display}</p><button disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api.confirmLearningNote(itemId, review.input); setSaved(true); setStatus(effectiveScope==="GLOBAL"?"Saved to profile. You can undo this change in Profile history.":"Saved for the original application only. Other applications and global defaults are unchanged."); }
      catch { setStatus("Not saved. The note or profile may have changed; refresh the review before retrying."); }
      finally { setBusy(false); }
    }}>{effectiveScope==="GLOBAL"?"Confirm global default":"Confirm for original application"}</button></div>}
    <p role="status">{status}</p>
  </div>;
}

export function LearningRecovery({ api }: { api: CandidateApi }) {
  const [items, setItems] = useState<Awaited<ReturnType<CandidateApi["learningInbox"]>>["items"]>([]);
  const [groups, setGroups] = useState<Awaited<ReturnType<CandidateApi["learningOutcomes"]>>["groups"]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setError(false);
    try { const [inbox, outcomes] = await Promise.all([api.learningInbox(), api.learningOutcomes()]); setItems(inbox.items); setNextCursor(inbox.nextCursor); setGroups(outcomes.groups); }
    catch { setItems([]); setGroups([]); setNextCursor(null); setError(true); } finally { setBusy(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  return <section className="card" aria-labelledby="learning-recovery-title">
    <h2 id="learning-recovery-title">Answers waiting for review</h2>
    <p>These private notes are not used for autofill until they are mapped and confirmed. Pending evidence expires after 30 days. Deleting a note removes its stored answer.</p>
    <button disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Refresh saved notes"}</button>
    {error && <p role="alert">Could not load recovery data. Your existing profile is unchanged.</p>}
    {!busy && !error && items.length === 0 && <p>No pending answer notes.</p>}
    {items.map((item) => <article key={item.itemId}>
      <h3>{item.evidence?.question ?? "Private note unavailable"}</h3>
      {item.evidence && <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.evidence.answer}</p>}
      {item.evidence && item.status === "PENDING" && <details><summary>Review as a profile answer</summary><ConfirmNote api={api} itemId={item.itemId} initialAnswer={item.evidence.answer} /></details>}
      {item.status === "CONFIRMED" && <p>Already confirmed. Manage or undo the saved answer in Profile history. Deleting this note does not undo the profile change.</p>}
      <p>{item.status} · Expires {new Date(item.expiresAt).toLocaleDateString()}</p>
      <CandidateSupport api={api} itemId={item.itemId} available={Boolean(item.evidence)} />
      {item.status !== "DELETED" && <button disabled={busy} onClick={async () => {
        if (!window.confirm("Delete this private note? This cannot be undone and will not change your profile.")) return;
        setBusy(true);
        try { await api.deleteLearningInboxItem(item.itemId); await load(); } catch { setError(true); setBusy(false); }
      }}>Delete note</button>}
    </article>)}
    {nextCursor && <button disabled={busy} onClick={async () => {
      setBusy(true); setError(false);
      try { const page = await api.learningInbox(nextCursor); setItems(current => [...new Map([...current, ...page.items].map(item => [item.itemId, item])).values()]); setNextCursor(page.nextCursor); }
      catch { setItems([]); setGroups([]); setNextCursor(null); setError(true); }
      finally { setBusy(false); }
    }}>Load older notes</button>}
    <h3>Reported autofill issues</h3><p>Counts show affected application runs, not an autofill success rate. No answer text is included.</p>
    {groups.map((group) => <p key={`${group.stage}:${group.code}`}>{group.stage} · {group.code} · {group.affected_runs} affected runs</p>)}
  </section>;
}
