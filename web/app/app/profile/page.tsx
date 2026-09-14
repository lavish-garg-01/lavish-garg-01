"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, Badge, Panel, PanelHead } from "../../components/app-shell";
import { useProduct } from "../../components/product-provider";
import type { CandidateProfile } from "../../lib/product-types";
import { apiConfigured, apiRequest } from "../../lib/api-client";

function list(value: string) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
}

function draftFromProfile(profile: CandidateProfile) {
  return {
    name: profile.name,
    email: profile.email,
    phone: profile.phone,
    currentTitle: profile.currentTitle,
    currentCompany: profile.currentCompany,
    experience: profile.totalExperienceYears == null ? "" : String(profile.totalExperienceYears),
    roles: profile.targetRoles.join(", "),
    locations: profile.preferredLocations.join(", "),
    workModes: profile.preferredWorkModes.join(", "),
    minimumSalary: profile.minimumSalary == null ? "" : String(profile.minimumSalary),
    skills: profile.skills.join(", "),
    excludedSkills: profile.excludedSkills.join(", "),
    employmentTypes: profile.employmentTypes.join(", "),
    dealBreakers: profile.dealBreakers.join(", "),
    primaryCoreStacks: profile.primaryCoreStacks.join(", "),
    acceptableCoreStacks: profile.acceptableCoreStacks.join(", "),
    preferredSkills: profile.preferredSkills.join(", "),
    excludedCompanies: profile.excludedCompanies.join(", "),
    compensationConstraintMode: profile.compensationConstraintMode,
    locationConstraintMode: profile.locationConstraintMode,
    workModeConstraintMode: profile.workModeConstraintMode,
    employmentTypeConstraintMode: profile.employmentTypeConstraintMode,
    smallGapYears: String(profile.experienceTolerance.smallGapYears),
    maxPlausibleGapYears: String(profile.experienceTolerance.maxPlausibleGapYears),
    searchCountryCode: profile.searchCountryCode,
    workAuthorization: profile.workAuthorization || "UNKNOWN",
    sponsorshipNeed: profile.sponsorshipNeed,
    relocationPreference: profile.relocationPreference,
  };
}

type ProfileDraft = ReturnType<typeof draftFromProfile>;
type LearningItem = {
  id: string; canonicalKey: string; transitionKind: string; learningStateAfter: string;
};
type LearningChangeSet = {
  id: string; itemCount: number; createdAt: string; canUndo: boolean;
  summary: { learned?: number; transitions?: Record<string, number>; canonicalKeys?: string[] };
  items: LearningItem[];
  undo?: { summary?: { restored?: number; forgotten?: number; skippedNewerVersion?: number } } | null;
};
type AnswerVersion = {
  id: string; canonicalKey: string; scopeHash: string; scopeQualifiers: Record<string, string>;
  normalizedValue: Record<string, unknown>; status: string; learningState: string;
  originKind: string; createdAt: string;
};
type PendingReviewProposal = {
  id: string; canonicalKey: string; normalizedValue: Record<string, unknown>;
  scopeQualifiers: Record<string, string>; reasonCodes: string[];
};
type PendingReviewGroup = {
  applicationId: string; runId: string; createdAt: string; proposals: PendingReviewProposal[];
};

