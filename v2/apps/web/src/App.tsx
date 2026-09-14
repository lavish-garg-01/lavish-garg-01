import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { authClient, developmentAuthEnabled, type BrowserAuthSession } from "./auth.js";
import {
  ApiError,
  CandidateApi,
  idempotencyKey,
  type HistoryEntry,
  type JobResult,
  type ProfileAnswer,
  type ProfileSnapshot,
  type Readiness,
  type ResumeReview,
  type CandidateDocument,
  type EditableDocumentDraft,
  type SearchProfile,
  type SessionResponse
} from "./api.js";
import { correctedValue, displayValue, employmentProfileDrafts, essentialProfileDraft, type EmploymentProfileDraft, type EssentialProfileDraft } from "./profile-ux.js";
import { formatJobCompensation, humanJobValue, primaryMatchMessage } from "./job-ux.js";
import { CareerSetup } from "./CareerSetup.js";
import { LearningRecovery } from "./LearningRecovery.js";
import { OperatorReview } from "./OperatorReview.js";
import { extensionBridge, extensionInstallUrl, isExtensionAvailableMessage, requiresSessionReconnect, type CopilotConnectionState } from "./extension-client.js";

type View = "WELCOME" | "RESUME" | "REVIEW" | "PROFILE" | "JOBS" | "DOCUMENTS" | "ATTENTION" | "OPERATOR";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function Brand() {
  return <div className="brand"><span className="brand-mark">JH</span><span>Job Hunter <b>Copilot</b></span></div>;
}

function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="loading"><span className="spinner" /><span>{label}</span></div>;
}

function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}

