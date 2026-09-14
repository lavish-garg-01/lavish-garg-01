"use client";

import { useMemo, useState } from "react";
import { AppShell, Badge, Panel, PanelHead } from "../../components/app-shell";
import { useProduct } from "../../components/product-provider";

function badgeTone(stage: string): "neutral" | "good" | "warn" | "pro" | "bad" {
  if (stage === "Submitted") return "good";
  if (stage === "Needs you") return "warn";
  if (stage === "Recovery needed") return "bad";
  if (stage === "Ready to review") return "pro";
  return "neutral";
}

function displayDate(value?: string | null) {
  if (!value) return "Just now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function ApplicationsPage() {
  const { state } = useProduct();
  const [filter, setFilter] = useState("ALL");
  const applications = useMemo(() => state.applications.filter((application) => {
    if (filter === "ALL") return true;
    if (filter === "ACTIVE") return application.stage !== "Submitted" && application.stage !== "Recovery needed";
    return application.stage === "Submitted";
  }), [state.applications, filter]);
  const counts = {
    preparing: state.applications.filter((item) => ["Preparing", "Ready to open", "Ready to review"].includes(item.stage)).length,
    needsYou: state.applications.filter((item) => item.stage === "Needs you").length,
    submitted: state.applications.filter((item) => item.stage === "Submitted").length,
    recovery: state.applications.filter((item) => item.stage === "Recovery needed").length,
  };

  return (
    <AppShell active="/app/applications" eyebrow="Application tracker" title="Keep every application accountable." subtitle="Prepared, paused, submitted and recovery activity in one timeline." actions={<a href="/app/jobs" className="button button-dark">Find roles</a>}>
      <div className="pipeline-summary"><div><span>{counts.preparing}</span><small>Preparing</small></div><i /><div><span>{counts.needsYou}</span><small>Needs you</small></div><i /><div><span>{counts.submitted}</span><small>Submitted</small></div><i /><div><span>{counts.recovery}</span><small>Recovery</small></div></div>
      {state.runtime.mode === "local" ? <div className="workspace-notice sample"><strong>Local tracker preview</strong><p>Applications prepared from the sample shortlist stay only in this browser.</p></div> : null}
      <Panel><PanelHead eyebrow="All activity" title="Applications" action={<div className="segmented"><button className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}>All</button><button className={filter === "ACTIVE" ? "active" : ""} onClick={() => setFilter("ACTIVE")}>Active</button><button className={filter === "SUBMITTED" ? "active" : ""} onClick={() => setFilter("SUBMITTED")}>Submitted</button></div>} />{applications.length ? <div className="application-table"><div className="application-row table-head"><span>Company & role</span><span>Stage</span><span>Last activity</span><span>Next action</span><span /></div>{applications.map((item) => <div className={`application-row ${item.actionability?.canApply === false ? "job-unavailable" : ""}`} key={item.id}><span><strong>{item.company}</strong><small>{item.role}{item.actionability?.canApply === false ? ` · ${item.actionability.status === "EXPIRED" ? "Deadline passed" : "Listing closed"}` : ""}</small></span><span><Badge tone={item.actionability?.canApply === false && item.stage !== "Submitted" ? "bad" : badgeTone(item.stage)}>{item.actionability?.canApply === false && item.stage !== "Submitted" ? "History only" : item.stage}</Badge></span><span>{displayDate(item.updatedAt || item.startedAt)}</span><span>{item.nextAction}</span><span>{item.url && item.stage !== "Submitted" && item.actionability?.canApply !== false ? <a aria-label={`Continue ${item.company} application`} href={item.url} target="_blank" rel="noreferrer">↗</a> : <a aria-label={`Review ${item.company} in Jobs`} href="/app/jobs">→</a>}</span></div>)}</div> : <div className="empty-state"><span>↗</span><strong>{state.applications.length ? "No applications in this view." : "Your first application will appear here."}</strong><p>Copilot records preparation and submission state without claiming an application was sent until you or the employer confirms it.</p><a href="/app/jobs" className="button button-light">Review strong-fit jobs</a></div>}</Panel>
      <div className="app-grid-two even"><Panel><PanelHead eyebrow="Control" title="Submission evidence" /><div className="principle-list"><div><span>1</span><p><strong>Prepared is not submitted</strong><small>Opening or filling a form never becomes a submitted event.</small></p></div><div><span>2</span><p><strong>Confirmation is explicit</strong><small>An employer confirmation page or your verification closes the loop.</small></p></div><div><span>3</span><p><strong>Recovery stays visible</strong><small>Login, CAPTCHA, changed forms and abandoned tabs return here.</small></p></div></div></Panel><Panel><PanelHead eyebrow="This search" title="Conversion snapshot" /><div className="conversion-bars"><div><span><strong>{state.applications.length}</strong> started</span><i><b style={{ width: state.applications.length ? "100%" : "0%" }} /></i></div><div><span><strong>{counts.submitted}</strong> submitted</span><i><b style={{ width: state.applications.length ? `${Math.round((counts.submitted / state.applications.length) * 100)}%` : "0%" }} /></i></div></div><p className="field-help">A small sample is directional, not a performance score.</p></Panel></div>
    </AppShell>
  );
}
