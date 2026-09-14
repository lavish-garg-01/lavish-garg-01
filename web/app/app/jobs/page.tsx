"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell, Badge, Panel } from "../../components/app-shell";
import { useProduct } from "../../components/product-provider";
import type { MatchEvidenceSignal, ProductJob } from "../../lib/product-types";

type JobView = "MATCHES" | "SAVED";
type CopilotConnectionState = "NOT_INSTALLED" | "DISCONNECTED" | "CONNECTED" | "PERMISSION_REQUIRED" | "VERSION_INCOMPATIBLE" | "READY_TO_LAUNCH";

const PREFLIGHT_PREFERENCE_KEY = "job-hunter.application-preflight.hidden.v1";

function requestCopilotExtension(job: ProductJob) {
  return new Promise<{ state: CopilotConnectionState; launched?: boolean; error?: string; permissionOrigin?: string | null }>((resolve, reject) => {
    const messageId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("job-hunter-extension-response", onResponse as EventListener);
      reject(new Error("NOT_INSTALLED"));
    }, 1200);
    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.messageId !== messageId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("job-hunter-extension-response", onResponse as EventListener);
      resolve(detail);
    };
    window.addEventListener("job-hunter-extension-response", onResponse as EventListener);
    document.dispatchEvent(new CustomEvent("job-hunter-extension-request", {
      detail: {
        type: "JOB_HUNTER_LAUNCH_REQUEST",
        messageId,
        sentAtMs: Date.now(),
        protocolVersions: [1],
        jobId: job.id,
        targetUrl: job.url,
      },
    }));
  });
}

function CopilotLaunchForm({
  job,
  className,
  disabled,
  children,
  onUnavailable,
}: {
  job: ProductJob;
  className: string;
  disabled: boolean;
  children: ReactNode;
  onUnavailable: (state: CopilotConnectionState, message?: string) => void;
}) {
  const [launching, setLaunching] = useState(false);
  async function launch() {
    setLaunching(true);
    try {
      const response = await requestCopilotExtension(job);
      if (!response.launched) onUnavailable(response.state, response.error);
    } catch {
      onUnavailable("NOT_INSTALLED");
    } finally {
      setLaunching(false);
    }
  }
  return (
    <form
      method="post"
      action={`/jobs/${encodeURIComponent(job.id)}/open-with-extension`}
      className="copilot-launch-form"
      data-open-with-extension="true"
      data-protocol-bridge="true"
      data-job-url={job.url}
      onSubmit={(event) => event.preventDefault()}
    >
      <button type="button" className={className} disabled={disabled || launching} onClick={() => void launch()}>{launching ? "Connecting to Copilot…" : children}</button>
    </form>
  );
}

function fitLabel(fit: ProductJob["fit"]) {
  return fit === "STRONG_FIT" ? "Strong fit" : fit === "POSSIBLE_FIT" ? "Possible fit" : "Review carefully";
}

function dimensionLabel(value: string) {
  const labels: Record<string, string> = {
    role: "Role", skills: "Skills", experience: "Experience", location: "Location",
    workMode: "Work mode", compensation: "Compensation", employmentType: "Employment", seniority: "Seniority",
  };
  return labels[value] || value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function feedUpdatedLabel(value: string | null) {
  if (!value) return "Not built yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function evidenceValue(value: unknown) {
  if (value == null || value === "") return "Not provided";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter((item) => typeof item !== "object").map(String).join(" · ") || "Structured evidence";
  }
  return String(value);
}

function EvidenceRow({ signal, tone }: { signal: MatchEvidenceSignal; tone: "good" | "warn" | "neutral" }) {
  return (
    <li className={`evidence-row ${tone}`}>
      <span>{tone === "good" ? "✓" : tone === "warn" ? "△" : "?"}</span>
      <div><strong>{signal.label}</strong><small>{dimensionLabel(signal.dimension)} · Your evidence: {evidenceValue(signal.evidence.candidate)} · Job evidence: {evidenceValue(signal.evidence.job)}</small></div>
    </li>
  );
}