function SignIn({ onSession }: { onSession: (session: BrowserAuthSession) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function action(run: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await run(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }
  useEffect(() => authClient.subscribe((session) => session && onSession(session)), [onSession]);
  return <main className="auth-page">
    <div className="auth-ambient one" /><div className="auth-ambient two" />
    <section className="auth-story">
      <Brand />
      <p className="eyebrow">YOUR JOB SEARCH, UNSTUCK</p>
      <h1>One profile.<br />Faster applications.<br /><em>You stay in control.</em></h1>
      <p className="lead">Build your verified career profile once. Copilot remembers the details, flags uncertainty, and prepares every application for your review.</p>
      <div className="proof-row"><span>✓ Private by design</span><span>✓ No card needed</span><span>✓ Review before use</span></div>
    </section>
    <section className="auth-card">
      <p className="eyebrow">{developmentAuthEnabled ? "LOCAL DEVELOPMENT" : "GET STARTED"}</p>
      <h2>{developmentAuthEnabled ? "Open the test workspace" : "Create your career profile"}</h2>
      <p>{developmentAuthEnabled ? "Use the isolated local candidate to test onboarding and product flows without an external identity provider." : "Use Google or a secure email link. New and returning candidates use the same simple flow."}</p>
      {!authClient.configured && <Notice kind="error">{developmentAuthEnabled ? <>Development authentication needs matching tokens in <code>.env</code> and <code>apps/web/.env.local</code>.</> : <>Authentication is not configured. Add the Supabase public URL and anonymous key to <code>apps/web/.env.local</code>.</>}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <button className="button google" disabled={busy || !authClient.configured} onClick={() => action(() => authClient.signInWithGoogle())}>
        <span className="google-g">{developmentAuthEnabled ? "↗" : "G"}</span> {developmentAuthEnabled ? "Continue as local test user" : "Continue with Google"}
      </button>
      {!developmentAuthEnabled && <><div className="divider"><span>or use email</span></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        void action(async () => { await authClient.sendEmailLink(email); setSent(true); });
      }}>
        <label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <button className="button secondary" disabled={busy || !email || !authClient.configured}>{busy ? "Please wait…" : "Email me a secure link"}</button>
      </form></>}
      {sent && <Notice kind="success">Check your inbox. The sign-in link will bring you back here.</Notice>}
      <p className="fine-print">{developmentAuthEnabled ? "Development-only access. This option cannot be enabled in a production build." : "By continuing, you agree to the Terms and acknowledge the Privacy Notice."}</p>
    </section>
  </main>;
}

function Steps({ view }: { view: View }) {
  const steps: { key: Exclude<View, "JOBS">; label: string }[] = [
    { key: "WELCOME", label: "Start" }, { key: "RESUME", label: "Resume" },
    { key: "REVIEW", label: "Review" }, { key: "PROFILE", label: "Ready" }
  ];
  const active = steps.findIndex((step) => step.key === view);
  return <ol className="steps">{steps.map((step, index) => <li key={step.key} className={index <= active ? "active" : ""}>
    <span>{index < active ? "✓" : index + 1}</span><b>{step.label}</b>
  </li>)}</ol>;
}

const roleOptions = ["BACKEND", "FRONTEND", "FULLSTACK", "MOBILE", "DEVOPS", "DATA", "ML_AI", "QA", "SECURITY", "EMBEDDED", "PRODUCT", "DESIGN", "ENGINEERING_MANAGEMENT"];

function JobPreferences({ api, profile, onSaved }: { api: CandidateApi; profile: SearchProfile; onSaved: (profile: SearchProfile) => void }) {
  const [draft, setDraft] = useState(profile.preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleMode = (mode: string) => setDraft({
    ...draft,
    preferredWorkModes: draft.preferredWorkModes.includes(mode)
      ? draft.preferredWorkModes.filter((item) => item !== mode)
      : [...draft.preferredWorkModes, mode]
  });
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { onSaved(await api.saveSearchProfile(profile.version, draft, idempotencyKey("job-search-profile"))); }
    catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }
  return <form className="job-preferences" onSubmit={(event) => void save(event)}>
    <div className="section-heading"><div><p className="eyebrow">SEARCH SIGNALS</p><h2>Tell us what fits—and what never will.</h2><p>Hard exclusions hide only explicit conflicts. Missing job information stays visible as an unknown.</p></div></div>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="preference-grid">
      <label>Target role<select value={draft.targetRoleFamilies[0] ?? ""} onChange={(event) => setDraft({ ...draft, targetRoleFamilies: event.target.value ? [event.target.value] : [] })}><option value="">Any engineering role</option>{roleOptions.map((role) => <option key={role} value={role}>{humanJobValue(role)}</option>)}</select></label>
      <label>Preferred country<input maxLength={2} value={draft.preferredCountryCodes[0] ?? ""} onChange={(event) => setDraft({ ...draft, preferredCountryCodes: event.target.value ? [event.target.value.toUpperCase()] : [] })} placeholder="IN" /></label>
      <label className="wide">Excluded companies<input value={draft.excludedCompanyNames.join(", ")} onChange={(event) => setDraft({ ...draft, excludedCompanyNames: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Companies you never want to see" /></label>
    </div>
    <div className="preference-row"><b>Work mode</b>{["REMOTE", "HYBRID", "ONSITE"].map((mode) => <label className="check" key={mode}><input type="checkbox" checked={draft.preferredWorkModes.includes(mode)} onChange={() => toggleMode(mode)} />{humanJobValue(mode)}</label>)}</div>
    <div className="preference-row"><b>Hard deal-breakers</b>{([
      ["mandatoryRelocation", "Mandatory relocation"], ["nightShift", "Night shift"],
      ["heavyTravel", "Heavy travel"], ["employmentBond", "Employment bond"]
    ] as const).map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={draft.dealBreakers[key]} onChange={(event) => setDraft({ ...draft, dealBreakers: { ...draft.dealBreakers, [key]: event.target.checked } })} />{label}</label>)}</div>
    <button className="button secondary" disabled={busy}>{busy ? "Saving…" : "Save search signals"}</button>
  </form>;
}

function JobDocuments({ api, job }: { api: CandidateApi; job: JobResult }) {
  const [editing, setEditing] = useState<EditableDocumentDraft | null>(null);
  const [strength, setStrength] = useState<"LIGHT" | "FOCUSED">("FOCUSED");
  const [template, setTemplate] = useState<"CLASSIC" | "COMPACT">("CLASSIC");
  const [draft, setDraft] = useState<CandidateDocument | null>(null);
  const [busy, setBusy] = useState<"TAILORED_RESUME" | "COVER_LETTER" | "APPROVE" | "EDIT" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function generate(type: "TAILORED_RESUME" | "COVER_LETTER") {
    setBusy(type); setError(null); setEditing(null);
    try { setDraft((await api.generateDocument(job.id, type, strength, idempotencyKey(`generate-${type.toLowerCase()}`), template)).document); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }
  async function preview() {
    if (!draft) return;
    try {
      const blob = await api.downloadDocument(draft.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { setError(message(reason)); }
  }
  async function approve() {
    if (!draft) return;
    setBusy("APPROVE"); setError(null);
    try { setDraft((await api.approveDocument(draft.id, idempotencyKey("approve-document"))).document); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }
  async function edit() {
    if (!draft) return;
    setBusy("EDIT"); setError(null);
    try { setEditing((await api.editableDocument(draft.id)).draft); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }
  async function saveRevision() {
    if (!draft || !editing) return;
    setBusy("EDIT"); setError(null);
    try { setDraft((await api.reviseDocument(draft.id, editing, template, idempotencyKey("revise-document"))).document); setEditing(null); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(null); }
  }
  return <section className="job-documents"><h3>Application documents</h3><p>Create a private job-specific draft from verified profile facts. Nothing is selected for Copilot until you review and approve it.</p>
    <div className="preference-grid"><label>Tailoring approach<select value={strength} onChange={(event) => setStrength(event.target.value as "LIGHT" | "FOCUSED")} disabled={Boolean(busy)}><option value="LIGHT">Light — keep the original emphasis</option><option value="FOCUSED">Focused — prioritize relevant evidence</option></select></label><label>ATS-friendly layout<select value={template} onChange={(event) => setTemplate(event.target.value as "CLASSIC" | "COMPACT")} disabled={Boolean(busy)}><option value="CLASSIC">Classic · comfortable spacing</option><option value="COMPACT">Compact · denser spacing</option></select></label></div>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="document-actions">
      <button className="button secondary" disabled={Boolean(busy)} onClick={() => void generate("TAILORED_RESUME")}>{busy === "TAILORED_RESUME" ? "Tailoring…" : "Tailor résumé"}</button>
      <button className="button secondary" disabled={Boolean(busy)} onClick={() => void generate("COVER_LETTER")}>{busy === "COVER_LETTER" ? "Writing…" : "Create cover letter"}</button>
    </div>
    {draft && <div className="document-draft"><div><b>{draft.fileName}</b><span>Version {draft.version} · {draft.status === "READY" ? "approved and ready" : "review required"}</span></div><div>
      <button onClick={() => void preview()}>Preview</button>
      <button onClick={() => void edit()} disabled={Boolean(busy)}>Edit draft</button>
      <button onClick={() => { setDraft(null); setEditing(null); }} disabled={Boolean(busy)}>Exit tailoring</button>
      {draft.status !== "READY" && !editing && <button className="button" disabled={Boolean(busy)} onClick={() => void approve()}>{busy === "APPROVE" ? "Approving…" : "Approve for use"}</button>}
    </div></div>}
    {editing && <section className="draft-editor"><h4>Refine your draft</h4><p>Edit wording or remove sections. New facts must first be verified in your profile. Saving creates a new version that needs approval.</p><label>Title<input value={editing.title} maxLength={240} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>{editing.blocks.map((block, index) => <label key={index}>{block.kind.toLowerCase()} {index + 1}<textarea value={block.text} maxLength={2000} rows={block.kind === "HEADING" ? 1 : 3} onChange={(event) => setEditing({ ...editing, blocks: editing.blocks.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} /><button type="button" className="text-button" disabled={Boolean(busy) || editing.blocks.length === 1} onClick={() => setEditing({ ...editing, blocks: editing.blocks.filter((_, i) => i !== index) })}>Remove section</button></label>)}<div className="document-actions"><button className="button" disabled={Boolean(busy)} onClick={() => void saveRevision()}>Save new draft version</button><button className="button secondary" disabled={Boolean(busy)} onClick={() => setEditing(null)}>Discard edits</button></div></section>}
  </section>;
}

function JobDescription({ text }: { text: string }) {
  // Render employer text as text, never trusted HTML. Preserve paragraph/list structure.
  const blocks = text.split(/\n\s*\n|\r?\n/).map((line) => line.trim()).filter(Boolean);
  return <div className="job-description">{blocks.map((block, index) => /^[•*–-]\s/.test(block)
    ? <ul key={index}><li>{block.replace(/^[•*–-]\s+/, "")}</li></ul>
    : block.length < 90 && (/[:：]$/.test(block) || /^(about (?:us|you|the role)|responsibilities|requirements|qualifications|benefits|what (?:you|we).*)$/i.test(block))
      ? <h4 key={index}>{block}</h4> : <p key={index}>{block}</p>)}</div>;
}

function JobDetail({ api, job, onClose, onApply }: { api: CandidateApi; job: JobResult; onClose: () => void; onApply: (job: JobResult, extensionConsumedClick?: boolean) => void }) {
  const [tab, setTab] = useState<"about" | "match" | "documents">("about");
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [onClose]);
  return <aside className="job-detail" aria-label="Job details">
    <button className="detail-close" onClick={onClose} aria-label="Close job details">×</button>
    <p className="eyebrow">{job.company} · {humanJobValue(job.freshness.state)}</p>
    <h1>{job.title}</h1>
    <div className="job-meta"><span>{job.location ?? (job.countryCodes.join(", ") || "Location not specified")}</span>{job.workMode !== "UNKNOWN" && <span>{humanJobValue(job.workMode)}</span>}{job.employmentType !== "UNKNOWN" && <span>{humanJobValue(job.employmentType)}</span>}{formatJobCompensation(job.compensation) && <span>{formatJobCompensation(job.compensation)}</span>}</div>
    <div className={`match-banner ${job.match.label.toLowerCase()}`}><b>{humanJobValue(job.match.label)}</b><span>{job.match.score}/100</span></div>
    <nav className="detail-tabs" aria-label="Job information">{(["about", "match", "documents"] as const).map((name) => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name === "about" ? "About the role" : name === "match" ? "Your match" : "Documents"}{name === "match" && job.match.gaps.length > 0 ? ` · ${job.match.gaps.length} gaps` : ""}</button>)}</nav>
    <div hidden={tab !== "match"}>
    <section><h3>Why it fits</h3>{job.match.reasons.length ? <ul>{job.match.reasons.slice(0, 5).map((item) => <li key={item.code}>{item.message}</li>)}</ul> : <p>We need more confirmed profile information to explain this match.</p>}</section>
    {job.match.gaps.length > 0 && <section className="gap-section"><h3>Potential gaps</h3><ul>{job.match.gaps.slice(0, 5).map((item) => <li key={item.code}>{item.message}</li>)}</ul></section>}
    {job.match.unknowns.length > 0 && <section><h3>Worth checking</h3><ul>{job.match.unknowns.slice(0, 5).map((item) => <li key={item.code}>{item.message}</li>)}</ul></section>}
    </div>
    <section hidden={tab !== "about"} className="about-section"><h3>About the role</h3><JobDescription text={job.description} />
    <div className="skill-cloud">{job.skills.required.map((skill) => <span className="required" key={skill.key}>{skill.label}</span>)}{job.skills.preferred.map((skill) => <span key={skill.key}>{skill.label}</span>)}</div>
    </section>
    <div hidden={tab !== "documents"}><JobDocuments api={api} job={job} /></div>
    <footer className="detail-apply"><p>Autofill, review, then submit.<br /><small>Declarations always stay in your hands.</small></p>
    <button
      className="button apply-link"
      type="button"
      data-jh-copilot-launch="true"
      data-job-id={job.id}
      data-application-url={job.applicationUrl}
      onClick={(event) => onApply(job, event.currentTarget.getAttribute("data-jh-launch-consumed") === "1")}
    >Apply with Copilot ↗</button></footer>
  </aside>;
}

function JobsView({ api, onApply }: { api: CandidateApi; onApply: (job: JobResult, extensionConsumedClick?: boolean) => void }) {
  const [items, setItems] = useState<JobResult[]>([]);
  const [searchProfile, setSearchProfile] = useState<SearchProfile | null>(null);
  const [selected, setSelected] = useState<JobResult | null>(null);
  const [query, setQuery] = useState("");
  const [roleFamily, setRoleFamily] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (append = false, cursor?: string) => {
    setBusy(true); setError(null);
    try {
      const page = await api.jobs({ query, roleFamily, workMode, limit: 20, ...(cursor ? { cursor } : {}) });
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setSelected((current) => append ? current ?? page.items[0] ?? null : page.items.find((job) => job.id === current?.id) ?? page.items[0] ?? null);
      setNextCursor(page.nextCursor);
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }, [api, query, roleFamily, workMode]);
  useEffect(() => { void Promise.all([load(), api.searchProfile().then(setSearchProfile)]).catch((reason) => setError(message(reason))); }, [api]);
  return <div className={`jobs-layout${selected ? " focused-browsing" : ""}`}>
    <section className="jobs-hero"><div><p className="eyebrow">YOUR NEXT MOVE</p><h1>Find your next role.</h1>{!selected && <p>Matches based on your profile. See what fits, review the gaps, and apply with Copilot.</p>}</div><button className="button secondary" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>{showFilters ? "Hide filters" : "Search & filters"}</button></section>
    {showPreferences && searchProfile && <JobPreferences api={api} profile={searchProfile} onSaved={(next) => { setSearchProfile(next); setShowPreferences(false); void load(); }} />}
    <form className="job-search" hidden={!showFilters} onSubmit={(event) => { event.preventDefault(); setShowFilters(false); void load(); }}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, skill or keyword" aria-label="Search jobs" />
      <select aria-label="Role family" value={roleFamily} onChange={(event) => setRoleFamily(event.target.value)}><option value="">All role families</option>{roleOptions.map((role) => <option key={role} value={role}>{humanJobValue(role)}</option>)}</select>
      <select aria-label="Work mode" value={workMode} onChange={(event) => setWorkMode(event.target.value)}><option value="">Any work mode</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option></select>
      <button className="button">Find roles</button>
      <button type="button" className="text-button" onClick={() => setShowPreferences(!showPreferences)}>Search preferences</button>
    </form>
    {error && <Notice kind="error">{error}</Notice>}
    <p className="results-caption">{items.length} roles loaded · Ranked for your profile <span>Match scores are guidance, not hiring predictions.</span></p>
    <div className={`job-browser${selected ? " has-selection" : ""}`}>
    {busy && !items.length ? <Spinner label="Ranking eligible jobs" /> : items.length === 0 ? <section className="empty-jobs"><h2>No compatible jobs found yet.</h2><p>Try wider filters or tune your search signals. Explicit deal-breakers will stay respected.</p></section> : <div className="job-grid">{items.map((job) => <article className={`job-card${selected?.id === job.id ? " selected" : ""}`} key={job.id} onClick={() => setSelected(job)}>
      <div className="job-card-top"><span className={`match-score ${job.match.label.toLowerCase()}`}>{job.match.score}</span><span className={`freshness ${job.freshness.state.toLowerCase()}`}>{humanJobValue(job.freshness.state)}</span></div>
      <p className="company-name">{job.company}</p><h2>{job.title}</h2>
      <div className="job-meta"><span>{job.location ?? (job.countryCodes.join(", ") || "Location unclear")}</span><span>{humanJobValue(job.workMode)}</span>{formatJobCompensation(job.compensation) && <span>{formatJobCompensation(job.compensation)}</span>}</div>
      <p className="match-copy">{primaryMatchMessage(job.match)}</p>
      <div className="skill-cloud">{job.skills.required.slice(0, 4).map((skill) => <span className="required" key={skill.key}>{skill.label}</span>)}</div>
      <button className="card-action" aria-pressed={selected?.id === job.id} onClick={() => setSelected(job)}>View match details →</button>
    </article>)}</div>}
    {selected && <JobDetail key={selected.id} api={api} job={selected} onClose={() => setSelected(null)} onApply={onApply} />}
    </div>
    {nextCursor && <button className="button secondary load-more" disabled={busy} onClick={() => void load(true, nextCursor)}>{busy ? "Loading…" : "Load more compatible jobs"}</button>}
  </div>;
}

interface CopilotPromptState { job: JobResult; state: CopilotConnectionState; originPattern: string | null }

function CopilotPrompt({ prompt, onClose }: { prompt: CopilotPromptState; onClose: () => void }) {
  const content = prompt.state === "CONNECTING"
    ? { eyebrow: "CONNECTING COPILOT", title: "Preparing the application…", copy: "Checking the extension and your private Job Hunter session." }
    : prompt.state === "NOT_INSTALLED"
      ? { eyebrow: "ONE-TIME SETUP", title: "Get Job Hunter Copilot", copy: "Install the browser extension once to scan supported application forms. You still review every action." }
      : prompt.state === "PERMISSION_REQUIRED"
        ? { eyebrow: "SITE ACCESS", title: "Allow this employer site", copy: "Copilot is open. In the side panel, allow access only to this employer origin, then the application scan will start." }
        : prompt.state === "BACKEND_UNAVAILABLE"
          ? { eyebrow: "TEMPORARILY OFFLINE", title: "Copilot could not reach Job Hunter", copy: "Your application was not changed. Retry when the backend is available." }
          : prompt.state === "EXTENSION_UPDATE_REQUIRED"
            ? { eyebrow: "UPDATE NEEDED", title: "Update Job Hunter Copilot", copy: "The installed extension is not compatible with this version of the website." }
            : { eyebrow: "RECONNECT", title: "Reconnect Job Hunter Copilot", copy: "Your browser session is missing or expired. Refresh this page and try again." };
  return <div className="copilot-dialog-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
    <section className="copilot-dialog" role="dialog" aria-modal="true" aria-labelledby="copilot-dialog-title">
      <button className="detail-close" onClick={onClose} aria-label="Close Copilot setup">×</button>
      <p className="eyebrow">{content.eyebrow}</p><h2 id="copilot-dialog-title">{content.title}</h2><p>{content.copy}</p>
      <div className="copilot-benefits"><span>✓ Verified details only</span><span>✓ Per-site access</span><span>✓ You review before submitting</span></div>
      {prompt.state === "NOT_INSTALLED" && extensionInstallUrl && <a className="button" href={extensionInstallUrl} target="_blank" rel="noreferrer">Install Copilot — Free</a>}
      {prompt.state === "NOT_INSTALLED" && !extensionInstallUrl && <p className="copilot-local-note">Local testing: open <code>chrome://extensions</code>, enable Developer mode, then load <code>apps/extension/dist</code> as an unpacked extension.</p>}
      {prompt.state === "CONNECTING" && <Spinner label="Connecting securely" />}
      <a className="button secondary" href={prompt.job.applicationUrl} target="_blank" rel="noreferrer">Continue without Copilot</a>
    </section>
  </div>;
}

function Welcome({ onResume, onManual }: { onResume: () => void; onManual: () => void }) {
  return <section className="page-card welcome">
    <p className="eyebrow">WELCOME TO YOUR COPILOT</p>
    <h1>Let’s build the profile that fills applications for you.</h1>
    <p className="lead">A resume gets you started fastest. We’ll extract useful details, show every suggestion, and save only what you confirm.</p>
    <div className="choice-grid">
      <button className="choice primary-choice" onClick={onResume}>
        <span className="choice-icon">↥</span><b>Start with my resume</b><small>PDF · up to 10 MB · about 2 minutes</small><i>Recommended</i>
      </button>
      <button className="choice" onClick={onManual}>
        <span className="choice-icon">✎</span><b>Build my profile manually</b><small>Add only the essentials now</small>
      </button>
    </div>
    <div className="privacy-line"><b>Your data stays yours.</b> Extracted suggestions never become reusable until you confirm them.</div>
  </section>;
}

function ResumeUpload({ api, onReview, onManual }: { api: CandidateApi; onReview: (review: ResumeReview) => void; onManual: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<"IDLE" | "UPLOADING" | "EXTRACTING">("IDLE");
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (!file) return;
    setError(null); setState("UPLOADING");
    try {
      const upload = await api.uploadResume(file, idempotencyKey("resume-upload"), setProgress);
      setState("EXTRACTING");
      const review = await api.extract(upload.document.id, idempotencyKey("resume-extract"));
      onReview(review);
    } catch (reason) { setError(message(reason)); setState("IDLE"); }
  }
  function choose(candidate: File | undefined) {
    if (!candidate) return;
    if (candidate.type !== "application/pdf" || candidate.size > 10 * 1024 * 1024) {
      setError("Choose a PDF no larger than 10 MB."); return;
    }
    setError(null); setFile(candidate);
  }
  return <section className="page-card narrow">
    <p className="eyebrow">STEP 1 · MASTER RESUME</p><h1>Give Copilot a head start.</h1>
    <p>We read the PDF privately and turn it into suggestions for your review. Nothing is saved to your reusable profile yet.</p>
    {error && <Notice kind="error">{error}</Notice>}
    <label className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}>
      <input type="file" accept="application/pdf,.pdf" onChange={(event) => choose(event.target.files?.[0])} />
      <span className="upload-icon">↥</span>
      <b>{file ? file.name : "Drop your resume here"}</b>
      <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Ready to upload` : "or click to choose a PDF · maximum 10 MB"}</small>
    </label>
    {state !== "IDLE" && <div className="progress-wrap"><div className="progress"><span style={{ width: `${state === "EXTRACTING" ? 100 : progress}%` }} /></div><p>{state === "UPLOADING" ? `Uploading securely · ${progress}%` : "Finding your experience, skills and contact details…"}</p></div>}
    <button className="button" disabled={!file || state !== "IDLE"} onClick={() => void run()}>{state === "IDLE" ? "Upload and review" : "Working…"}</button>
    <button className="text-button" disabled={state !== "IDLE"} onClick={onManual}>I’ll enter details manually</button>
  </section>;
}

type ReviewChoice = { action: "ACCEPT" | "CORRECT" | "REMOVE" | "SKIP"; value: string };

function ReviewResume({ api, initial, onDone }: { api: CandidateApi; initial: ResumeReview; onDone: (changeSetId: string | null) => void }) {
  const review = initial;
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>(() => Object.fromEntries(initial.proposals.map((proposal) => [proposal.id, {
    action: ["CONFLICT", "AMBIGUOUS"].includes(proposal.comparison) ? "SKIP" : "ACCEPT", value: displayValue(proposal.value)
  }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflicts = review.proposals.filter((item) => ["CONFLICT", "AMBIGUOUS"].includes(item.comparison)).length;
  async function submit() {
    setBusy(true); setError(null);
    try {
      const result = await api.confirm({
        documentId: review.document.id,
        decisions: review.proposals.map((proposal) => {
          const choice = choices[proposal.id] as ReviewChoice;
          return {
            proposalId: proposal.id,
            action: choice.action,
            ...(choice.action === "CORRECT" ? { correctedValue: correctedValue(proposal.value, choice.value) } : {})
          };
        })
      }, idempotencyKey("resume-confirm"));
      onDone(result.changeSetId);
    } catch (reason) { setError(message(reason)); setBusy(false); }
  }
  return <section className="page-card review-page">
    <div className="section-heading"><div><p className="eyebrow">STEP 2 · REVIEW</p><h1>Make this profile yours.</h1><p>We found {review.proposals.length} items in <b>{review.document.fileName}</b>. Review them before saving.</p></div><span className="status-pill">{review.extraction?.status === "PARTIAL" ? "Partial extraction" : "Extraction complete"}</span></div>
    {conflicts > 0 && <Notice>{conflicts} {conflicts === 1 ? "item differs" : "items differ"} from your saved profile. We’ll keep the saved value unless you choose the resume value.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
    <div className="review-list">{review.proposals.map((proposal) => {
      const choice = choices[proposal.id] as ReviewChoice;
      return <article className={`review-item ${proposal.comparison.toLowerCase()}`} key={proposal.id}>
        <div className="review-copy"><span className="field-label">{proposal.field.toLowerCase().split("_").map((x) => x[0]?.toUpperCase() + x.slice(1)).join(" ")}</span>
          {choice.action === "CORRECT" && proposal.value.kind !== "FILE_REF"
            ? <input value={choice.value} onChange={(event) => setChoices({ ...choices, [proposal.id]: { ...choice, value: event.target.value } })} />
            : <strong>{displayValue(proposal.value)}</strong>}
          <small>{["MATCH", "REPEATABLE_ENTITY_MATCH"].includes(proposal.comparison) ? "Matches your saved profile" : proposal.comparison === "CONFLICT" ? "Different from your saved profile" : proposal.comparison === "AMBIGUOUS" ? "Could match more than one saved entry" : `${Math.round(proposal.confidence * 100)}% extraction confidence`} · {proposal.sourceSection.toLowerCase()}</small>
        </div>
        <div className="review-actions">
          <button className={choice.action === "ACCEPT" ? "selected" : ""} onClick={() => setChoices({ ...choices, [proposal.id]: { ...choice, action: "ACCEPT" } })}>{["CONFLICT", "AMBIGUOUS"].includes(proposal.comparison) ? "Use resume" : "Keep"}</button>
          {proposal.value.kind !== "FILE_REF" && <button className={choice.action === "CORRECT" ? "selected" : ""} onClick={() => setChoices({ ...choices, [proposal.id]: { ...choice, action: "CORRECT" } })}>Edit</button>}
          <button className={["REMOVE", "SKIP"].includes(choice.action) ? "selected muted" : ""} onClick={() => setChoices({ ...choices, [proposal.id]: { ...choice, action: ["CONFLICT", "AMBIGUOUS"].includes(proposal.comparison) ? "SKIP" : "REMOVE" } })}>{["CONFLICT", "AMBIGUOUS"].includes(proposal.comparison) ? "Keep saved" : "Remove"}</button>
        </div>
      </article>;
    })}</div>
    <div className="sticky-action"><span><b>{review.proposals.filter((item) => ["ACCEPT", "CORRECT"].includes(choices[item.id]?.action ?? "")).length}</b> items will be added or confirmed</span><button className="button" disabled={busy} onClick={() => void submit()}>{busy ? "Saving securely…" : "Save my profile"}</button></div>
  </section>;
}

function EssentialEditor({ api, profile, onSaved }: { api: CandidateApi; profile: ProfileSnapshot; onSaved: (changeSetId: string) => Promise<void> }) {
  const current = useMemo(() => new Map(profile.answers.filter((item) => !item.entityId && item.scopeType === "GLOBAL").map((item) => [item.canonicalKey, item])), [profile]);
  const authoritativeDraft = useMemo(() => essentialProfileDraft(profile.answers), [profile.answers]);
  // Keep only candidate edits in local state. Mirroring the complete profile in
  // state allowed a stale empty field to outlive a newer authoritative answer.
  const [edits, setEdits] = useState<Partial<EssentialProfileDraft>>({});
  const draft = { ...authoritativeDraft, ...edits };
  useEffect(() => setEdits({}), [authoritativeDraft]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const specs = [
      ["name", "FULL_NAME", { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: draft.name.trim() }],
      ["email", "EMAIL", { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: draft.email.trim().toLowerCase() }],
      ["phone", "PHONE", correctedValue({ kind: "PHONE" }, draft.phone)],
      ["skills", "SKILLS", correctedValue({ kind: "MULTI_ENUM" }, draft.skills)]
    ] as const;
    const items = specs.filter(([draftKey]) => draft[draftKey] && draft[draftKey] !== authoritativeDraft[draftKey]).map(([draftKey, canonical, value]) => ({
      itemKey: draftKey, canonicalKey: canonical, normalizedValue: value,
      expectedCurrentVersionId: current.get(canonical)?.answerVersionId ?? null
    }));
    if (!items.length) { setBusy(false); return; }
    try { await onSaved((await api.saveProfile(items, idempotencyKey("profile-save"))).changeSetId); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  return <form className="editor" onSubmit={(event) => void save(event)}>
    <div className="section-heading"><div><p className="eyebrow">PROFILE ESSENTIALS</p><h2>{profile.answers.length ? "Review your essentials" : "Start with what employers need"}</h2></div></div>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="form-grid">
      <label>Full name<input required value={draft.name} onChange={(e) => setEdits((current) => ({ ...current, name: e.target.value }))} placeholder="Your full name" /></label>
      <label>Email<input required type="email" value={draft.email} onChange={(e) => setEdits((current) => ({ ...current, email: e.target.value }))} placeholder="you@example.com" /></label>
      <label>Phone<input required value={draft.phone} onChange={(e) => setEdits((current) => ({ ...current, phone: e.target.value }))} placeholder="+91 98765 43210" /></label>
      <label>Skills <small>comma separated</small><input value={draft.skills} onChange={(e) => setEdits((current) => ({ ...current, skills: e.target.value }))} placeholder="TypeScript, React, PostgreSQL" /></label>
    </div>
    <button className="button" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
  </form>;
}

function ExperienceEditor({ api, profile, onSaved }: { api: CandidateApi; profile: ProfileSnapshot; onSaved: (changeSetId: string) => Promise<void> }) {
  const authoritative = useMemo(() => employmentProfileDrafts(profile.answers), [profile.answers]);
  const [drafts, setDrafts] = useState(authoritative);
  const [newExperience, setNewExperience] = useState({ company: "", title: "" });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDrafts(authoritative), [authoritative]);
  const stringValue = (value: string) => ({
    schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: value.trim()
  });
  async function saveExisting(event: FormEvent, draft: EmploymentProfileDraft) {
    event.preventDefault();
    const saved = authoritative.find((item) => item.entityId === draft.entityId);
    if (!saved) return;
    const items = [
      ...(draft.company.trim() && draft.company.trim() !== saved.company ? [{
        itemKey: `company:${draft.entityId}`, canonicalKey: "EMPLOYMENT_COMPANY",
        normalizedValue: stringValue(draft.company), entityId: draft.entityId,
        entityType: "EMPLOYMENT", expectedCurrentVersionId: saved.companyVersionId
      }] : []),
      ...(draft.title.trim() && draft.title.trim() !== saved.title ? [{
        itemKey: `title:${draft.entityId}`, canonicalKey: "EMPLOYMENT_TITLE",
        normalizedValue: stringValue(draft.title), entityId: draft.entityId,
        entityType: "EMPLOYMENT", expectedCurrentVersionId: saved.titleVersionId
      }] : [])
    ];
    if (!items.length) return;
    setBusyKey(draft.entityId); setError(null);
    try { await onSaved((await api.saveProfile(items, idempotencyKey("experience-save"))).changeSetId); }
    catch (reason) { setError(message(reason)); }
    finally { setBusyKey(null); }
  }
  async function addExperience(event: FormEvent) {
    event.preventDefault();
    const company = newExperience.company.trim();
    const title = newExperience.title.trim();
    if (!company || !title) return;
    const clientKey = crypto.randomUUID();
    setBusyKey("new"); setError(null);
    try {
      const saved = await api.saveProfile([
        { itemKey: "company", canonicalKey: "EMPLOYMENT_COMPANY", normalizedValue: stringValue(company), entityType: "EMPLOYMENT", newEntityClientKey: clientKey, expectedCurrentVersionId: null },
        { itemKey: "title", canonicalKey: "EMPLOYMENT_TITLE", normalizedValue: stringValue(title), entityType: "EMPLOYMENT", newEntityClientKey: clientKey, expectedCurrentVersionId: null }
      ], idempotencyKey("experience-add"));
      setNewExperience({ company: "", title: "" });
      await onSaved(saved.changeSetId);
    } catch (reason) { setError(message(reason)); }
    finally { setBusyKey(null); }
  }
  const update = (entityId: string, changes: Partial<EmploymentProfileDraft>) =>
    setDrafts((current) => current.map((item) => item.entityId === entityId ? { ...item, ...changes } : item));
  return <section className="repeatable-editor">
    <div className="section-heading"><div><p className="eyebrow">CAREER HISTORY</p><h2>Your experience</h2><p>Each role stays a separate record, so changing one employer never edits another.</p></div></div>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="experience-grid">
      {drafts.map((draft, index) => <form className="experience-card" key={draft.entityId} onSubmit={(event) => void saveExisting(event, draft)}>
        <b>Experience {index + 1}</b>
        <label>Company<input required value={draft.company} onChange={(event) => update(draft.entityId, { company: event.target.value })} /></label>
        <label>Job title<input required value={draft.title} onChange={(event) => update(draft.entityId, { title: event.target.value })} /></label>
        <button className="button secondary" disabled={busyKey === draft.entityId}>{busyKey === draft.entityId ? "Saving…" : "Save experience"}</button>
      </form>)}
      <form className="experience-card new" onSubmit={(event) => void addExperience(event)}>
        <b>Add experience</b>
        <label>Company<input required value={newExperience.company} onChange={(event) => setNewExperience({ ...newExperience, company: event.target.value })} placeholder="Employer name" /></label>
        <label>Job title<input required value={newExperience.title} onChange={(event) => setNewExperience({ ...newExperience, title: event.target.value })} placeholder="Your role" /></label>
        <button className="button secondary" disabled={busyKey === "new"}>{busyKey === "new" ? "Adding…" : "Add to profile"}</button>
      </form>
    </div>
  </section>;
}

function ProfileView({ api, onSignOut, onBrowse, onReplaceResume, onCompleted, initialChangeSet, mode = "PROFILE", onProfile }: { api: CandidateApi; onSignOut: () => void; onBrowse: () => void; onReplaceResume: () => void; onCompleted: () => void; initialChangeSet: string | null; mode?: "PROFILE" | "DOCUMENTS" | "ATTENTION"; onProfile: () => void }) {
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [documents, setDocuments] = useState<CandidateDocument[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<string | null>(initialChangeSet);
  const [showHistory, setShowHistory] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [profileResult, readinessResult, historyResult, documentsResult] = await Promise.allSettled([
        api.profile(), api.readiness(), api.history(), api.documents()
      ]);
      if (profileResult.status === "rejected") throw profileResult.reason;
      if (readinessResult.status === "rejected") throw readinessResult.reason;
      setProfile(profileResult.value); setReadiness(readinessResult.value);
      setHistory(historyResult.status === "fulfilled" ? historyResult.value.entries : []);
      setDocuments(documentsResult.status === "fulfilled" ? documentsResult.value.documents : []);
      const unavailable = [
        ...(historyResult.status === "rejected" ? ["change history"] : []),
        ...(documentsResult.status === "rejected" ? ["documents"] : [])
      ];
      if (unavailable.length) setError(`Your profile loaded, but ${unavailable.join(" and ")} are temporarily unavailable.`);
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  async function undo() {
    if (!lastChange) return;
    try {
      const result = await api.undo(lastChange, idempotencyKey("profile-undo"));
      setLastChange(null); await load();
      if (result.summary.skippedNewerVersion) setError(`${result.summary.skippedNewerVersion} newer field was kept while the rest was undone.`);
    } catch (reason) { setError(message(reason)); }
  }
  async function complete() {
    if (!profile) return;
    try { await api.complete(profile.onboardingVersion, idempotencyKey("onboarding-complete")); onCompleted(); await load(); }
    catch (reason) { setError(message(reason)); }
  }
  async function download(document: CandidateDocument) {
    try {
      const blob = await api.downloadDocument(document.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName ?? `document-v${document.version}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(message(reason)); }
  }
  if (busy && !profile) return <Spinner label="Loading your verified profile" />;
  if (!profile || !readiness) return <Notice kind="error">{error ?? "Profile could not be loaded."}</Notice>;
  const sections = profile.answers.reduce<Record<string, ProfileAnswer[]>>((grouped, answer) => {
    (grouped[answer.section] ??= []).push(answer);
    return grouped;
  }, {});
  const pending = readiness.requirements.filter((item) => !item.met);
  const stale = profile.answers.filter((answer) => answer.freshness.state !== "FRESH");
  const drafts = documents.filter((document) => document.status === "RECONCILING");
  return <div className="profile-layout">
    {error && <Notice kind="error">{error}</Notice>}
    {lastChange && <div className="undo-toast"><span>Updated for next time.</span><button onClick={() => void undo()}>Undo</button></div>}
    {mode === "ATTENTION" && <><section className="workspace-heading"><p className="eyebrow">YOUR REVIEW QUEUE</p><h1>A little attention. A smoother application.</h1><p>Profile gaps and document drafts from your account. Live employer-form blockers remain in the Copilot side panel.</p></section><div className="attention-grid">
      <section className="profile-section"><p className="eyebrow">01 · ESSENTIALS</p><h2>{pending.length} profile gaps</h2>{pending.map((item) => <div className="answer-row" key={item.key}><div><b>{item.label}</b><span>{item.reason}</span></div><small>{item.blocking ? "Required" : "Optional"}</small></div>)}{!pending.length && <p>Your essentials are complete.</p>}{readiness.conflicts > 0 && <p role="alert">{readiness.conflicts} résumé conflicts need review.</p>}<button className="button secondary" onClick={onProfile}>Review profile</button>{readiness.conflicts > 0 && <button className="text-button" onClick={() => { window.location.hash = "review"; }}>Review résumé conflicts</button>}</section>
      <section className="profile-section"><p className="eyebrow">02 · KEEP IT CURRENT</p><h2>{stale.length} answers to check</h2>{stale.map((answer) => <div className="answer-row" key={answer.answerVersionId}><div><b>{answer.label}</b><span>{answer.scopeType.toLowerCase()} · {displayValue(answer.normalizedValue)}</span></div><small className="stale">Check again</small></div>)}{!stale.length && <p>No saved answers are due for review.</p>}<button className="button secondary" onClick={onProfile}>Update answers</button></section>
      <section className="profile-section"><p className="eyebrow">03 · BEFORE YOU APPLY</p><h2>{drafts.length} document drafts</h2><p>Unapproved drafts are not selected for applications. Review each document before approving it.</p><button className="button secondary" onClick={() => { window.location.hash = "documents"; }}>Review documents</button></section>
    </div><CareerSetup api={api} profile={profile} onSaved={async (id) => { setLastChange(id); await load(); }} /></>}
    {mode === "PROFILE" && <><section className="readiness-card">
      <div><p className="eyebrow">COPILOT READINESS</p><h1>{readiness.ready ? "Your essentials are ready." : "A few essentials need you."}</h1><p>{readiness.ready ? "You can keep improving this profile anytime. Copilot will always use the latest verified version." : "Complete the required items below. Everything else is optional for now."}</p></div>
      <div className={`readiness-orb ${readiness.ready ? "ready" : ""}`}><b>{readiness.requirements.filter((item) => item.met).length}/{readiness.requirements.length}</b><span>clear signals</span></div>
    </section>
    <div className="requirements">{readiness.requirements.map((item) => <div key={item.key} className={item.met ? "met" : item.blocking ? "missing" : "optional"}><span>{item.met ? "✓" : item.blocking ? "!" : "○"}</span><div><b>{item.label}</b><small>{item.reason}</small></div></div>)}</div>
    {readiness.conflicts > 0 && <Notice kind="error">Resolve {readiness.conflicts} resume {readiness.conflicts === 1 ? "conflict" : "conflicts"} before finishing onboarding.</Notice>}
    <EssentialEditor api={api} profile={profile} onSaved={async (changeSetId) => { setLastChange(changeSetId); await load(); }} />
    <CareerSetup api={api} profile={profile} onSaved={async (changeSetId) => { setLastChange(changeSetId); await load(); }} />
    <ExperienceEditor api={api} profile={profile} onSaved={async (changeSetId) => { setLastChange(changeSetId); await load(); }} />
    </>}
    {mode === "DOCUMENTS" && <section className="workspace-heading"><p className="eyebrow">YOUR DOCUMENT STUDIO</p><h1>A résumé for every opportunity.</h1><p>Keep your master résumé here. Open a job to tailor a résumé or cover letter, choose a template, edit, and approve a new version.</p><div className="profile-actions"><button className="button" onClick={onReplaceResume}>Upload résumé</button><button className="button secondary" onClick={onBrowse}>Tailor for a job</button></div></section>}
    {mode !== "ATTENTION" && <section className="profile-section document-history" id="documents"><h3>Documents</h3><p>Your current résumé and prior versions stay separate. Applications keep the exact version they used.</p>
      {documents.length === 0 ? <small>No documents yet.</small> : documents.map((document) => <div className="answer-row" key={document.id}><div>
        <b>{document.fileName ?? document.type.toLowerCase().replaceAll("_", " ")}</b>
        <span>Version {document.version} · {document.status.toLowerCase().replaceAll("_", " ")}{document.uses.length ? ` · used in ${document.uses.length} application ${document.uses.length === 1 ? "run" : "runs"}` : ""}</span>
        <small>{new Date(document.createdAt).toLocaleString("en-IN")}{document.sourceDocumentId ? " · generated from an earlier résumé" : ""}</small>
      </div><div>{document.isCurrentMaster && <span className="current-pill">Current master</span>}<button onClick={() => void download(document)}>Download / review</button>{document.status === "RECONCILING" && document.type !== "MASTER_RESUME" && <button onClick={async () => { if (!window.confirm("Have you reviewed this document? Approving makes it available to Copilot for its job.")) return; try { await api.approveDocument(document.id, idempotencyKey("approve-document")); await load(); } catch (reason) { setError(message(reason)); } }}>Approve reviewed draft</button>}</div></div>)}
    </section>}
    {mode === "PROFILE" && <>
    <div className="profile-sections">{Object.entries(sections).filter(([section]) => section !== "Experience").map(([section, answers]) => <section className="profile-section" key={section}>
      <h3>{section}</h3>{answers?.map((answer) => <div className="answer-row" key={answer.answerVersionId}><div><b>{answer.label}</b><span>{displayValue(answer.normalizedValue)}</span></div><small className={answer.freshness.state.toLowerCase()}>{answer.freshness.state === "FRESH" ? "Verified" : answer.freshness.state === "STALE" ? "Check again" : "Review"}</small></div>)}
    </section>)}</div>
    <div className="profile-actions">
      {!profile.onboardingCompleted && <button className="button" disabled={!readiness.ready} onClick={() => void complete()}>Finish onboarding</button>}
      {profile.onboardingCompleted && <><Notice kind="success">Your profile is ready for matching. You can edit it whenever something changes.</Notice><button className="button" onClick={onBrowse}>Browse matched jobs</button></>}
      <button className="button secondary" onClick={onReplaceResume}>Replace master resume</button>
      <button className="button secondary" onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Hide history" : "View change history"}</button>
    </div>
    {showHistory && <section className="history"><h2>Profile history</h2><p>Every save is versioned. Restore an older value without deleting what happened in between.</p>{history.map((entry) => <div className="history-row" key={entry.answerVersionId}><div><b>{entry.label}</b><span>{displayValue(entry.normalizedValue)}</span><small>{new Date(entry.createdAt).toLocaleString("en-IN")} · {entry.source.replaceAll("_", " ").toLowerCase()}</small></div>{entry.current ? <span className="current-pill">Current</span> : <button onClick={async () => {
        const current = profile.answers.find((answer) => answer.canonicalKey === entry.canonicalKey && answer.entityId === entry.entityId && answer.scopeType === entry.scopeType);
        try { await api.restore(entry.answerVersionId, current?.answerVersionId ?? null, idempotencyKey("profile-restore")); await load(); }
        catch (reason) { setError(message(reason)); }
      }}>Restore</button>}</div>)}</section>}
    <button className="text-button signout" onClick={onSignOut}>Sign out</button>
    </>}
  </div>;
}

export function App() {
  const [auth, setAuth] = useState<BrowserAuthSession | null>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [view, setView] = useState<View>("WELCOME");
  useEffect(() => {
    const navigate = () => { const route = window.location.hash.slice(1).toUpperCase(); if (["JOBS", "PROFILE", "DOCUMENTS", "ATTENTION", "WELCOME", "RESUME", "REVIEW", "OPERATOR"].includes(route)) setView(route as View); };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const [review, setReview] = useState<ResumeReview | null>(null);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copilotPrompt, setCopilotPrompt] = useState<CopilotPromptState | null>(null);
  const api = useMemo(() => new CandidateApi(() => auth?.accessToken ?? null), [auth]);
  const acceptAuth = useCallback((next: BrowserAuthSession) => setAuth(next), []);

  useEffect(() => {
    let current = true;
    void authClient.session().then((value) => current && setAuth(value)).catch((reason) => current && setError(message(reason))).finally(() => current && setBooting(false));
    const unsubscribe = authClient.subscribe((value) => current && setAuth(value));
    return () => { current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!auth) { setSession(null); return; }
    setBooting(true); setError(null);
    void api.bootstrap().then((next) => {
      setSession(next);
      const route = window.location.hash.slice(1).toUpperCase();
      setView(["PROFILE", "DOCUMENTS", "ATTENTION", "JOBS", "OPERATOR"].includes(route) ? route as View : next.onboarding.completed ? "JOBS" : next.onboarding.stage === "READY" ? "PROFILE" : next.onboarding.stage);
    }).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 401) setAuth(null);
      setError(message(reason));
    }).finally(() => setBooting(false));
  }, [api, auth]);

  useEffect(() => {
    if (!auth?.accessToken) return;
    let active = true;
    const connect = () => {
      if (active) void extensionBridge.connect(auth.accessToken).catch(() => undefined);
    };
    const onExtensionAvailable = (event: MessageEvent) => {
      if (event.source === window && event.origin === window.location.origin
        && isExtensionAvailableMessage(event.data)) connect();
    };
    connect();
    const retry = window.setTimeout(connect, 1_500);
    window.addEventListener("message", onExtensionAvailable);
    return () => {
      active = false;
      window.clearTimeout(retry);
      window.removeEventListener("message", onExtensionAvailable);
    };
  }, [auth?.accessToken]);

  const applyWithCopilot = useCallback(async (job: JobResult, extensionConsumedClick = false) => {
    if (!auth?.accessToken) return;
    setCopilotPrompt({ job, state: "CONNECTING", originPattern: null });
    if (extensionConsumedClick) {
      let launched = await extensionBridge.waitForClickLaunch();
      if (requiresSessionReconnect(launched.state)) {
        const connected = await extensionBridge.connect(auth.accessToken).catch(() => ({ state: "ERROR" as const, extensionVersion: null, errorCode: "CONNECTION_FAILED", originPattern: null }));
        if (connected.state === "READY") {
          launched = await extensionBridge.launch(job).catch(() => ({ state: "ERROR" as const, extensionVersion: null, errorCode: "LAUNCH_FAILED", originPattern: null }));
        } else {
          launched = connected;
        }
      }
      if (launched.state === "READY") setCopilotPrompt(null);
      else setCopilotPrompt({ job, state: launched.state, originPattern: launched.originPattern });
      return;
    }
    const connected = await extensionBridge.connect(auth.accessToken).catch(() => ({ state: "ERROR" as const, extensionVersion: null, errorCode: "CONNECTION_FAILED", originPattern: null }));
    if (connected.state !== "READY") { setCopilotPrompt({ job, state: connected.state, originPattern: connected.originPattern }); return; }
    const launched = await extensionBridge.launch(job).catch(() => ({ state: "ERROR" as const, extensionVersion: null, errorCode: "LAUNCH_FAILED", originPattern: null }));
    if (launched.state === "READY") setCopilotPrompt(null);
    else setCopilotPrompt({ job, state: launched.state, originPattern: launched.originPattern });
  }, [auth?.accessToken]);

  if (booting) return <div className="center-screen"><Brand /><Spinner label="Preparing your secure workspace" /></div>;
  if (!auth) return <SignIn onSession={acceptAuth} />;
  if (!session) return <div className="center-screen"><Brand />{error ? <Notice kind="error">{error}</Notice> : <Spinner />}</div>;
  return <div className={`app-shell ${session.onboarding.completed ? "workspace-shell" : "onboarding-shell"}`}>
{session.onboarding.completed && <aside className="workspace-sidebar"><Brand /><p className="eyebrow">WORKSPACE</p><nav aria-label="Candidate workspace">{([["JOBS", "J", "Jobs"], ["DOCUMENTS", "D", "Documents"], ["ATTENTION", "!", "Attention"], ["PROFILE", "P", "Profile"]] as const).map(([route, glyph, label]) => <a href={`#${route.toLowerCase()}`} key={route} className={view === route ? "active" : ""} aria-current={view === route ? "page" : undefined} onClick={() => setView(route)}><span className="nav-glyph" aria-hidden="true">{glyph}</span>{label}</a>)}</nav><div className="sidebar-note"><strong>Answer once. Apply with confidence.</strong><p>Your verified profile follows you. Declarations stay yours to decide.</p><a href="#admin">Admin workspace →</a></div><button className="sidebar-account" onClick={() => setView("PROFILE")}><span className="avatar">{session.email?.[0]?.toUpperCase() ?? "U"}</span><span>{session.email}</span></button></aside>}
    <header>{!session.onboarding.completed ? <Brand /> : <span className="workspace-context">Your career workspace</span>}<div className="header-user"><span>Review before submitting</span><span className="avatar">{session.email?.[0]?.toUpperCase() ?? "U"}</span></div></header>
    {!session.onboarding.completed && <Steps view={view} />}
    <main className="content">
      {view === "WELCOME" && <Welcome onResume={() => setView("RESUME")} onManual={() => setView("PROFILE")} />}
      {view === "RESUME" && <ResumeUpload api={api} onReview={(next) => { setReview(next); setView("REVIEW"); }} onManual={() => setView("PROFILE")} />}
      {view === "REVIEW" && (review ? <ReviewResume api={api} initial={review} onDone={(changeSetId) => { setLastChange(changeSetId); setView("PROFILE"); }} /> : <button className="button" onClick={async () => { try { setReview(await api.review()); } catch (reason) { setError(message(reason)); } }}>Load resume review</button>)}
      {(view === "PROFILE" || view === "DOCUMENTS" || view === "ATTENTION") && <ProfileView mode={view} onProfile={() => setView("PROFILE")} api={api} initialChangeSet={lastChange} onBrowse={() => setView("JOBS")} onReplaceResume={() => { setReview(null); setView("RESUME"); }} onCompleted={() => setSession((current) => current ? { ...current, onboarding: { ...current.onboarding, completed: true, stage: "READY" } } : current)} onSignOut={() => { void api.logout().catch(() => undefined).finally(() => authClient.signOut().finally(() => setAuth(null))); }} />}
      {view === "JOBS" && <JobsView api={api} onApply={(job, consumed) => void applyWithCopilot(job, consumed)} />}
      {view === "ATTENTION" && <LearningRecovery api={api} />}
      {view === "OPERATOR" && <OperatorReview api={api} />}
      {error && <Notice kind="error">{error}</Notice>}
    </main>
    {copilotPrompt && <CopilotPrompt prompt={copilotPrompt} onClose={() => setCopilotPrompt(null)} />}
    <footer><Brand /><span>Private career data · Candidate-controlled changes · Built for engineers in India</span></footer>
  </div>;
}