function answerLabel(key: string) {
  return key.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function answerValue(value: Record<string, unknown>) {
  if (value.kind === "MONEY") {
    const amount = Number(value.amountExact);
    return value.currency === "INR" && value.period === "YEAR" && Number.isFinite(amount)
      ? `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(amount / 100000)} LPA`
      : `${String(value.amountExact || "")} ${String(value.currency || "")}`.trim();
  }
  if (value.kind === "BOOLEAN") return value.value ? "Yes" : "No";
  if (["STRING", "URL", "RICH_TEXT", "INTEGER"].includes(String(value.kind))) return String(value.value ?? "");
  if (value.kind === "DURATION") return `${String(value.months || 0)} months`;
  if (value.kind === "ENUM") return String((value.value as { label?: string } | undefined)?.label || "Saved choice");
  if (value.kind === "MULTI_ENUM") return ((value.values as Array<{ label?: string }> | undefined) || [])
    .map((item) => item.label).filter(Boolean).join(", ");
  return "Saved answer";
}

function scopeLabel(scope: Record<string, string>) {
  const values = Object.entries(scope).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${value}`);
  return values.length ? values.join(" · ") : "Global default";
}

export default function ProfilePage() {
  const { state, busy, updateProfile, resetLocalWorkspace } = useProduct();
  const [edits, setEdits] = useState<Partial<ProfileDraft>>({});
  const [learningChanges, setLearningChanges] = useState<LearningChangeSet[]>([]);
  const [answerVersions, setAnswerVersions] = useState<AnswerVersion[]>([]);
  const [pendingReviews, setPendingReviews] = useState<PendingReviewGroup[]>([]);
  const [reviewSelection, setReviewSelection] = useState<Record<string, boolean>>({});
  const [learningBusy, setLearningBusy] = useState<string | null>(null);
  const [learningMessage, setLearningMessage] = useState("");
  const draft = { ...draftFromProfile(state.profile), ...edits };
  const setDraft = (next: ProfileDraft) => setEdits(next);

  const loadLearningHistory = useCallback(async () => {
    if (state.runtime.mode !== "api" || !apiConfigured()) return;
    try {
      const [changes, versions, pending] = await Promise.all([
        apiRequest<{ changeSets: LearningChangeSet[] }>("/candidate-truth/change-sets/history?limit=12"),
        apiRequest<{ versions: AnswerVersion[] }>("/candidate-truth/history"),
        apiRequest<{ groups: PendingReviewGroup[] }>("/candidate-truth/pending-review?limit=100"),
      ]);
      setLearningChanges(changes.changeSets);
      setAnswerVersions(versions.versions);
      setPendingReviews(pending.groups);
      setReviewSelection((current) => Object.fromEntries(pending.groups.flatMap((group) => group.proposals)
        .map((proposal) => [proposal.id, current[proposal.id] ?? true])));
    } catch (cause) {
      setLearningMessage(cause instanceof Error ? cause.message : "Could not load recent learned answers.");
    }
  }, [state.runtime.mode]);

  // This effect starts asynchronous API hydration; the callback does not update state synchronously.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadLearningHistory(); }, [loadLearningHistory]);

  async function undoChangeSet(changeSetId: string) {
    try {
      setLearningBusy(changeSetId);
      setLearningMessage("");
      const result = await apiRequest<{ reversal: { summary: { restored: number; forgotten: number; skippedNewerVersion: number } } }>(
        `/candidate-truth/change-sets/${encodeURIComponent(changeSetId)}/undo`,
        { method: "POST", headers: { "Idempotency-Key": `profile-undo:${crypto.randomUUID()}` }, body: JSON.stringify({}) },
      );
      const summary = result.reversal.summary;
      setLearningMessage(summary.skippedNewerVersion
        ? `Restored ${summary.restored + summary.forgotten} answer(s). ${summary.skippedNewerVersion} newer answer(s) were kept.`
        : "The learned answers were restored safely.");
      await loadLearningHistory();
    } catch (cause) {
      setLearningMessage(cause instanceof Error ? cause.message : "Could not undo those learned answers.");
    } finally { setLearningBusy(null); }
  }

  async function restoreVersion(version: AnswerVersion) {
    const active = answerVersions.find((candidate) => candidate.canonicalKey === version.canonicalKey
      && candidate.scopeHash === version.scopeHash && candidate.status === "ACTIVE");
    try {
      setLearningBusy(version.id);
      setLearningMessage("");
      await apiRequest(`/candidate-truth/versions/${encodeURIComponent(version.id)}/restore`, {
        method: "POST",
        headers: { "Idempotency-Key": `profile-restore:${crypto.randomUUID()}` },
        body: JSON.stringify({ expectedActiveVersionId: active?.id || null }),
      });
      setLearningMessage(`${answerLabel(version.canonicalKey)} was restored for this exact scope.`);
      await loadLearningHistory();
    } catch (cause) {
      setLearningMessage(cause instanceof Error ? cause.message : "Could not restore that answer.");
    } finally { setLearningBusy(null); }
  }

  async function resolveReviewGroup(group: PendingReviewGroup, saveSelected: boolean) {
    const proposalIds = group.proposals.filter((proposal) => reviewSelection[proposal.id]).map((proposal) => proposal.id);
    if (!proposalIds.length) {
      setLearningMessage("Select at least one answer change first.");
      return;
    }
    const operation = saveSelected ? "save" : "discard";
    try {
      setLearningBusy(`${group.runId}:${operation}`);
      setLearningMessage("");
      await apiRequest(`/candidate-truth/pending-review/${operation}`, {
        method: "POST",
        headers: saveSelected ? { "Idempotency-Key": `profile-review:${crypto.randomUUID()}` } : undefined,
        body: JSON.stringify({ proposalIds }),
      });
      setLearningMessage(saveSelected
        ? `${proposalIds.length} answer change${proposalIds.length === 1 ? " was" : "s were"} saved for the same context next time.`
        : `${proposalIds.length} answer change${proposalIds.length === 1 ? " was" : "s were"} kept application-only.`);
      await loadLearningHistory();
    } catch (cause) {
      setLearningMessage(cause instanceof Error ? cause.message : "Could not update those review items.");
    } finally { setLearningBusy(null); }
  }

  const restorableVersions = useMemo(() => answerVersions.filter((version) => version.status !== "ACTIVE"
    && version.learningState !== "REMOVED"
    && answerVersions.some((current) => current.canonicalKey === version.canonicalKey
      && current.scopeHash === version.scopeHash && current.status === "ACTIVE" && current.id !== version.id)).slice(0, 8),
  [answerVersions]);

  async function save() {
    await updateProfile({
      name: draft.name,
      email: draft.email,
      phone: draft.phone,
      currentTitle: draft.currentTitle,
      currentCompany: draft.currentCompany,
      totalExperienceYears: draft.experience ? Number(draft.experience) : null,
      targetRoles: list(draft.roles),
      preferredLocations: list(draft.locations),
      preferredWorkModes: list(draft.workModes),
      minimumSalary: draft.minimumSalary ? Number(draft.minimumSalary) : null,
      skills: list(draft.skills),
      excludedSkills: list(draft.excludedSkills),
      employmentTypes: list(draft.employmentTypes),
      dealBreakers: list(draft.dealBreakers),
      primaryCoreStacks: list(draft.primaryCoreStacks),
      acceptableCoreStacks: list(draft.acceptableCoreStacks),
      preferredSkills: list(draft.preferredSkills),
      excludedCompanies: list(draft.excludedCompanies),
      compensationConstraintMode: draft.compensationConstraintMode,
      locationConstraintMode: draft.locationConstraintMode,
      workModeConstraintMode: draft.workModeConstraintMode,
      employmentTypeConstraintMode: draft.employmentTypeConstraintMode,
      experienceTolerance: {
        smallGapYears: Number(draft.smallGapYears),
        maxPlausibleGapYears: Number(draft.maxPlausibleGapYears),
        allowNearbySeniority: true,
      },
      searchCountryCode: draft.searchCountryCode,
      workAuthorization: draft.workAuthorization,
      sponsorshipNeed: draft.sponsorshipNeed,
      relocationPreference: draft.relocationPreference,
    });
    setEdits({});
  }

  const initials = (state.profile.name || "Local candidate").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <AppShell active="/app/profile" eyebrow="Profile & settings" title="Your facts, search and application knowledge." subtitle="Career evidence and job intent are separate. Every change affects future recommendations or autofill." actions={<button className="button button-dark" disabled={Boolean(busy)} onClick={() => void save()}>{busy || "Save changes"}</button>}>
      <div className="settings-layout"><nav className="settings-nav"><a className="active" href="#career">Career profile</a><a href="#search">Search profile</a><a href="#matching-policy">Matching boundaries</a><a href="#knowledge">Application knowledge</a><a href="#learning-review">Review answer changes</a><a href="#learned-answers">Learned answers</a><a href="#plan">Plan & billing</a><a href="#connections">Connections</a><a href="#privacy">Privacy & local data</a></nav><div className="settings-content">
        <Panel id="career"><PanelHead eyebrow="Career profile" title="Verified professional facts" action={<Badge tone={state.resume?.status === "CONFIRMED" ? "good" : "warn"}>{state.resume?.status === "CONFIRMED" ? "RESUME VERIFIED" : "REVIEW NEEDED"}</Badge>} /><div className="profile-row"><span className="avatar large">{initials}</span><div><strong>{state.profile.name || "Candidate name not set"}</strong><p>{state.profile.email || "Email not set"}</p></div><a href="/app/documents" className="button button-light">Resume evidence</a></div><div className="form-grid"><label className="form-field"><span>Full name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="form-field"><span>Email</span><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label><label className="form-field"><span>Phone</span><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label><label className="form-field"><span>Total experience</span><div className="input-suffix"><input type="number" step="0.5" value={draft.experience} onChange={(event) => setDraft({ ...draft, experience: event.target.value })} /><span>years</span></div></label><label className="form-field"><span>Current title</span><input value={draft.currentTitle} onChange={(event) => setDraft({ ...draft, currentTitle: event.target.value })} /></label><label className="form-field"><span>Current company</span><input value={draft.currentCompany} onChange={(event) => setDraft({ ...draft, currentCompany: event.target.value })} /></label></div><label className="form-field"><span>Verified skills</span><textarea rows={3} value={draft.skills} onChange={(event) => setDraft({ ...draft, skills: event.target.value })} /></label></Panel>

        <Panel id="search"><PanelHead eyebrow="Search profile" title="What you want next" /><p className="panel-intro">Changing target roles does not rewrite your career history. It only changes what Copilot recommends.</p><label className="form-field"><span>Target roles</span><input value={draft.roles} onChange={(event) => setDraft({ ...draft, roles: event.target.value })} /></label><div className="form-grid"><label className="form-field"><span>Preferred locations</span><input value={draft.locations} onChange={(event) => setDraft({ ...draft, locations: event.target.value })} /></label><label className="form-field"><span>Work modes</span><input value={draft.workModes} onChange={(event) => setDraft({ ...draft, workModes: event.target.value })} /></label><label className="form-field"><span>Minimum compensation</span><div className="input-suffix"><input type="number" value={draft.minimumSalary} onChange={(event) => setDraft({ ...draft, minimumSalary: event.target.value })} /><span>LPA</span></div></label><label className="form-field"><span>Avoid technologies</span><input value={draft.excludedSkills} onChange={(event) => setDraft({ ...draft, excludedSkills: event.target.value })} /></label></div></Panel>

        <Panel id="matching-policy">
          <PanelHead eyebrow="Matching precision" title="Acceptable alternatives and hard boundaries" action={<Badge tone="good">PROFILE v{state.profile.searchProfileVersion}</Badge>} />
          <p className="panel-intro">Keep preferences soft when you still want relevant alternatives. Use hard only when applying would waste your time.</p>
          <div className="form-grid">
            <label className="form-field"><span>Primary stacks</span><input value={draft.primaryCoreStacks} onChange={(event) => setDraft({ ...draft, primaryCoreStacks: event.target.value })} placeholder="Node.js + PostgreSQL, Java + Spring" /><small>The stacks you most want to use.</small></label>
            <label className="form-field"><span>Also acceptable stacks</span><input value={draft.acceptableCoreStacks} onChange={(event) => setDraft({ ...draft, acceptableCoreStacks: event.target.value })} placeholder="Go + PostgreSQL, Python + Django" /><small>Valid alternatives—not missing skills.</small></label>
            <label className="form-field"><span>Skills you prefer</span><input value={draft.preferredSkills} onChange={(event) => setDraft({ ...draft, preferredSkills: event.target.value })} placeholder="Distributed systems, AWS, Kafka" /></label>
            <label className="form-field"><span>Companies to exclude</span><input value={draft.excludedCompanies} onChange={(event) => setDraft({ ...draft, excludedCompanies: event.target.value })} placeholder="Company names" /></label>
            <label className="form-field"><span>Employment types</span><input value={draft.employmentTypes} onChange={(event) => setDraft({ ...draft, employmentTypes: event.target.value })} placeholder="Full-time, Contract" /></label>
            <label className="form-field"><span>Deal-breakers</span><input value={draft.dealBreakers} onChange={(event) => setDraft({ ...draft, dealBreakers: event.target.value })} placeholder="No night shifts, No employment bond" /></label>
          </div>
          <div className="form-grid">
            <label className="form-field"><span>Minimum compensation</span><select value={draft.compensationConstraintMode} onChange={(event) => setDraft({ ...draft, compensationConstraintMode: event.target.value as ProfileDraft["compensationConstraintMode"] })}><option value="SOFT">Prefer it</option><option value="HARD">Must meet it</option></select></label>
            <label className="form-field"><span>Location</span><select value={draft.locationConstraintMode} onChange={(event) => setDraft({ ...draft, locationConstraintMode: event.target.value as ProfileDraft["locationConstraintMode"] })}><option value="SOFT">Prefer it</option><option value="HARD">Must match</option></select></label>
            <label className="form-field"><span>Work mode</span><select value={draft.workModeConstraintMode} onChange={(event) => setDraft({ ...draft, workModeConstraintMode: event.target.value as ProfileDraft["workModeConstraintMode"] })}><option value="SOFT">Prefer it</option><option value="HARD">Must match</option></select></label>
            <label className="form-field"><span>Employment type</span><select value={draft.employmentTypeConstraintMode} onChange={(event) => setDraft({ ...draft, employmentTypeConstraintMode: event.target.value as ProfileDraft["employmentTypeConstraintMode"] })}><option value="SOFT">Prefer it</option><option value="HARD">Must match</option></select></label>
          </div>
          <div className="form-grid">
            <label className="form-field"><span>Small experience gap</span><div className="input-suffix"><input type="number" min="0" max="10" step="0.5" value={draft.smallGapYears} onChange={(event) => setDraft({ ...draft, smallGapYears: event.target.value })} /><span>years</span></div></label>
            <label className="form-field"><span>Largest plausible gap</span><div className="input-suffix"><input type="number" min="0" max="15" step="0.5" value={draft.maxPlausibleGapYears} onChange={(event) => setDraft({ ...draft, maxPlausibleGapYears: event.target.value })} /><span>years</span></div></label>
            <label className="form-field"><span>Search market</span><input maxLength={2} value={draft.searchCountryCode} onChange={(event) => setDraft({ ...draft, searchCountryCode: event.target.value.toUpperCase() })} placeholder="IN" /></label>
            <label className="form-field"><span>Work authorization</span><select value={draft.workAuthorization} onChange={(event) => setDraft({ ...draft, workAuthorization: event.target.value })}><option value="UNKNOWN">Not specified</option><option value="AUTHORIZED_IN_MARKET">Authorized in market</option><option value="NOT_AUTHORIZED">Not authorized</option></select></label>
            <label className="form-field"><span>Sponsorship</span><select value={draft.sponsorshipNeed} onChange={(event) => setDraft({ ...draft, sponsorshipNeed: event.target.value as ProfileDraft["sponsorshipNeed"] })}><option value="UNKNOWN">Not specified</option><option value="REQUIRED">Required</option><option value="NOT_REQUIRED">Not required</option></select></label>
            <label className="form-field"><span>Relocation</span><select value={draft.relocationPreference} onChange={(event) => setDraft({ ...draft, relocationPreference: event.target.value as ProfileDraft["relocationPreference"] })}><option value="UNKNOWN">Not specified</option><option value="WILLING">Willing</option><option value="NOT_WILLING">Not willing</option></select></label>
          </div>
        </Panel>

        <Panel id="knowledge"><PanelHead eyebrow="Application knowledge" title={state.readiness.credible ? "Repeatable-field readiness" : "Profile foundation"} action={state.readiness.percent != null ? <strong className="readiness-score">{state.readiness.percent}%</strong> : <Badge tone="good">NO FAKE SCORE</Badge>} /><div className="knowledge-summary"><div className="readiness-ring"><strong>{state.readiness.percent == null ? "—" : state.readiness.percent}</strong><small>{state.readiness.percent == null ? "evidence building" : "% ready"}</small></div><div><h3>{state.readiness.label}</h3><p>{state.readiness.credible ? "Calculated from verified, non-expired candidate facts against recent repeatable fields." : "We show a percentage only after enough complete application schemas exist. Extension connectivity never affects it."}</p></div></div>{state.attention.gaps.length ? <div className="knowledge-gaps">{state.attention.gaps.map((gap) => <a key={gap.id} href="/app/attention"><span>↗</span><p><strong>{gap.label}</strong><small>Likely needed by {gap.affectedJobCount} recent application{gap.affectedJobCount === 1 ? "" : "s"}</small></p><b>Answer once →</b></a>)}</div> : <div className="mini-empty"><span>✓</span><p><strong>No predicted gaps.</strong><small>Copilot will ask inline when a real form needs something new.</small></p></div>}</Panel>

        <Panel id="learning-review">
          <PanelHead eyebrow="Needs your decision" title="Review answer changes" action={pendingReviews.length ? <Badge tone="warn">{pendingReviews.reduce((count, group) => count + group.proposals.length, 0)} TO REVIEW</Badge> : <Badge tone="good">CLEAR</Badge>} />
          <p className="panel-intro">Consequential or mutable answers are never promoted silently. Save only the changes you want Copilot to try again in the same context.</p>
          {pendingReviews.length ? <div className="learned-answer-list">{pendingReviews.map((group) => <div className="pending-review-group" key={`${group.applicationId}:${group.runId}`}>
            {group.proposals.map((proposal) => <label className="learned-answer-row selectable" key={proposal.id}>
              <input type="checkbox" checked={reviewSelection[proposal.id] !== false} onChange={(event) => setReviewSelection((current) => ({ ...current, [proposal.id]: event.target.checked }))} />
              <div><strong>{answerLabel(proposal.canonicalKey)} · {answerValue(proposal.normalizedValue)}</strong><small>{scopeLabel(proposal.scopeQualifiers)} · waiting for your approval</small></div>
            </label>)}
            <div className="pending-review-actions"><button className="button button-dark" disabled={Boolean(learningBusy)} onClick={() => void resolveReviewGroup(group, true)}>{learningBusy === `${group.runId}:save` ? "Saving…" : "Save selected for next time"}</button><button className="button button-light" disabled={Boolean(learningBusy)} onClick={() => void resolveReviewGroup(group, false)}>{learningBusy === `${group.runId}:discard` ? "Removing…" : "Keep application-only"}</button></div>
          </div>)}</div> : <div className="mini-empty"><span>✓</span><p><strong>No answer changes need review.</strong><small>Low-risk facts appear in history only after verified completion; abandoned applications teach nothing.</small></p></div>}
        </Panel>

        <Panel id="learned-answers">
          <PanelHead eyebrow="Your control" title="Answers learned for next time" action={<Badge tone="good">APPEND-ONLY HISTORY</Badge>} />
          <p className="panel-intro">Copilot keeps contextual answers separate—for example, Google Backend and Amazon Backend compensation. Undo never overwrites a newer choice.</p>
          {learningMessage ? <div className="workspace-notice sample" role="status"><strong>Learning history</strong><p>{learningMessage}</p></div> : null}
          {state.runtime.mode !== "api" ? <div className="mini-empty"><span>↗</span><p><strong>Start the local API to view learning history.</strong><small>Your browser-only preview does not create reusable candidate-answer versions.</small></p></div> : learningChanges.length ? <div className="learned-answer-list">
            {learningChanges.map((change) => <div className="learned-answer-row" key={change.id}>
              <div><strong>Updated {change.itemCount} answer{change.itemCount === 1 ? "" : "s"} for future applications</strong><small>{change.items.map((item) => answerLabel(item.canonicalKey)).join(" · ")} · {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(change.createdAt))}</small></div>
              {change.canUndo ? <button disabled={learningBusy === change.id} onClick={() => void undoChangeSet(change.id)}>{learningBusy === change.id ? "Restoring…" : "Undo"}</button> : <Badge tone="neutral">RESTORED</Badge>}
            </div>)}
          </div> : <div className="mini-empty"><span>✓</span><p><strong>No reusable answers changed yet.</strong><small>Nothing is shown here merely because Copilot observed a field.</small></p></div>}
          {restorableVersions.length ? <details className="answer-history-details"><summary>Restore an older answer</summary><div className="learned-answer-list">{restorableVersions.map((version) => <div className="learned-answer-row" key={version.id}><div><strong>{answerLabel(version.canonicalKey)} · {answerValue(version.normalizedValue)}</strong><small>{scopeLabel(version.scopeQualifiers)} · {version.learningState.toLowerCase()}</small></div><button disabled={learningBusy === version.id} onClick={() => void restoreVersion(version)}>{learningBusy === version.id ? "Restoring…" : "Restore"}</button></div>)}</div></details> : null}
        </Panel>

        <Panel id="plan" className="plan-panel"><PanelHead eyebrow="Plan & billing" title={state.plan.id === "PRO" ? "Pro plan" : "Free plan"} action={<Badge tone="pro">7-DAY PRO PASS {state.plan.trialStatus}</Badge>} /><div className="plan-state"><div><span className="mode-icon">✦</span><div><strong>Your trial starts on the first Pro action</strong><p>Setup and browsing do not consume trial days. No card is required, and there is no automatic charge.</p></div></div><Badge tone="good">NO AUTO-CHARGE</Badge></div><div className="plan-comparison three-plans"><div><p>FREE · CURRENT</p><h3>Your organised job search.</h3><ul><li>Transparent heuristic matching</li><li>Verified profile foundation</li><li>Mapped autofill and tracker</li><li>Schema-based preflight</li></ul><strong>₹0 forever</strong></div><div className="pro-plan"><p>WEEKLY PRO · LAUNCH</p><h3>For a focused sprint.</h3><ul><li>AI-assisted match interpretation</li><li>Tailored resume and cover letter</li><li>Grounded screening drafts</li><li>Full Copilot workflow</li></ul><strong>₹79 / week · <s>₹149</s></strong><span className="plan-action-note">Starts when you use a Pro tool</span></div><div className="pro-plan featured-plan"><p>MONTHLY PRO · BEST VALUE</p><h3>For consistent momentum.</h3><ul><li>Everything in Weekly</li><li>Role-specific resume versions</li><li>Application history</li><li>Follow-up workspace</li></ul><strong>₹249 / month · <s>₹499</s></strong><span className="plan-action-note">Billing connection comes next</span></div></div></Panel>

        <Panel id="connections"><PanelHead eyebrow="Connections" title="Browser Copilot" action={<Badge tone="warn">NOT VERIFIED</Badge>} /><div className="connection-row"><div className="browser-icon">◎</div><div><strong>Chrome extension</strong><p>Connect when you are ready to apply. Search and tracking work without it; submit always remains blocked.</p></div><details className="connection-guide"><summary>Connection guide</summary><ol><li>Start the local API.</li><li>Load the unpacked extension from this project.</li><li>Open an employer form from Jobs and review every field before submitting.</li></ol></details></div></Panel>

        <Panel id="privacy"><PanelHead eyebrow="Privacy & local data" title="Current storage mode" /><div className="storage-mode-card"><span className="status-dot" /><div><strong>{state.runtime.mode === "api" ? "Local API with SQLite" : "Browser-local prototype"}</strong><p>{state.runtime.message}. Supabase can later replace this adapter without changing the page contracts.</p></div></div><div className="setting-row"><div><strong>Reset local workspace</strong><p>Available only in browser-local mode. This clears this device&apos;s prototype data.</p></div><button className="danger-button" disabled={state.runtime.mode !== "local"} onClick={() => { if (window.confirm("Clear this browser's local Job Hunter workspace?")) resetLocalWorkspace(); }}>Reset local data</button></div></Panel>
      </div></div>
    </AppShell>
  );
}