function MatchAudit({ job }: { job: ProductJob }) {
  const dimensions = job.whyThisJob.dimensions || [];
  const evidence = job.whyThisJob.evidence;
  return (
    <details className="why-disclosure match-audit">
      <summary>See match dimensions and evidence</summary>
      <p>This is a deterministic fit score, not a prediction or AI confidence. It can only use evidence present in your verified profile and the job posting.</p>
      {dimensions.length ? <div className="dimension-grid">{dimensions.map((item) => <div key={item.name}><span><strong>{dimensionLabel(item.name)}</strong><small>{item.status.replaceAll("_", " ").toLowerCase()}</small></span><b>{item.score}</b><i><em style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }} /></i></div>)}</div> : <p className="field-help">Detailed dimensions will appear after the backend rebuilds this job’s current match.</p>}
      {evidence ? <ul className="evidence-list">
        {evidence.reasons.slice(0, 3).map((item) => <EvidenceRow key={`reason-${item.code}`} signal={item} tone="good" />)}
        {evidence.gaps.slice(0, 2).map((item) => <EvidenceRow key={`gap-${item.code}`} signal={item} tone="warn" />)}
        {evidence.unknowns.slice(0, 2).map((item) => <EvidenceRow key={`unknown-${item.code}`} signal={item} tone="neutral" />)}
      </ul> : null}
      <p className="evidence-coverage">Evidence coverage: {Math.round((job.whyThisJob.evidenceCoverage || 0) * 100)}% · Missing evidence remains unknown and does not become a conflict.</p>
    </details>
  );
}

function LifecycleNotice({ job }: { job: ProductJob }) {
  if (job.actionability.status === "OPEN" && !job.personalState?.hasMaterialUpdate) return null;
  if (job.personalState?.hasMaterialUpdate) return <div className="job-state-notice updated">Updated since you last viewed this role</div>;
  if (job.actionability.status === "AGED_OUT") return <div className="job-state-notice aged">Older than your 14-day shortlist · still saved and reviewable</div>;
  return <div className="job-state-notice closed">{job.actionability.status === "EXPIRED" ? "Application deadline passed" : "Application closed"} · retained for your records</div>;
}

function JobCard({
  job,
  view,
  busy,
  onSave,
  onDismiss,
  onApply,
  launchDirectly,
  onCopilotUnavailable,
}: {
  job: ProductJob;
  view: JobView;
  busy: boolean;
  onSave: () => void;
  onDismiss: () => void;
  onApply: () => void;
  launchDirectly: boolean;
  onCopilotUnavailable: (state: CopilotConnectionState, message?: string) => void;
}) {
  return (
    <Panel className="full-job-card">
      <div id={job.id} className="job-anchor" />
      <div className="job-card-top">
        <span className="company-avatar large">{job.logo}</span>
        <div><p className="page-eyebrow">{job.company} · {job.source}</p><h2>{job.role}</h2><span>{job.location} · {job.salary}</span></div>
        <button className={`save-button ${job.saved ? "saved" : ""}`} aria-label={`${job.saved ? "Unsave" : "Save"} ${job.role}`} onClick={onSave}>{job.saved ? "★" : "☆"}</button>
      </div>
      <LifecycleNotice job={job} />
      <div className="match-explanation">
        <div className={`fit-orb ${job.fit.toLowerCase()}`}><strong>{fitLabel(job.fit)}</strong>{job.matchScore != null ? <small>{job.matchScore}% match</small> : null}</div>
        <div><strong>Why this job?</strong><ul className="fit-reasons">{(job.fitReasons || []).map((reason) => <li key={reason}>✓ {reason}</li>)}</ul>{job.gaps?.length ? <p className="potential-gap">△ {job.gaps.join(" · ")}</p> : <p>No hard conflicts found in available evidence.</p>}{job.unknowns?.length ? <p className="potential-gap">? Not stated: {job.unknowns.join(" · ")}</p> : null}</div>
      </div>
      <div className="skill-row">{(job.skills || []).map((skill) => <span key={skill}>{skill}</span>)}</div>
      <MatchAudit job={job} />
      <div className="job-card-footer">
        <p>{job.actionability.status === "AGED_OUT" ? "Saved beyond discovery window" : `Posted ${job.fresh} ago`} · {job.support?.label || "Copilot Assist"}</p>
        <div>
          {view === "MATCHES" ? <button className="button button-light" disabled={busy} onClick={onDismiss}>Not for me</button> : <button className="button button-light" disabled={busy} onClick={onSave}>Remove saved</button>}
          {launchDirectly && job.actionability.canApply ? <CopilotLaunchForm
            job={job}
            className="button button-dark"
            disabled={busy}
            onUnavailable={onCopilotUnavailable}
          >Apply with Copilot →</CopilotLaunchForm> : <button className="button button-dark" disabled={busy || !job.actionability.canApply} onClick={onApply}>{job.actionability.canApply ? "Apply with Copilot →" : job.actionability.status === "EXPIRED" ? "Deadline passed" : "Application closed"}</button>}
        </div>
      </div>
    </Panel>
  );
}

