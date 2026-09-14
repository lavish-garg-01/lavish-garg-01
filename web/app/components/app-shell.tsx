"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "./brand";
import { useProduct } from "./product-provider";

const nav = [
  ["/app", "H", "Home"],
  ["/app/jobs", "J", "Jobs"],
  ["/app/applications", "A", "Applications"],
  ["/app/documents", "D", "Documents"],
  ["/app/attention", "!", "Attention", "2"],
  ["/app/profile", "P", "Profile"],
] as const;

export function AppShell({
  active,
  eyebrow,
  title,
  subtitle,
  children,
  actions,
}: {
  active: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { state, hydrated, error, clearError } = useProduct();
  const router = useRouter();
  useEffect(() => {
    if (hydrated && !state.onboarding.complete) router.replace("/app/onboarding");
  }, [hydrated, router, state.onboarding.complete]);
  const blockerApplicationIds = new Set(state.attention.blockers.map((item) => item.applicationId));
  const recoveryCount = state.applications.filter((application) =>
    (application.stage === "Recovery needed" || application.status === "LOGIN_REQUIRED" || application.status === "CAPTCHA_REQUIRED")
    && !blockerApplicationIds.has(application.id)).length;
  const attentionCount = state.attention.blockers.length + state.attention.gaps.length + recoveryCount;
  const displayName = state.profile.name || "Local candidate";
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LC";
  if (!hydrated || !state.onboarding.complete) {
    return <main className="workspace-gate"><Brand /><div className="loading-state"><i /><span>{hydrated ? "Opening onboarding…" : "Loading your local workspace…"}</span></div></main>;
  }
  return (
    <div className="product-shell">
      <aside className="app-sidebar">
        <Brand />
        <nav className="app-nav" aria-label="Candidate workspace">
          <p className="nav-section-label">Workspace</p>
          {nav.map(([href, glyph, label, count]) => (
            <a key={href} href={href} className={active === href ? "active" : ""} aria-current={active === href ? "page" : undefined}>
              <span className="nav-glyph" aria-hidden="true">{glyph}</span>
              <span>{label}</span>
              {count && attentionCount ? <span className="nav-count">{attentionCount}</span> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-grow" />
        <div className="zero-ai-card">
          <div><span className="status-dot" /> Pro pass available</div>
          <strong>Try Copilot for 7 days</strong>
          <p>Tailored resumes, cover letters and smarter application help.</p>
          <a href="/app/profile#plan">Start free · no card</a>
        </div>
        <a href="/app/profile" className="sidebar-profile">
          <span className="avatar">{initials}</span>
          <span><strong>{displayName}</strong><small>{state.plan.id === "PRO" ? "Pro plan" : "Free plan"}</small></span>
          <span aria-hidden="true">⋯</span>
        </a>
      </aside>
      <div className="app-workspace">
        <header className="app-topbar">
          <a className="search-box workspace-search-link" href="/app/jobs"><span aria-hidden="true">⌕</span><span>Browse and search matching jobs</span></a>
          <div className="topbar-actions">
            <span className={`copilot-status ${state.runtime.connection === "ERROR" ? "connection-error" : ""}`} title={state.runtime.message}>
              <span className="status-dot" /> {hydrated ? (state.runtime.mode === "api" ? "Local API connected" : "Local mode") : "Connecting"}
            </span>
            <a className="button button-dark" href="/app/profile#plan">Try Pro free</a>
          </div>
        </header>
        <main className="app-main">
          <div className="page-heading">
            <div><p className="page-eyebrow">{eyebrow}</p><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
            {actions ? <div className="page-actions">{actions}</div> : null}
          </div>
          {error ? <div className="workspace-notice warn" role="alert"><strong>That action did not finish.</strong><p>{error}</p><button type="button" onClick={clearError}>Dismiss</button></div> : null}
          {children}
        </main>
      </div>
    </div>
  );
}

export function Panel({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`panel ${className}`}>{children}</section>;
}

export function PanelHead({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="panel-head"><div>{eyebrow ? <p>{eyebrow}</p> : null}<h2>{title}</h2></div>{action}</div>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "pro" | "bad" }) {
  return <span className={`ui-badge badge-${tone}`}>{children}</span>;
}
