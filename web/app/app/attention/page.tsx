"use client";

import { useState } from "react";
import { AppShell, Badge, Panel, PanelHead } from "../../components/app-shell";
import { useProduct } from "../../components/product-provider";

function inputMeta(key: string) {
  if (key === "CURRENT_CTC" || key === "EXPECTED_CTC") return { type: "number", suffix: "LPA", placeholder: "e.g. 18" };
  if (key === "NOTICE_PERIOD") return { type: "number", suffix: "days", placeholder: "e.g. 60" };
  return { type: "text", suffix: "", placeholder: "Enter your answer" };
}

export default function AttentionPage() {
  const { state, busy, resolveGap } = useProduct();
  const [values, setValues] = useState<Record<string, string>>({});
  const blockers = state.attention.blockers;
  const gaps = state.attention.gaps;
  const blockerApplicationIds = new Set(blockers.map((item) => item.applicationId));
  const recovery = state.applications.filter((application) =>
    (application.stage === "Recovery needed" || application.status === "LOGIN_REQUIRED" || application.status === "CAPTCHA_REQUIRED")
    && !blockerApplicationIds.has(application.id));
  const total = blockers.length + gaps.length + recovery.length;

  return (
    <AppShell active="/app/attention" eyebrow="Human review queue" title={total ? `${total} item${total === 1 ? "" : "s"} can use your attention.` : "Nothing needs you right now."} subtitle="Current application blockers first. Recent form predictions remain optional." actions={<Badge tone={total ? "warn" : "good"}>{total ? `${total} OPEN` : "CLEAR"}</Badge>}>
      {blockers.length ? <section className="attention-section"><div className="attention-section-head"><div><p className="page-eyebrow">1 · CONTINUE APPLICATIONS</p><h2>Actual forms that paused</h2><p>These fields were observed in applications you opened. They outrank predictions.</p></div><Badge tone="warn">{blockers.length} blocking</Badge></div><div className="attention-card-grid">{blockers.map((item) => { const application = state.applications.find((candidate) => candidate.id === item.applicationId); return <Panel key={item.id} className="attention-action-card blocker-card"><div className="review-card-head"><span className="company-avatar">{(item.company || "C")[0]}</span><div><p className="page-eyebrow">{item.company} · {item.role}</p><h3>{item.title}</h3></div><Badge tone="warn">Paused</Badge></div><p className="attention-reason">{item.reason}</p><div className="scope-note"><span>◉</span><p>Only this candidate&apos;s application state is shown. Another user&apos;s answer is never copied.</p></div>{application?.url ? <a href={application.url} target="_blank" rel="noreferrer" className="button button-dark">Reopen employer form ↗</a> : <a href="/app/applications" className="button button-dark">Open tracker →</a>}</Panel>; })}</div></section> : null}

      {gaps.length ? <section className="attention-section"><div className="attention-section-head"><div><p className="page-eyebrow">2 · ANSWER ONCE, REUSE</p><h2>Prepare for likely repeat questions</h2><p>Built from de-identified field structure in complete applications observed within seven days—not from anyone else&apos;s answers.</p></div><Badge>{gaps.length} optional</Badge></div><div className="gap-card-list">{gaps.map((gap) => {
        const meta = inputMeta(gap.canonicalFieldKey);
        const examples = gap.affectedJobs.slice(0, 2).map((job) => job.company).join(" and ");
        return <Panel key={gap.id} className="schema-gap-card"><div className="gap-impact"><strong>{gap.affectedJobCount}</strong><span>recent<br />role{gap.affectedJobCount === 1 ? "" : "s"}</span></div><div className="gap-copy"><div><p className="page-eyebrow">{gap.freshness === "RECENT" ? "OBSERVED 3–7 DAYS AGO · LIKELY" : "OBSERVED UNDER 3 DAYS · FRESH"}</p><h3>{gap.label}</h3></div><p>Likely requested by {examples || `${gap.affectedJobCount} shortlisted role${gap.affectedJobCount === 1 ? "" : "s"}`}{gap.affectedJobCount > 2 ? ` and ${gap.affectedJobCount - 2} other${gap.affectedJobCount - 2 === 1 ? "" : "s"}` : ""}. Forms can still change or branch.</p><div className="reuse-scope"><span>↻</span><small>Saved to your candidate knowledge and reused only when the canonical meaning matches.</small></div></div><form className="gap-answer" onSubmit={(event) => { event.preventDefault(); void resolveGap(gap.canonicalFieldKey, values[gap.canonicalFieldKey] || ""); }}><label><span>Your answer</span><div className="input-suffix"><input type={meta.type} value={values[gap.canonicalFieldKey] || ""} onChange={(event) => setValues({ ...values, [gap.canonicalFieldKey]: event.target.value })} placeholder={meta.placeholder} />{meta.suffix ? <span>{meta.suffix}</span> : null}</div></label><button className="button button-dark" disabled={Boolean(busy)}>{busy || "Save once"}</button></form></Panel>;
      })}</div></section> : null}

      {recovery.length ? <section className="attention-section"><div className="attention-section-head"><div><p className="page-eyebrow">3 · REVIEW & RECOVERY</p><h2>Sessions that need reopening</h2><p>Login, CAPTCHA and changed portal states remain manual and recoverable.</p></div></div><div className="attention-card-grid">{recovery.map((item) => <Panel key={item.id} className="attention-action-card"><Badge tone="bad">{item.status.replaceAll("_", " ")}</Badge><h3>{item.company} · {item.role}</h3><p>{item.nextAction}</p>{item.url ? <a className="button button-light" href={item.url} target="_blank" rel="noreferrer">Reopen employer form ↗</a> : <a className="button button-light" href="/app/applications">Open tracker</a>}</Panel>)}</div></section> : null}

      {!total ? <Panel><div className="empty-state attention-empty"><span>✓</span><strong>Copilot paused nowhere.</strong><p>There are no unfinished form decisions and no recent application-schema gaps worth asking pre-emptively.</p><a href="/app/jobs" className="button button-dark">Browse jobs</a></div></Panel> : null}

      <Panel className="attention-explainer"><PanelHead eyebrow="How this stays fast" title="Recent schema read model" /><div className="explainer-flow"><div><span>1</span><p><strong>A user completes an application</strong><small>Only field structure is aggregated.</small></p></div><i>→</i><div><span>2</span><p><strong>A 3–7 day form map is cached</strong><small>Raw observations stay off the hot path.</small></p></div><i>→</i><div><span>3</span><p><strong>One gap covers many jobs</strong><small>One answer resolves every dependent prediction.</small></p></div></div></Panel>
    </AppShell>
  );
}