export default function JobsPage() {
  const { state, busy, refreshJobFeed, loadMoreJobs, saveJob, dismissJob, markJobSeen, startApplication, claimJobAvailability, reportJobAvailability } = useProduct();
  const [view, setView] = useState<JobView>("MATCHES");
  const [query, setQuery] = useState("");
  const [fit, setFit] = useState("ALL");
  const [selected, setSelected] = useState<ProductJob | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [availabilityPrompt, setAvailabilityPrompt] = useState<Awaited<ReturnType<typeof claimJobAvailability>>>(null);
  const [availabilityNote, setAvailabilityNote] = useState("");
  const [preflightHidden, setPreflightHidden] = useState(false);
  const [copilotIssue, setCopilotIssue] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreflightHidden(window.localStorage.getItem(PREFLIGHT_PREFERENCE_KEY) === "1");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>(".preflight-modal");
    dialog?.setAttribute("tabindex", "-1");
    dialog?.focus();
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [selected]);

  const jobs = useMemo(() => (view === "SAVED" ? state.savedJobs : state.jobs).filter((job) => {
    if (view === "MATCHES" && job.dismissed) return false;
    if (fit !== "ALL" && job.fit !== fit) return false;
    const haystack = `${job.company} ${job.role} ${job.location} ${job.skills.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [state.jobs, state.savedJobs, view, fit, query]);

  function openPreflight(job: ProductJob) {
    setPrepared(state.applications.some((application) => application.jobId === job.id));
    setAvailabilityPrompt(null);
    setAvailabilityNote("");
    setCopilotIssue("");
    setSelected(job);
    void markJobSeen(job.id).catch(() => {});
    if (job.actionability.canApply) {
      void claimJobAvailability(job.id).then(setAvailabilityPrompt).catch(() => {});
    }
  }

  async function prepare(job: ProductJob) {
    await startApplication(job);
    setPrepared(true);
  }

  function setPreflightPreference(hidden: boolean) {
    setPreflightHidden(hidden);
    if (hidden) window.localStorage.setItem(PREFLIGHT_PREFERENCE_KEY, "1");
    else window.localStorage.removeItem(PREFLIGHT_PREFERENCE_KEY);
  }

  function showCopilotConnectionHelp(job: ProductJob, connectionState: CopilotConnectionState = "NOT_INSTALLED", message?: string) {
    openPreflight(job);
    setCopilotIssue(message || (connectionState === "VERSION_INCOMPATIBLE"
      ? "This website and your Copilot extension use different protocol versions. Reload the latest unpacked extension, then refresh this page."
      : connectionState === "PERMISSION_REQUIRED"
        ? "Copilot is connected. Approve access to this employer’s exact site in the Copilot side panel to continue autofill."
        : "The Job Hunter Copilot extension was not detected. Load the unpacked extension, then refresh this page. Search, saving and tracking still work without it."));
  }

  async function answerAvailability(result: "OPEN" | "CLOSED" | "UNCERTAIN") {
    if (!selected || !availabilityPrompt) return;
    const availability = await reportJobAvailability(selected.id, { requestId: availabilityPrompt.requestId, result, evidenceCode: "NONE" });
    if (availability) setSelected((current) => current ? { ...current, availability } : current);
    setAvailabilityPrompt(null);
    setAvailabilityNote(result === "CLOSED" ? "Thanks. We’ll verify this before changing it for everyone."
      : result === "OPEN" ? "Thanks — availability has been refreshed for everyone." : "No problem. We’ll ask someone else later.");
  }

  const title = view === "SAVED" ? `${state.savedJobs.length} saved role${state.savedJobs.length === 1 ? "" : "s"}.`
    : state.onboarding.complete ? `${state.jobFeed.total || jobs.length} roles match your current search.` : "Complete your search setup first.";

  return (
    <AppShell active="/app/jobs" eyebrow="Job discovery" title={title} subtitle={view === "SAVED" ? "Saved roles stay here until you remove them—even after discovery age or closure." : "Hard requirements first, transparent reasons second, match score last."} actions={<><button className="button button-light" disabled={Boolean(busy) || state.runtime.mode !== "api" || view === "SAVED"} onClick={() => void refreshJobFeed()}>{busy === "Refreshing your matches" ? "Refreshing…" : "Refresh matches"}</button><a href="/app/profile#search" className="button button-light">Edit search policy</a></>}>
      {!state.onboarding.complete ? <div className="workspace-notice"><strong>Recommendations are paused.</strong><p>Finish target roles, career evidence, locations and work mode before trusting this shortlist.</p><a href="/app/onboarding">Continue onboarding →</a></div> : null}
      {state.runtime.mode === "local" ? <div className="workspace-notice sample"><strong>Sample shortlist · UI preview</strong><p>These roles and match labels are illustrative. Start the local API and run discovery to evaluate your own search policy.</p></div> : null}
      {state.runtime.mode === "api" && state.jobFeed.stale && view === "MATCHES" ? <div className="workspace-notice"><strong>Your shortlist has new inputs.</strong><p>Profile, resume, matching rules or job evidence changed after this version was built.</p><button className="button button-dark" disabled={Boolean(busy)} onClick={() => void refreshJobFeed()}>{busy === "Refreshing your matches" ? "Rebuilding shortlist…" : "Update shortlist"}</button></div> : null}

      <div className="job-view-tabs" aria-label="Job views"><button className={view === "MATCHES" ? "active" : ""} onClick={() => setView("MATCHES")}>For you <span>{state.jobFeed.total}</span></button><button className={view === "SAVED" ? "active" : ""} onClick={() => setView("SAVED")}>Saved <span>{state.savedJobs.length}</span></button></div>
      <div className="job-toolbar"><label className="search-box wide"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${view === "SAVED" ? "saved roles" : "within matches"}`} /></label><select aria-label="Fit filter" value={fit} onChange={(event) => setFit(event.target.value)}><option value="ALL">All fit levels</option><option value="STRONG_FIT">Strong fit</option><option value="POSSIBLE_FIT">Possible fit</option><option value="REVIEW_CAREFULLY">Review carefully</option></select><button onClick={() => { setFit("ALL"); setQuery(""); }}>Clear filters</button></div>
      <div className="filter-summary"><span>{state.profile.targetRoles.join(" / ") || "Target role not set"}</span><span>{state.profile.minimumSalary ? `₹${state.profile.minimumSalary} LPA+` : "No salary floor"}</span><span>{state.profile.preferredWorkModes.join(" or ") || "Any work mode"}</span><span>{view === "SAVED" ? "Saved until you remove" : "Hard requirements first"}</span>{preflightHidden ? <button className="preflight-restore" onClick={() => setPreflightPreference(false)}>Preflight hidden · Show again</button> : null}</div>

      <div className="jobs-layout"><div className="full-job-list">
        {jobs.length ? jobs.map((job) => <JobCard key={job.id} job={job} view={view} busy={Boolean(busy)} onSave={() => void saveJob(job.id)} onDismiss={() => void dismissJob(job.id)} onApply={() => openPreflight(job)} launchDirectly={preflightHidden} onCopilotUnavailable={(status, message) => showCopilotConnectionHelp(job, status, message)} />) : <Panel><div className="empty-state"><span>{view === "SAVED" ? "☆" : "⌕"}</span><strong>{view === "SAVED" ? "No saved roles yet." : "No roles match these filters."}</strong><p>{view === "SAVED" ? "Save a promising role from For you and it will remain here even if it ages out of discovery." : "Clear the local search, relax one boundary or run a fresh discovery from the backend."}</p>{view === "SAVED" ? <button className="button button-light" onClick={() => setView("MATCHES")}>Browse matches</button> : <button className="button button-light" onClick={() => { setFit("ALL"); setQuery(""); }}>Clear filters</button>}</div></Panel>}
        {view === "MATCHES" && state.jobFeed.hasMore && fit === "ALL" && !query ? <div className="feed-controls"><button className="button button-light" disabled={Boolean(busy)} onClick={() => void loadMoreJobs()}>{busy === "Loading more matches" ? "Loading…" : `Load more matches · ${state.jobs.length} of ${state.jobFeed.total}`}</button></div> : null}
      </div><aside className="jobs-aside"><Panel><p className="page-eyebrow">{view === "SAVED" ? "SAVED LIFECYCLE" : "WHY THESE ROLES"}</p><h3>{view === "SAVED" ? "History stays yours" : "Your active search policy"}</h3>{view === "SAVED" ? <p>Older roles remain saved. Confirmed closed roles keep their match evidence and application history, but Copilot will not start a new application.</p> : <dl><div><dt>Target</dt><dd>{state.profile.targetRoles.join(", ") || "Not set"}</dd></div><div><dt>Compensation</dt><dd>{state.profile.minimumSalary ? `₹${state.profile.minimumSalary} LPA minimum` : "Flexible"}</dd></div><div><dt>Location</dt><dd>{state.profile.preferredLocations.join(", ") || "Not set"}</dd></div><div><dt>Avoid</dt><dd>{[...state.profile.excludedSkills, ...state.profile.dealBreakers].join(", ") || "No exclusions"}</dd></div></dl>}<a href="/app/profile#search" className="inline-link">Edit preferences →</a></Panel><Panel><p className="page-eyebrow">SHORTLIST VERSION</p><h3>{state.jobFeed.stale ? "Update available" : "Current and ready"}</h3><p>Built {feedUpdatedLabel(state.jobFeed.builtAt)}{state.jobFeed.durationMs != null ? ` in ${state.jobFeed.durationMs} ms` : ""}. Reads use this complete version until a newer one is ready.</p></Panel><Panel className="pro-nudge"><Badge tone="pro">PRO</Badge><h3>Use AI where fit is ambiguous.</h3><p>Pro can interpret adjacent experience and role language. Hard filters and verified evidence still remain visible.</p><a href="/app/profile#plan">See Pro details →</a></Panel></aside></div>

      {selected ? <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
        <section className="preflight-modal" role="dialog" aria-modal="true" aria-labelledby="preflight-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" aria-label="Close" onClick={() => setSelected(null)}>×</button>
          <p className="page-eyebrow">APPLICATION PREFLIGHT · {selected.company}</p>
          <h2 id="preflight-title">Know what happens before opening the form.</h2>
          <p className="preflight-role">{selected.role} · {selected.location}</p>
          {!selected.actionability.canApply ? <div className="preflight-status blocked"><span>!</span><div><strong>{selected.actionability.status === "EXPIRED" ? "Application deadline passed" : "Employer listing closed"}</strong><p>{selected.actionability.reason} The saved role and any prior application history remain available.</p></div></div> : selected.applicationSchema?.available ? <div className="preflight-status recent"><span>↗</span><div><strong>{state.runtime.mode === "local" ? "Sample" : selected.applicationSchema.freshness === "FRESH" ? "Fresh" : "Recent"} application map available</strong><p>{state.runtime.mode === "local" ? "This sample shows how field-map preflight will look." : `Copilot observed ${selected.applicationSchema.fieldCount} fields, including ${selected.applicationSchema.requiredFieldCount} required fields.`} Questions may still change or branch.</p></div></div> : <div className="preflight-status"><span>◎</span><div><strong>No recent complete form map</strong><p>Copilot will inspect the application after you open it. It will pause on unknown, sensitive or conflicting fields.</p></div></div>}
          {availabilityPrompt ? <div className="availability-check"><p className="page-eyebrow">QUICK COMMUNITY CHECK</p><strong>{availabilityPrompt.question}</strong><p>If you have already checked the employer page, your answer helps everyone without exposing anything from your application.</p><div><button disabled={Boolean(busy)} onClick={() => void answerAvailability("OPEN")}>Yes, it’s open</button><button disabled={Boolean(busy)} onClick={() => void answerAvailability("CLOSED")}>It looks closed</button><button disabled={Boolean(busy)} onClick={() => void answerAvailability("UNCERTAIN")}>Haven’t checked</button></div></div> : availabilityNote ? <p className="availability-thanks">✓ {availabilityNote}</p> : null}
          <ol className="preflight-steps"><li><span>1</span><div><strong>Open employer form</strong><p>No action is submitted.</p></div></li><li><span>2</span><div><strong>Scan and fill verified fields</strong><p>Unknown questions are asked inline first.</p></div></li><li><span>3</span><div><strong>You review and submit</strong><p>Declarations are application-specific, never reusable memory, and remain direct actions in this build. Final submit is always yours.</p></div></li></ol>
          {copilotIssue ? <div className="copilot-connection-error" role="alert"><strong>Copilot extension not connected</strong><p>{copilotIssue}</p></div> : null}
          {prepared && selected.actionability.canApply ? <div className="prepared-actions">
            <Badge tone="good">READY TO OPEN</Badge>
            <CopilotLaunchForm job={selected} className="button button-primary" disabled={Boolean(busy)} onUnavailable={(status, message) => showCopilotConnectionHelp(selected, status, message)}>Open employer application ↗</CopilotLaunchForm>
            <a href="/app/applications" className="inline-link">View in tracker</a>
          </div> : <button className="button button-primary full-button" disabled={Boolean(busy) || !selected.actionability.canApply} onClick={() => void prepare(selected).catch(() => {})}>{!selected.actionability.canApply ? "This application is no longer actionable" : busy || "Prepare this application"}</button>}
          <label className="preflight-preference"><input type="checkbox" checked={preflightHidden} onChange={(event) => setPreflightPreference(event.target.checked)} /><span><strong>Don’t show this preflight again</strong><small>Apply will open Copilot directly on this device. You can restore this screen from the Jobs filters.</small></span></label>
          <p className="modal-footnote">On mobile, save this job and continue on desktop for extension autofill.</p>
        </section>
      </div> : null}
    </AppShell>
  );
}
