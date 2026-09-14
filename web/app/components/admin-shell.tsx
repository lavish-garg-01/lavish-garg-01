import type { ReactNode } from "react";

const adminNav = [
  ["/admin", "O", "Overview"],
  ["/admin/users", "U", "Users"],
  ["/admin/applications", "A", "Applications"],
  ["/admin/semantics", "C", "Field semantics"],
  ["/admin/candidate-truth", "T", "Answer policies"],
  ["/admin/adapters", "S", "Site adapters"],
  ["/admin/ai-spend", "₹", "AI spend"],
  ["/admin/billing", "B", "Billing"],
  ["/admin/incidents", "!", "Incidents", "2"],
] as const;

export function AdminShell({ active, title, subtitle, children, actions, live = false }: { active: string; title: string; subtitle: string; children: ReactNode; actions?: ReactNode; live?: boolean }) {
  return (
    <div className={`admin-shell${live ? " admin-live" : ""}`}>
      <aside className="admin-sidebar">
        <a href="/admin" className="admin-brand"><span className="admin-brand-mark">JH</span><span><strong>Job Hunter</strong><small>Operator console</small></span></a>
        <div className="environment-pill"><span /> {live ? "Local operator · live data" : "Prototype · sample data"}</div>
        <nav className="admin-nav" aria-label="Admin console">
          {adminNav.map(([href, glyph, label, count]) => <a key={href} href={href} className={active === href ? "active" : ""}><span>{glyph}</span>{label}{count ? <b>{count}</b> : null}</a>)}
        </nav>
        <div className="sidebar-grow" />
        <div className="admin-help"><strong>{live ? "Local operator controls" : "Operator UI preview"}</strong><p>{live ? "Live controls affect only this machine's local registries. Supabase admin roles remain a future boundary." : "Controls are disabled until protected admin APIs and roles are connected."}</p><a href="/admin/incidents">View sample runbooks →</a></div>
        <a href="/app" className="return-product">← Candidate product</a>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar"><p>{live ? "Local operator registry" : "Interface preview"} <strong>· {live ? "live on this machine" : "no live sync"}</strong></p><div><span className="admin-avatar">AD</span></div></header>
        <main className="admin-main">
          <div className="admin-preview-notice" role="note"><strong>{live ? "Local-only controls" : "Sample operator data"}</strong><span>{live ? "Mappings, policies and statuses below are backed by SQLite. Candidate values are intentionally absent." : "This console demonstrates the intended layout. Metrics and controls are not connected to users, billing, Supabase or production systems."}</span></div>
          <div className="admin-page-head"><div><p>Operations</p><h1>{title}</h1><span>{subtitle}</span></div>{actions ? <div className="page-actions">{actions}</div> : null}</div>
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`admin-panel ${className}`}>{children}</section>;
}

export function AdminPanelHead({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  return <div className="admin-panel-head"><div>{eyebrow ? <p>{eyebrow}</p> : null}<h2>{title}</h2></div>{action}</div>;
}
