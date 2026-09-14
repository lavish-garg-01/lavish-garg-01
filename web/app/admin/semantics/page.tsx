"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminPanel, AdminPanelHead, AdminShell } from "../../components/admin-shell";
import { apiRequest } from "../../lib/api-client";

type Count = { status?: string; source?: string; count: number };
type Canonical = { key: string; label: string; description: string; status: string; semanticGroup: string };
type Mapping = {
  id: string; canonicalFieldKey: string; canonicalLabel: string; canonicalStatus: string;
  normalizedLabel: string; atsType: string; siteHost: string; source: string;
  confidence: number; evidenceScore: number; confirmedCount: number; correctedCount: number; status: string;
  aiModel?: string | null; promptVersion?: string | null; adaptiveState?: string | null;
  adaptivePositive?: number; adaptiveNegative?: number; adaptiveRuns?: number;
  adaptiveCandidates?: number; adaptiveVolatile?: number;
  suggestedCanonicalFieldKey?: string | null;
};
type FeatureFlag = { key: string; enabled: boolean };
type SemanticDiagnostics = {
  mappingsByStatus: Count[]; mappingsBySource: Count[]; canonicalsByStatus: Count[];
  proposedCanonicals: Canonical[]; canonicalReviewQueue: Canonical[]; reviewQueue: Mapping[];
  featureFlags: FeatureFlag[];
  cache?: { entries: number; embeddingHits: number; decisionHits: number; activeDecisionEntries: number };
};

const empty: SemanticDiagnostics = {
  mappingsByStatus: [], mappingsBySource: [], canonicalsByStatus: [], proposedCanonicals: [], canonicalReviewQueue: [], reviewQueue: [], featureFlags: []
};

