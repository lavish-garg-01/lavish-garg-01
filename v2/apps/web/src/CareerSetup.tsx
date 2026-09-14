import { useEffect, useState, type FormEvent } from "react";
import { CandidateApi, idempotencyKey, type NormalizedValue, type ProfileSnapshot } from "./api.js";

type Entry = { key: string; label: string; type: "text" | "url" | "days" | "money" | "boolean" | "enum" | "date"; hint?: string };
export const CAREER_STEPS: { title: string; description: string; fields: Entry[] }[] = [
  { title: "Work & availability", description: "The details Indian employers ask for most. Zero notice days means immediately available.", fields: [
    { key: "CURRENT_LOCATION", label: "Current city", type: "text", hint: "City and state, e.g. Gurugram, Haryana" },
    { key: "CURRENT_COMPANY", label: "Current / most recent employer", type: "text" },
    { key: "CURRENT_JOB_TITLE", label: "Current / most recent title", type: "text" },
    { key: "NOTICE_PERIOD", label: "Time needed to join (days)", type: "days", hint: "Use your actual availability, not a guessed joining date." },
    { key: "LAST_WORKING_DAY", label: "Confirmed last working day", type: "date", hint: "Optional. Only if you know the actual date." }
  ] },
  { title: "Compensation & mobility", description: "Your defaults are a starting point. A saved job or application answer takes priority.", fields: [
    { key: "CURRENT_CTC", label: "Current / last CTC (₹ lakh per year)", type: "money", hint: "14 means ₹14,00,000 annually. Include only compensation you can verify." },
    { key: "EXPECTED_CTC", label: "Expected CTC (₹ lakh per year)", type: "money" },
    { key: "RELOCATION", label: "Generally open to relocation?", type: "boolean" },
    { key: "WORK_MODE_REQUIREMENT", label: "Generally comfortable with office-based work?", type: "boolean", hint: "Review each employer’s city, office days and conditions before submitting." }
  ] },
  { title: "Links & common questions", description: "Leave unknown answers blank. We never turn a missing answer into “No”.", fields: [
    { key: "LINKEDIN_URL", label: "LinkedIn profile", type: "url" },
    { key: "GITHUB_URL", label: "GitHub profile", type: "url" },
    { key: "PORTFOLIO_URL", label: "Portfolio / personal website", type: "url" },
    { key: "AI_CODING_EXPERIENCE", label: "Hands-on experience with AI coding assistants?", type: "boolean" },
    { key: "HEARING_SOURCE", label: "Usual source of job opportunities", type: "enum", hint: "For example LinkedIn. Change it for jobs found somewhere else." }
  ] }
];
const common = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE" };
export function careerValue(field: Entry, text: string): NormalizedValue {
  const value = text.trim();
  if (field.type === "money") {
    if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a positive CTC with at most two decimal places.");
    const [whole, fraction = ""] = value.split(".");
    const amount = BigInt(whole!) * 100000n + BigInt(fraction.padEnd(2, "0")) * 1000n;
    if (amount <= 0n) throw new Error("CTC must be greater than zero; leave it blank if not applicable.");
    return { ...common, kind: "MONEY", amountExact: amount.toString(), currency: "INR", period: "YEAR" };
  }
  if (field.type === "days") {
    if (!/^\d{1,3}$/.test(value) || Number(value) > 365) throw new Error("Notice period must be 0–365 whole days.");
    return { ...common, kind: "INTEGER", value: Number(value) };
  }
  if (field.type === "boolean") {
    if (!["yes", "no"].includes(value)) throw new Error("Choose Yes or No, or leave the field unanswered.");
    return { ...common, kind: "BOOLEAN", value: value === "yes" };
  }
  if (field.type === "date") return { ...common, kind: "DATE", value: { isoDate: value, precision: "DAY" } };
  if (field.type === "enum") return { ...common, kind: "ENUM", value: { key: value.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: value } };
  return { ...common, kind: field.type === "url" ? "URL" : "STRING", value };
}
function editableValue(value: NormalizedValue): string {
  if (value.kind === "MONEY") return value.currency === "INR" && value.period === "YEAR" ? String(Number(value.amountExact) / 100000) : "";
  if (value.kind === "BOOLEAN") return value.value ? "yes" : "no";
  if (value.kind === "DATE") return String((value.value as { isoDate: string }).isoDate);
  if (value.kind === "ENUM") return String((value.value as { label: string }).label);
  return String(value.value ?? "");
}

