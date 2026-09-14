import { AdminPanel, AdminPanelHead, AdminShell } from "../../components/admin-shell";

const adapters = [
  ["Greenhouse", "Full autofill", "Healthy", "99.1%", "1,204", "3m ago", "good"],
  ["LinkedIn", "Guided assist", "Healthy", "96.8%", "842", "5m ago", "good"],
  ["Instahyre", "Guided autofill", "Healthy", "97.4%", "291", "8m ago", "good"],
  ["Workday", "Guided assist", "Degraded", "89.6%", "418", "2m ago", "warn"],
  ["Naukri", "Guided autofill", "Investigate", "72.4%", "96", "1m ago", "bad"],
  ["Lever", "Full autofill", "Healthy", "98.2%", "184", "12m ago", "good"],
];

export default function AdminAdapters() {
  return <AdminShell active="/admin/adapters" title="Site adapters" subtitle="Capability truth, run health and safe rollout controls." actions={<button className="admin-button">Run smoke checks</button>}>
    <div className="admin-alert"><span>!</span><div><strong>Public support copy follows this registry</strong><p>If an adapter is degraded or paused here, candidate-facing capability labels update automatically.</p></div><button>View public matrix</button></div>
    <AdminPanel><AdminPanelHead eyebrow="Production registry" title="Portal health" action={<span className="registry-time">Checked continuously · sampled 12:42</span>} /><div className="adapter-table"><div className="adapter-row table-head"><span>Portal</span><span>Capability</span><span>Status</span><span>Success · 24h</span><span>Runs · 24h</span><span>Last run</span><span>Control</span></div>{adapters.map(row => <div className="adapter-row" key={row[0]}><span><span className={`health-light ${row[6]}`} /><strong>{row[0]}</strong></span><span>{row[1]}</span><span><b className={`state-tag ${row[2].toLowerCase()}`}>{row[2]}</b></span><span><strong>{row[3]}</strong></span><span>{row[4]}</span><span>{row[5]}</span><span><button>{row[2] === 'Investigate' ? 'Pause' : 'Open'}</button></span></div>)}</div></AdminPanel>
    <div className="admin-grid-bottom"><AdminPanel><AdminPanelHead eyebrow="Safe deployment" title="Recent adapter releases" /><div className="release-list"><div><span>v42</span><p><strong>Greenhouse question groups</strong><small>100% rollout · deployed by A. Kumar</small></p><b>Passed</b></div><div><span>v18</span><p><strong>Workday attachment handler</strong><small>25% canary · rollback ready</small></p><b className="warning">Watching</b></div><div><span>v31</span><p><strong>LinkedIn assist labels</strong><small>100% rollout · deployed yesterday</small></p><b>Passed</b></div></div></AdminPanel><AdminPanel><AdminPanelHead eyebrow="Operating standard" title="Capability levels" /><dl className="capability-defs"><div><dt>Full</dt><dd>Fill is reliable; user still submits.</dd></div><div><dt>Guided</dt><dd>Known pauses and manual steps are surfaced.</dd></div><div><dt>Track</dt><dd>Save and monitor only; no form assistance.</dd></div><div><dt>Paused</dt><dd>Candidate entry points disabled immediately.</dd></div></dl></AdminPanel></div>
  </AdminShell>;
}