export default function AdminSemantics() {
  const [data, setData] = useState<SemanticDiagnostics>(empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const load = useCallback(async () => {
    try { setError(""); setData(await apiRequest<SemanticDiagnostics>("/admin/field-semantics")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load field semantics."); }
  }, []);
  useEffect(() => {
    let active = true;
    apiRequest<SemanticDiagnostics>("/admin/field-semantics")
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load field semantics."); });
    return () => { active = false; };
  }, []);

  async function canonicalStatus(key: string, status: "VALIDATED" | "TRUSTED" | "REJECTED") {
    try {
      setBusy(`canonical:${key}`); setError("");
      await apiRequest(`/admin/field-semantics/canonicals/${encodeURIComponent(key)}/status`, {
        method: "PUT", body: JSON.stringify({ status })
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Canonical update failed."); }
    finally { setBusy(""); }
  }

  async function mappingStatus(id: string, status: "CANDIDATE" | "VALIDATED" | "TRUSTED" | "QUARANTINED" | "REJECTED") {
    try {
      setBusy(`mapping:${id}`); setError("");
      await apiRequest(`/admin/field-semantics/mappings/${encodeURIComponent(id)}/status`, {
        method: "PUT", body: JSON.stringify({ status })
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mapping update failed."); }
    finally { setBusy(""); }
  }

  async function applyMappingSuggestion(id: string, canonicalFieldKey: string) {
    try {
      setBusy(`mapping:${id}`); setError("");
      await apiRequest(`/admin/field-semantics/mappings/${encodeURIComponent(id)}/canonical`, {
        method: "PUT", body: JSON.stringify({ canonicalFieldKey })
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Semantic remap failed."); }
    finally { setBusy(""); }
  }

  async function toggleFlag(key: FeatureFlag["key"], enabled: boolean) {
    try {
      setBusy(`flag:${key}`); setError("");
      await apiRequest("/admin/field-semantics/feature-flag", {
        method: "PUT", body: JSON.stringify({ key, enabled })
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Feature flag update failed."); }
    finally { setBusy(""); }
  }

  async function mergeCanonicals() {
    try {
      setBusy("merge"); setError("");
      await apiRequest("/admin/field-semantics/merge", {
        method: "POST", body: JSON.stringify({ sourceKey: mergeSource, targetKey: mergeTarget })
      });
      setMergeSource(""); setMergeTarget(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Canonical merge failed."); }
    finally { setBusy(""); }
  }

  const count = (rows: Count[], status: string) => Number(rows.find((row) => row.status === status)?.count || 0);
  return <AdminShell live active="/admin/semantics" title="Field semantics" subtitle="Review value-free canonical concepts and field mappings before they affect broader reuse."
    actions={<button className="admin-button" onClick={() => void load()}>Refresh registry</button>}>
    {error ? <div className="admin-alert"><span>!</span><div><strong>Semantic registry action failed</strong><p>{error}</p></div></div> : null}
    <div className="admin-metrics compact">
      <article><p>Trusted mappings</p><strong>{count(data.mappingsByStatus, "TRUSTED")}</strong><small>Eligible for global reuse</small></article>
      <article><p>Candidate mappings</p><strong>{count(data.mappingsByStatus, "CANDIDATE")}</strong><small>Require more evidence</small></article>
      <article><p>Quarantined</p><strong>{count(data.mappingsByStatus, "QUARANTINED")}</strong><small>Excluded immediately</small></article>
      <article><p>New concepts</p><strong>{data.proposedCanonicals.length}</strong><small>Never active automatically</small></article>
    </div>

    <AdminPanel>
      <AdminPanelHead eyebrow="Fail-closed controls" title="Canonicalization layers" />
      <div className="semantic-control-grid">
        {data.featureFlags.map((flag) => <div className="semantic-control-card" key={flag.key}>
          <span><strong>{flag.key}</strong><small>{flag.enabled ? "Enabled" : "Disabled"}</small></span>
          <button className="admin-button" disabled={busy === `flag:${flag.key}`} onClick={() => void toggleFlag(flag.key, !flag.enabled)}>
            {flag.enabled ? "Disable" : "Enable"}
          </button>
        </div>)}
        <div className="semantic-control-card"><span><strong>Semantic cache</strong><small>{data.cache?.entries || 0} entries · {data.cache?.embeddingHits || 0} embedding hits · {data.cache?.decisionHits || 0} decision hits</small></span></div>
      </div>
    </AdminPanel>

    <AdminPanel>
      <AdminPanelHead eyebrow="Human decision required" title="Canonical proposals" />
      {data.canonicalReviewQueue.length ? <div className="admin-data-table application-admin-table">
        <div className="admin-data-row table-head"><span>Canonical</span><span>Group</span><span>Status</span><span>Description</span><span>Action</span><span>Source</span><span>Policy</span></div>
        {data.canonicalReviewQueue.map((item) => <div className="admin-data-row" key={item.key}>
          <span><strong>{item.label}</strong><small>{item.key}</small></span><span>{item.semanticGroup}</span><span><b className="state-tag paused">{item.status}</b></span>
          <span>{item.description}</span><span className="semantic-review-actions">{item.status === "PROPOSED" ? <button disabled={busy === `canonical:${item.key}`} onClick={() => void canonicalStatus(item.key, "VALIDATED")}>Validate</button> : <button disabled={busy === `canonical:${item.key}`} onClick={() => void canonicalStatus(item.key, "TRUSTED")}>Trust concept</button>}<button className="danger" disabled={busy === `canonical:${item.key}`} onClick={() => void canonicalStatus(item.key, "REJECTED")}>Reject</button></span><span>AI proposal</span><span>{item.status === "TRUSTED" ? "Policy controlled" : "Current app only"}</span>
        </div>)}
      </div> : <div className="semantic-empty">No proposed canonical concepts need review.</div>}
      <div className="semantic-merge-row">
        <input aria-label="Canonical to merge" placeholder="Source key" value={mergeSource} onChange={(event) => setMergeSource(event.target.value.toUpperCase())} />
        <span>into</span>
        <input aria-label="Canonical merge target" placeholder="Trusted target key" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value.toUpperCase())} />
        <button className="admin-button" disabled={busy === "merge" || !mergeSource || !mergeTarget} onClick={() => void mergeCanonicals()}>Merge aliases</button>
      </div>
    </AdminPanel>

    <AdminPanel>
      <AdminPanelHead eyebrow="No candidate values shown" title="Mapping review queue" />
      {data.reviewQueue.length ? <div className="admin-data-table application-admin-table">
        <div className="admin-data-row table-head"><span>Observed field</span><span>Canonical</span><span>Scope</span><span>Evidence</span><span>Status</span><span>Source</span><span>Action</span></div>
        {data.reviewQueue.map((item) => <div className="admin-data-row" key={item.id}>
          <span><strong>{item.normalizedLabel}</strong><small>{item.atsType || "generic"}</small></span><span>{item.canonicalLabel}<small>{item.canonicalFieldKey}</small></span>
          <span>{item.siteHost || "global"}</span><span><strong>{item.adaptiveState || "SHADOW not active"}</strong><small>{item.confirmedCount || 0} confirmed · {item.correctedCount || 0} corrected</small><small>{item.adaptivePositive || 0} positive · {item.adaptiveNegative || 0} negative · {item.adaptiveRuns || 0} runs</small></span>
          <span><b className={`state-tag ${item.status.toLowerCase()}`}>{item.status}</b></span><span>{item.source}<small>{Math.round(item.confidence * 100)}%</small></span>
          <span className="semantic-review-actions">
            {item.suggestedCanonicalFieldKey && item.suggestedCanonicalFieldKey !== item.canonicalFieldKey ? <button disabled={busy === `mapping:${item.id}`} onClick={() => void applyMappingSuggestion(item.id, item.suggestedCanonicalFieldKey!)}>Use {item.suggestedCanonicalFieldKey}</button> : null}
            {item.status === "QUARANTINED" ? <button disabled={busy === `mapping:${item.id}`} onClick={() => void mappingStatus(item.id, "CANDIDATE")}>Restore candidate</button>
              : <>{item.status === "CANDIDATE" ? <button disabled={busy === `mapping:${item.id}` || !["VALIDATED", "TRUSTED"].includes(item.canonicalStatus)} onClick={() => void mappingStatus(item.id, "VALIDATED")}>Validate</button> : null}{item.status === "VALIDATED" ? <button disabled={busy === `mapping:${item.id}` || item.canonicalStatus !== "TRUSTED"} onClick={() => void mappingStatus(item.id, "TRUSTED")}>Trust mapping</button> : null}<button className="danger" disabled={busy === `mapping:${item.id}`} onClick={() => void mappingStatus(item.id, "QUARANTINED")}>Quarantine</button></>}
          </span>
        </div>)}
      </div> : <div className="semantic-empty">No candidate or quarantined mappings need review.</div>}
    </AdminPanel>
  </AdminShell>;
}
