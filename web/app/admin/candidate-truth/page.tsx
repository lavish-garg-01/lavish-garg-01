"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPanel, AdminPanelHead, AdminShell } from "../../components/admin-shell";
import { apiRequest } from "../../lib/api-client";

type Count = { count: number; answerKind?: string; status?: string };
type Policy = {
  canonicalKey: string; policyVersion: number; answerKind: string; valueType: string;
  scopePolicy: string; requiredScopeDimensions: string[]; reusePolicy: string;
  learningMode: string; learningPresentation: string; autofillMode: string;
  freshnessProfile: string | null; riskTier: string; reasonCode: string;
};
type PolicyMismatch = { canonicalKey: string; legacyDecision: string; phase2Decision: string; reasonCodes: string[] };
type MigrationSummary = {
  id: string | null; migrationVersion: number; status: string; sourceCount: number;
  eligible: number; migrated: number; skipped: number; conflict: number; alreadyPresent: number; invalid: number;
  reasonCounts: Array<{ reasonCode: string; count: number }>;
  productionCutover: boolean; idempotentReplay: boolean; completedAt: string | null;
};
type ResolverDiagnostics = {
  config: {
    mode: "LEGACY_ONLY" | "SHADOW_COMPARE" | "CANARY" | "VERSIONED_PRIMARY";
    canaryPercent: number; gatePassed: boolean; reasonCodes: string[];
  };
  runtime: {
    windowDays: number; compared: number; matched: number; agreed: number; agreementRate: number;
    valueMatchRate: number; valueMismatches: number; versionedOnly: number; legacyOnly: number;
    versionedSelected: number; unsafeVersionedSelected: number;
    outcomes: Array<{ outcome: string; count: number }>;
  };
  gates: {
    canary: { passed: boolean; reasonCodes: string[] };
    versionedPrimary: { passed: boolean; reasonCodes: string[] };
  };
  productionMutationEnabled: boolean;
};
type Diagnostics = {
  policies: {
    canonicalCount: number; policyCount: number; missingPolicies: unknown[];
    byKind: Count[];
  };
  policyRows: Policy[];
  contexts: {
    dimensions: Array<{ dimension: string; count: number }>;
    employerGroups: number; employerEntities: number;
  };
  truth: { byStatus: Count[]; activeByKind: Count[]; dependencyEvents: number; learningStates: Array<{ learningState: string; count: number }> };
  migration: { migrationVersion: number; runCount: number; latest: MigrationSummary | null };
  parity: { enabled: boolean; productionMutationEnabled: boolean; compared: number; matched: number; mismatches: PolicyMismatch[] };
  resolver: ResolverDiagnostics;
  changeSets: {
    changeSets: number; learnedItems: number;
    byPresentation: Array<{ presentationMode: string; count: number }>;
    byCheckpoint: Array<{ checkpointKind: string; count: number }>;
  };
  changeSetFlag: { enabled: boolean; payload?: { mode?: string; reasonCodes?: string[] } };
  reversals: { operations: number; items: number; byOutcome: Array<{ outcome: string; count: number }> };
  scopedLearning: { version: number; policies: Array<{ canonicalKey: string; overrideScope: string[] }>; confidenceScoring: boolean; historicalScanning: boolean };
  featureFlag: { enabled: boolean };
};

const empty: Diagnostics = {
  policies: { canonicalCount: 0, policyCount: 0, missingPolicies: [], byKind: [] },
  policyRows: [], contexts: { dimensions: [], employerGroups: 0, employerEntities: 0 },
  truth: { byStatus: [], activeByKind: [], dependencyEvents: 0, learningStates: [] },
  migration: { migrationVersion: 1, runCount: 0, latest: null },
  parity: { enabled: false, productionMutationEnabled: false, compared: 0, matched: 0, mismatches: [] },
  resolver: {
    config: { mode: "SHADOW_COMPARE", canaryPercent: 0, gatePassed: false, reasonCodes: ["SAFE_SHADOW_DEFAULT"] },
    runtime: { windowDays: 14, compared: 0, matched: 0, agreed: 0, agreementRate: 0, valueMatchRate: 0,
      valueMismatches: 0, versionedOnly: 0, legacyOnly: 0, versionedSelected: 0, unsafeVersionedSelected: 0, outcomes: [] },
    gates: { canary: { passed: false, reasonCodes: [] }, versionedPrimary: { passed: false, reasonCodes: [] } },
    productionMutationEnabled: false,
  },
  changeSets: { changeSets: 0, learnedItems: 0, byPresentation: [], byCheckpoint: [] },
  changeSetFlag: { enabled: false },
  reversals: { operations: 0, items: 0, byOutcome: [] },
  scopedLearning: { version: 1, policies: [], confidenceScoring: false, historicalScanning: false },
  featureFlag: { enabled: false },
};