export function CareerSetup({ api, profile, onSaved }: { api: CandidateApi; profile: ProfileSnapshot; onSaved: (id: string) => Promise<void> }) {
  const [scopeChoice, setScopeChoice] = useState("GLOBAL");
  const [jobs, setJobs] = useState<{ id: string; title: string; company: string }[]>([]);
  useEffect(() => { let active = true; void api.jobs({ limit: 50 }).then((page) => { if (active) setJobs(page.items); }).catch(() => undefined); return () => { active = false; }; }, [api]);
  const selectedScope = scopeChoice === "GLOBAL" ? { type: "GLOBAL", context: {} }
    : scopeChoice.startsWith("job:") ? { type: "JOB", context: { jobId: scopeChoice.slice(4) } }
    : (() => { const answer = profile.answers.find((item) => item.answerVersionId === scopeChoice); return { type: answer?.scopeType ?? "GLOBAL", context: answer?.scope ?? {} }; })();
  const current = new Map(profile.answers.filter((answer) => !answer.entityId && answer.scopeType === selectedScope.type
    && Object.keys(answer.scope ?? {}).length === Object.keys(selectedScope.context).length
    && Object.entries(selectedScope.context).every(([key, value]) => answer.scope?.[key as keyof NonNullable<typeof answer.scope>] === value)).map((answer) => [answer.canonicalKey, answer]));
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const fields = CAREER_STEPS[step]!.fields;
  const getValue = (key: string) => draft[key] ?? (current.has(key) ? editableValue(current.get(key)!.normalizedValue) : "");
  const all = CAREER_STEPS.flatMap((section) => section.fields);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFeedback(null);
    try {
      const items = fields.filter((field) => {
        const saved = current.get(field.key);
        const needsConfirmation = saved && saved.freshness.state !== "FRESH";
        return getValue(field.key).trim() && (needsConfirmation || (draft[field.key] !== undefined && draft[field.key] !== (saved ? editableValue(saved.normalizedValue) : "")));
      }).map((field) => ({ itemKey: field.key, canonicalKey: field.key, normalizedValue: careerValue(field, getValue(field.key)), scopeType: selectedScope.type, requestedScope: selectedScope.context, context: selectedScope.context, expectedCurrentVersionId: current.get(field.key)?.answerVersionId ?? null }));
      if (items.length) { const result = await api.saveProfile(items, idempotencyKey("career-setup")); await onSaved(result.changeSetId); }
      setDraft((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !fields.some((field) => field.key === key))));
      setFeedback(items.length ? `Saved as verified ${selectedScope.type.toLowerCase()} answers. More-specific answers still take priority.` : "No changes to save. Blank fields are left unchanged.");
      if (step < CAREER_STEPS.length - 1) setStep(step + 1);
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : "Could not save. Your edits are kept."); }
    finally { setBusy(false); }
  }
  return <section className="career-setup" aria-labelledby="career-heading">
    <div className="section-heading"><div><p className="eyebrow">YOUR APPLICATION PASSPORT</p><h2 id="career-heading">A little setup. A lot less typing.</h2><p>{all.filter((field) => current.has(field.key)).length} of {all.length} common answers saved · all optional</p></div><span className="current-pill">India-ready</span></div>
    <nav className="career-steps" aria-label="Profile setup steps">{CAREER_STEPS.map((section, index) => <button type="button" key={section.title} aria-current={step === index ? "step" : undefined} onClick={() => { setStep(index); setFeedback(null); }} disabled={busy}><span>{index + 1}</span>{section.title}</button>)}</nav>
    <label className="scope-picker">Use these answers for <select value={scopeChoice} disabled={busy} onChange={(event) => { if (Object.keys(draft).length && !window.confirm("Discard unsaved edits and switch answer scope?")) return; setDraft({}); setScopeChoice(event.target.value); setFeedback(null); }}><option value="GLOBAL">All applications (global defaults)</option>{jobs.map((job) => <option key={job.id} value={`job:${job.id}`}>{job.company} · {job.title}</option>)}{profile.answers.filter((answer) => !answer.entityId && answer.scopeType !== "GLOBAL" && answer.scopeType !== "JOB").map((answer) => <option key={answer.answerVersionId} value={answer.answerVersionId}>Existing {answer.scopeType.toLowerCase()} override · {answer.label}</option>)}</select></label>
    <form onSubmit={(event) => void save(event)}><h3>{CAREER_STEPS[step]!.title}</h3><p>{CAREER_STEPS[step]!.description}</p>
      <div className="preference-grid">{fields.map((field) => <label key={field.key}>{field.label}
        {field.type === "boolean" ? <select value={getValue(field.key)} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}><option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option></select>
          : <input type={field.type === "date" || field.type === "url" ? field.type : "text"} inputMode={["money", "days"].includes(field.type) ? "decimal" : undefined} maxLength={field.type === "url" ? 2048 : 240} value={getValue(field.key)} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />}
        {field.hint && <small>{field.hint}</small>}{current.has(field.key) && <small>Saved {selectedScope.type.toLowerCase()} answer · {current.get(field.key)!.freshness.state.toLowerCase()}</small>}
      </label>)}</div>
      {feedback && <p role="status" className="career-feedback">{feedback}</p>}
      <div className="profile-actions"><button className="button" disabled={busy}>{busy ? "Saving…" : step < 2 ? "Save & continue" : "Save my defaults"}</button><small>Privacy, declarations and legal eligibility are never guessed here.</small></div>
    </form>
  </section>;
}