export default function CandidateTruthPolicies() {
  const [data, setData] = useState<Diagnostics>(empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [migrationPreview, setMigrationPreview] = useState<MigrationSummary | null>(null);
  const load = useCallback(async () => {
    try {
      setError("");
      setData(await apiRequest<Diagnostics>("/admin/candidate-answer-policies"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load candidate-answer policies.");
    }
  }, []);
  useEffect(() => {
    let active = true;
    apiRequest<Diagnostics>("/admin/candidate-answer-policies")
      .then((payload) => { if (active) { setData(payload); setError(""); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load candidate-answer policies."); });
    return () => { active = false; };
  }, []);

  async function setResolverMode(mode: ResolverDiagnostics["config"]["mode"]) {
    try {
      setBusy(true);
      setError("");
      await apiRequest("/admin/candidate-answer-policies/resolver-mode", {
        method: "PUT", body: JSON.stringify({ mode, ...(mode === "CANARY" ? { canaryPercent: 1 } : {}) }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update parity diagnostics.");
    } finally { setBusy(false); }
  }

  async function runLegacyMigration(previewOnly: boolean) {
    try {
      setBusy(true);
      setError("");
      const result = await apiRequest<{ migration: MigrationSummary }>(
        `/admin/candidate-answer-policies/legacy-migration/${previewOnly ? "preview" : "apply"}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setMigrationPreview(previewOnly ? result.migration : null);
      if (!previewOnly) await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run safe legacy migration.");
    } finally { setBusy(false); }
  }

  async function toggleChangeSets() {
    try {
      setBusy(true);
      setError("");
      await apiRequest("/admin/candidate-answer-policies/change-sets", {
        method: "PUT", body: JSON.stringify({ enabled: !data.changeSetFlag.enabled }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update automatic learning change sets.");
    } finally { setBusy(false); }
  }

  const activeTruth = data.truth.byStatus.find((item) => item.status === "ACTIVE")?.count || 0;
  const filteredPolicies = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? data.policyRows.filter((policy) => [policy.canonicalKey, policy.answerKind, policy.scopePolicy,
      policy.reusePolicy, policy.riskTier].some((value) => value.toLowerCase().includes(query))) : data.policyRows;
  }, [data.policyRows, filter]);
  const migration = migrationPreview || data.migration.latest;

  return <AdminShell live active="/admin/candidate-truth" title="Candidate-answer policy"
    subtitle="Versioned, scoped rules for what may be remembered and reused—without exposing candidate values."
    actions={<button className="admin-button" onClick={() => void load()}>Refresh diagnostics</button>}>
    {error ? <div className="admin-alert" role="alert"><span>!</span><div><strong>Diagnostics unavailable</strong><p>{error}</p></div><button onClick={() => void load()}>Retry</button></div> : null}

    <div className="admin-metrics compact">
      <article className={data.policies.missingPolicies.length ? "" : "critical-metric"}><p>Canonical coverage</p><strong>{data.policies.policyCount}/{data.policies.canonicalCount}</strong><small>{data.policies.missingPolicies.length ? `${data.policies.missingPolicies.length} missing policies` : "Every active canonical is governed"}</small></article>
      <article><p>Active truth versions</p><strong>{activeTruth}</strong><small>Candidate-private · values hidden here</small></article>
      <article><p>Controlled contexts</p><strong>{data.contexts.dimensions.reduce((sum, item) => sum + item.count, 0)}</strong><small>{data.contexts.employerGroups} employer groups · {data.contexts.employerEntities} exact entities</small></article>
      <article><p>Dependency invalidations</p><strong>{data.truth.dependencyEvents}</strong><small>Append-only, reason-coded events</small></article>
    </div>

    <AdminPanel>
      <AdminPanelHead eyebrow="Part 2B · staged authority" title="Legacy-to-versioned runtime parity"
        action={<div className="truth-migration-actions">
          <button disabled={busy || data.resolver.config.mode === "LEGACY_ONLY"} onClick={() => void setResolverMode("LEGACY_ONLY")}>Legacy only</button>
          <button disabled={busy || data.resolver.config.mode === "SHADOW_COMPARE"} onClick={() => void setResolverMode("SHADOW_COMPARE")}>Shadow compare</button>
          <button disabled={busy || !data.resolver.gates.canary.passed || data.resolver.config.mode === "CANARY"} onClick={() => void setResolverMode("CANARY")}>1% canary</button>
        </div>} />
      <div className="truth-policy-banner">
        <div><span className={`health-light ${data.resolver.productionMutationEnabled ? "bad" : "good"}`} /><p><strong>{data.resolver.config.mode.replaceAll("_", " ")}</strong><small>{data.resolver.productionMutationEnabled ? "A release-gated versioned route is active." : "Legacy remains the only production answer authority; comparisons are value-redacted."}</small></p></div>
        <div><strong>{Math.round(data.resolver.runtime.agreementRate * 100)}%</strong><small>{data.resolver.runtime.agreed}/{data.resolver.runtime.compared} runtime decisions agree</small></div>
        <div><strong>{data.resolver.runtime.valueMismatches}</strong><small>value mismatches in {data.resolver.runtime.windowDays} days</small></div>
      </div>
      <div className="truth-parity-list">
        <div><strong>{data.resolver.gates.canary.passed ? "Canary gate ready" : "Canary remains blocked"}</strong><span>At least 100 comparisons, 98% agreement and zero value mismatches</span><small>{data.resolver.gates.canary.reasonCodes.join(" · ").replaceAll("_", " ")}</small></div>
        <div><strong>Versioned primary remains blocked</strong><span>Requires verified browser acceptance and correction outcomes</span><small>{data.resolver.gates.versionedPrimary.reasonCodes.join(" · ").replaceAll("_", " ")}</small></div>
      </div>
      <p className="muted">Static policy audit: {data.parity.matched}/{data.parity.compared} decisions align; {data.parity.mismatches.length} refined policy differences remain visible below.</p>
      {data.parity.mismatches.length ? <div className="truth-parity-list">{data.parity.mismatches.slice(0, 8).map((item) => <div key={item.canonicalKey}><strong>{item.canonicalKey}</strong><span>{item.legacyDecision} → {item.phase2Decision}</span><small>{item.reasonCodes.join(" · ")}</small></div>)}</div> : null}
    </AdminPanel>

    <AdminPanel>
      <AdminPanelHead eyebrow="Part 2B · value-redacted" title="Safe legacy candidate-truth migration"
        action={<div className="truth-migration-actions"><button disabled={busy} onClick={() => void runLegacyMigration(true)}>Preview</button><button disabled={busy} onClick={() => void runLegacyMigration(false)}>Run safe migration</button></div>} />
      <div className="truth-policy-banner">
        <div><span className={`health-light ${migration?.productionCutover ? "bad" : "good"}`} /><p><strong>Production cutover is disabled</strong><small>Only unambiguous, policy-safe facts enter the append-only SHADOW store. Candidate values never appear here.</small></p></div>
        <div><strong>{migrationPreview ? migrationPreview.eligible : (migration?.migrated || 0)}</strong><small>{migrationPreview ? "eligible in preview" : "migrated"}</small></div>
        <div><strong>{(migration?.skipped || 0) + (migration?.conflict || 0) + (migration?.invalid || 0)}</strong><small>held for safety</small></div>
      </div>
      {migration ? <div className="truth-parity-list">
        <div><strong>{migration.status}</strong><span>{migration.sourceCount} legacy source values inspected</span><small>{migration.alreadyPresent} already present · run v{migration.migrationVersion}</small></div>
        {migration.reasonCounts.slice(0, 8).map((item) => <div key={item.reasonCode}><strong>{item.reasonCode.replaceAll("_", " ")}</strong><span>{item.count} decision{item.count === 1 ? "" : "s"}</span><small>Reason-coded without retaining the candidate value</small></div>)}
      </div> : <p className="muted">No migration has run yet. Preview performs no writes.</p>}
    </AdminPanel>

    <AdminPanel>
      <AdminPanelHead eyebrow="Part 2B · immutable ACID commit" title="Application learning change sets"
        action={<button className="admin-button" disabled={busy} onClick={() => void toggleChangeSets()}>{data.changeSetFlag.enabled ? "Disable automatic commits" : "Enable low-risk commits"}</button>} />
      <div className="truth-policy-banner">
        <div><span className={`health-light ${data.changeSetFlag.enabled ? "good" : "warn"}`} /><p><strong>{data.changeSetFlag.enabled ? "Low-risk checkpoint commits enabled" : "Automatic commits remain in shadow"}</strong><small>Only direct candidate input with a verified submission, exact canonical scope and eligible policy can become future Copilot memory.</small></p></div>
        <div><strong>{data.changeSets.changeSets}</strong><small>immutable change sets</small></div>
        <div><strong>{data.changeSets.learnedItems}</strong><small>answer versions learned</small></div>
      </div>
      <div className="truth-parity-list">
        <div><strong>One application checkpoint → one transaction</strong><span>Versions, dependency invalidation, items, idempotency receipt and outbox commit together</span><small>Abandoned, unknown, protected, stale or conflicting edits create no memory.</small></div>
        <div><strong>Submission is deliberately conservative</strong><span>Low-risk facts commit directly; configured contextual preferences start in REVIEW</span><small>Legal, protected, incomplete-scope and unconfigured consequential answers remain held.</small></div>
        <div><strong>{data.scopedLearning.policies.length} contextual policies · {data.reversals.operations} reversals</strong><span>Exact-scope REVIEW values trial-fill once, then promote only after unchanged verified reuse</span><small>Undo and Restore append compensating versions; newer answers always win.</small></div>
      </div>
    </AdminPanel>

    <AdminPanel>
      <AdminPanelHead eyebrow="Immutable versions · active pointer" title="Canonical answer policies"
        action={<label className="truth-policy-search"><span>Filter</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Canonical, kind, scope…" /></label>} />
      <div className="admin-data-table truth-policy-table">
        <div className="admin-data-row table-head"><span>Canonical</span><span>Answer kind</span><span>Scope</span><span>Reuse</span><span>Learning</span><span>Freshness</span><span>Risk</span></div>
        {filteredPolicies.map((policy) => <div className="admin-data-row" key={policy.canonicalKey}>
          <span><strong>{policy.canonicalKey}</strong><small>Policy v{policy.policyVersion} · {policy.valueType}</small></span>
          <span>{policy.answerKind.replaceAll("_", " ")}</span>
          <span><strong>{policy.scopePolicy.replaceAll("_", " ")}</strong><small>{policy.requiredScopeDimensions.length ? `Requires ${policy.requiredScopeDimensions.join(", ")}` : "No required qualifier"}</small></span>
          <span>{policy.reusePolicy.replaceAll("_", " ")}</span>
          <span><strong>{policy.learningMode.replaceAll("_", " ")}</strong><small>{policy.learningPresentation.replaceAll("_", " ")}</small></span>
          <span>{policy.freshnessProfile || "No expiry"}</span>
          <span><b className={`state-tag ${policy.riskTier === "PROHIBITED" ? "failed" : policy.riskTier === "HIGH" ? "paused" : "healthy"}`}>{policy.riskTier}</b><small>{policy.reasonCode}</small></span>
        </div>)}
      </div>
    </AdminPanel>

    <div className="admin-grid-bottom">
      <AdminPanel><AdminPanelHead eyebrow="Exact registries" title="Context coverage" /><div className="truth-context-list">{data.contexts.dimensions.map((item) => <div key={item.dimension}><span>{item.dimension.replaceAll("_", " ")}</span><strong>{item.count}</strong></div>)}<div><span>EMPLOYER GROUPS</span><strong>{data.contexts.employerGroups}</strong></div><div><span>EMPLOYER ENTITIES</span><strong>{data.contexts.employerEntities}</strong></div></div></AdminPanel>
      <AdminPanel><AdminPanelHead eyebrow="Values intentionally omitted" title="Truth state by answer kind" /><div className="truth-context-list">{data.truth.activeByKind.map((item) => <div key={item.answerKind}><span>{String(item.answerKind).replaceAll("_", " ")}</span><strong>{item.count}</strong></div>)}</div></AdminPanel>
    </div>
  </AdminShell>;
}
