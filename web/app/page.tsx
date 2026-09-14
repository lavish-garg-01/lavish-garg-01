import Link from "next/link";

const navItems = [
  ["Copilot", "#copilot"],
  ["How it works", "#how-it-works"],
  ["Where it works", "#where-it-works"],
  ["Security", "#security"],
  ["Pricing", "#pricing"],
] as const;

function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Job Hunter home">
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      <span>Job Hunter</span>
      <span className="beta-badge">Copilot</span>
    </Link>
  );
}

function MatchCard() {
  return (
    <article className="floating-card match-card" aria-label="Example matched job">
      <div className="card-kicker-row"><span className="company-avatar">R</span><span className="support-badge">Greenhouse · Autofill</span></div>
      <p className="eyebrow">Razorpay</p><h2>Platform Engineer</h2><p className="muted">Bengaluru · Hybrid · ₹32–48 LPA</p>
      <div className="score-row"><strong>94% match</strong><span>6 hours ago</span></div>
      <div className="skill-row"><span>Node.js</span><span>Kubernetes</span><span>AWS</span></div>
    </article>
  );
}

function CopilotCard() {
  return (
    <article className="floating-card copilot-card" aria-label="Example application copilot">
      <div className="copilot-head"><div><p className="eyebrow">Copilot · Live on Workday</p><h2>14 fields filled in seconds</h2></div><span className="status-dot" aria-label="Connected" /></div>
      <div className="progress-track"><span /></div>
      <div className="field-row"><div><strong>Profile & work history</strong><small>Reused from your approved profile</small></div><span className="field-state ready">Filled</span></div>
      <div className="field-row"><div><strong>Role-specific answer</strong><small>Drafted from your experience</small></div><span className="field-state review">Review</span></div>
      <div className="review-note">Copilot did the repetitive work · you approve</div>
    </article>
  );
}

function ResumeCard() {
  return (
    <article className="floating-card resume-card" aria-label="Example resume preparation">
      <div className="document-icon" aria-hidden="true"><span /><span /><span /></div>
      <div><p className="eyebrow">ATS resume</p><h2>Platform · approved</h2><p className="muted">Parser-safe · role evidence retained</p></div>
      <span className="readiness">Ready</span>
    </article>
  );
}

export default function Home() {
  return (
    <main className="marketing-page">
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation" className="main-nav">
            {navItems.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
          </nav>
          <div className="header-actions"><a href="/app" className="text-link">Open workspace</a><a href="/app/onboarding" className="button button-dark">Set up my Copilot</a></div>
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="ambient-grid" aria-hidden="true" />
        <div className="hero-stage" aria-hidden="true">
          <MatchCard /><CopilotCard /><ResumeCard />
          <div className="source-chip source-one">Source · verified profile</div><div className="source-chip source-two">Notice fit · exact</div>
        </div>
        <div className="hero-copy">
          <p className="hero-kicker"><span /> Your AI job search Copilot</p>
          <h1 id="hero-title">Switch jobs without making job search <em>your second job.</em></h1>
          <p className="hero-subtitle">Find better-fit roles, tailor your resume and cover letter, and fill repetitive applications in seconds. Give your search ten focused minutes a day—Copilot handles the grind.</p>
          <div className="hero-actions">
            <a href="/app/onboarding" className="button button-primary">Set up my Copilot</a>
            <a href="#how-it-works" className="button button-light">See Copilot at work <span aria-hidden="true">→</span></a>
          </div>
          <p className="hero-meta">7-day Pro pass · No card required · Free plan remains available</p>
          <ul className="trust-list" aria-label="Product commitments"><li>You approve every application</li><li>No invented experience</li><li>Free plan stays available</li></ul>
        </div>
      </section>

      <section className="platform-strip" aria-label="Supported job platforms">
        <p>One Copilot across the places engineers already apply</p>
        <div><span>Naukri</span><span>LinkedIn</span><span>Instahyre</span><span>Wellfound</span><span>Greenhouse</span><span>Workday</span></div>
      </section>
      <section id="how-it-works" className="first-proof">
        <p className="section-kicker">Stop repeating yourself on every portal</p>
        <h2>A ten-minute daily job-search routine—with a Copilot doing the repetitive work.</h2>
        <div className="workflow-grid">
          <article><span>01</span><div className="workflow-icon">⌁</div><h3>Tell Copilot what you want</h3><p>Add target roles, locations, work mode, salary boundary and your career evidence once.</p></article>
          <article><span>02</span><div className="workflow-icon">◎</div><h3>Start with better-fit jobs</h3><p>Smart matching ranks relevant roles and explains where your experience fits the job.</p></article>
          <article><span>03</span><div className="workflow-icon">▤</div><h3>Tailor every strong application</h3><p>Generate an ATS-ready resume, cover letter and grounded answers for the role.</p></article>
          <article><span>04</span><div className="workflow-icon">✓</div><h3>Fill in seconds. You approve.</h3><p>Copilot completes repeated fields, pauses for decisions, and keeps the application tracked.</p></article>
        </div>
        <div className="outcome-strip"><div><strong>~10 minutes</strong><span>for a focused daily workflow</span></div><div><strong>Seconds</strong><span>to fill repeated fields</span></div><div><strong>One profile</strong><span>across supported boards and ATS portals</span></div><div><strong>One tracker</strong><span>for roles you choose to prepare</span></div></div>
      </section>

      <section id="copilot" className="product-story">
        <div className="story-copy">
          <p className="section-kicker">A Copilot—not another job board</p>
          <h2>Open one workspace and know exactly what to do next.</h2>
          <p>Your daily brief brings together the roles worth applying to, tailored documents, applications waiting for review, and follow-ups due today.</p>
          <ul className="feature-list"><li><strong>AI-assisted match explanations</strong><span>Understand why a role fits before spending time on the application.</span></li><li><strong>Tailored resume and cover letter</strong><span>Bring forward the right verified experience for each job description.</span></li><li><strong>Application Copilot</strong><span>Fill common fields, draft grounded answers and track the application from one panel.</span></li></ul>
          <a className="inline-link" href="/app">Explore the candidate workspace →</a>
        </div>
        <div className="dashboard-preview" aria-label="Candidate dashboard preview">
          <div className="preview-sidebar"><div className="mini-logo">JH</div><span className="selected">Home</span><span>Jobs</span><span>Applications</span><span>Documents</span><span>Attention <b>2</b></span></div>
          <div className="preview-content"><div className="preview-top"><div><small>TUESDAY · 26 AUG</small><h3>Good morning, Arjun.</h3></div><span>Copilot · ready</span></div><div className="preview-stats"><div><strong>12</strong><small>new matches</small></div><div><strong>3</strong><small>ready to apply</small></div><div><strong>2</strong><small>need you</small></div></div><div className="preview-job"><span className="company-avatar">R</span><div><small>RAZORPAY · 94% MATCH</small><strong>Platform Engineer</strong><p>Bengaluru · Hybrid · ₹32–48 LPA</p></div><button>Apply with Copilot</button></div><div className="preview-job"><span className="company-avatar purple">A</span><div><small>ATLASSIAN · 91% MATCH</small><strong>Senior Backend Engineer</strong><p>Remote India · ₹38–55 LPA</p></div><button>Apply with Copilot</button></div></div>
        </div>
      </section>

      <section className="india-section">
        <div><p className="section-kicker">Built for the Indian market</p><h2>Indian job search has its own constraints. The product should know them.</h2></div>
        <div className="india-grid"><article><strong>CTC and notice period built in</strong><p>When a relevant form asks, confirm CTC, notice period and buyout details once for matching future questions.</p></article><article><strong>India-first job preferences</strong><p>Rank by Bengaluru, NCR, Hyderabad, Pune, remote India, hybrid work and the compensation bands you actually use.</p></article><article><strong>Practical support across portals</strong><p>Use Smart Fill on supported boards and ATS forms, with the Copilot Sidebar and Quick Copy as fallbacks.</p></article><article><strong>Made for working professionals</strong><p>Run a discreet, focused search without turning evenings and weekends into application marathons.</p></article></div>
      </section>

      <section id="where-it-works" className="compatibility-section">
        <div className="section-heading-row"><div><p className="section-kicker">One Copilot wherever you apply</p><h2>From job board to company form—keep your profile with you.</h2></div><p>Copilot recognises common application fields on leading portals. On unfamiliar forms, Quick Copy keeps every approved answer one click away.</p></div>
        <div className="portal-cloud" aria-label="Job boards and application systems"><span>Naukri</span><span>LinkedIn</span><span>Instahyre</span><span>Wellfound</span><span>Workday</span><span>Greenhouse</span><span>Lever</span><span>Ashby</span><span>SmartRecruiters</span><span>Company careers</span></div>
        <div className="compatibility-grid">
          <article><span className="compatibility-number">01</span><h3>Smart Fill</h3><p>Complete contact details, education, employment, links and common questions directly on recognised forms.</p><strong>Major job boards & ATS portals</strong></article>
          <article className="featured"><span className="compatibility-number">02</span><h3>Copilot Sidebar</h3><p>Keep tailored documents, approved answers and your complete profile beside every application page.</p><strong>Available throughout your search</strong></article>
          <article><span className="compatibility-number">03</span><h3>Quick Copy</h3><p>For a new or unusual form, copy any saved fact or answer instantly and keep moving without retyping.</p><strong>A practical fallback anywhere</strong></article>
        </div>
      </section>

      <section id="security" className="trust-section">
        <div className="trust-copy"><p className="section-kicker">Automation with boundaries</p><h2>You should never wonder what the product did in your name.</h2><p>Every important action stays attributable, reviewable and reversible. The system pauses when evidence is missing.</p></div>
        <div className="trust-grid"><article><span>01</span><h3>Human submission gate</h3><p>No application is submitted without your explicit review.</p></article><article><span>02</span><h3>Source-linked answers</h3><p>Autofill shows where each important answer came from.</p></article><article><span>03</span><h3>No fabricated claims</h3><p>Missing evidence creates an Attention item—not invented experience.</p></article><article><span>04</span><h3>Revocable access</h3><p>Disconnect browser assistance and delete stored data from Settings.</p></article></div>
      </section>

      <section id="pricing" className="pricing-section">
        <div className="pricing-heading"><p className="section-kicker">Founding launch prices</p><h2>Try the complete Copilot for a week. Pay only if it saves you time.</h2><p>Every new account gets a seven-day Pro pass with no card required. It ends automatically—choose Free, Weekly or Monthly after you have tried the workflow.</p></div>
        <div className="pricing-grid">
          <article className="price-card"><div><p className="plan-name">Free</p><h3>₹0 <span>/ forever</span></h3><p>Keep your search organised and moving.</p></div><a href="/app/onboarding" className="button button-light">Start free</a><ul><li>Smart job matching</li><li>Master resume and profile</li><li>Basic application autofill</li><li>Application tracker</li><li>Saved jobs and preferences</li></ul><p className="cost-note">A useful home for your ongoing job search.</p></article>
          <article className="price-card"><span className="launch-pill">LAUNCH PRICE</span><div><p className="plan-name">Weekly Pro</p><h3>₹79 <span>/ week</span></h3><p className="price-was">Regular price <s>₹149</s></p><p>For a short, focused application sprint.</p></div><a href="/app/onboarding" className="button button-light">Try Pro free for 7 days</a><ul><li>Everything in Free</li><li>AI-assisted match explanations</li><li>Tailored resume and cover letter</li><li>Drafted screening answers</li><li>Full Copilot workflow</li></ul><p className="cost-note">No card for the trial. The pass ends automatically.</p></article>
          <article className="price-card featured"><span className="popular-pill">BEST VALUE · LAUNCH PRICE</span><div><p className="plan-name">Monthly Pro</p><h3>₹249 <span>/ month</span></h3><p className="price-was">Regular price <s>₹499</s></p><p>For an active search with consistent momentum.</p></div><a href="/app/onboarding" className="button button-primary">Try Pro free for 7 days</a><ul><li>Everything in Weekly Pro</li><li>Unlimited role shortlisting</li><li>Resume versions for every role</li><li>Application history and follow-ups</li><li>Best value for ongoing searches</li></ul><p className="cost-note">Introductory pricing shown clearly before checkout.</p></article>
        </div>
      </section>

      <section className="faq-section"><div><p className="section-kicker">Straight answers</p><h2>Before Copilot joins your job search.</h2></div><div className="faq-list"><details open><summary>Will the seven-day Pro pass charge me later?</summary><p>No. Starting the pass needs no card or UPI mandate. It ends automatically, and you choose a plan only if you want to continue with Pro.</p></details><details><summary>Does Job Hunter submit applications without me?</summary><p>No. Copilot fills and drafts what it can, then asks you to review the application and submit it yourself.</p></details><details><summary>Will Copilot invent achievements?</summary><p>No. Tailored material must come from experience you have added or approved. If evidence is missing, Copilot asks you instead of manufacturing a claim.</p></details><details><summary>What happens on a new or unusual application form?</summary><p>The Copilot Sidebar still keeps your profile, documents and saved answers beside the page, so you can Quick Copy details instead of typing them again.</p></details></div></section>

      <section className="final-cta"><p className="section-kicker">Your next switch needs momentum</p><h2>Give Copilot ten minutes. Get your evenings back.</h2><p>Set up your search for free. Your seven-day Pro pass starts when you first use a Pro action—no card, no automatic charge.</p><a href="/app/onboarding" className="button button-primary">Start free setup</a></section>
      <footer className="site-footer"><div><Brand /><p>Your job search Copilot for better-fit roles, tailored applications and less repetitive work.</p></div><div><strong>Product</strong><a href="#copilot">Copilot</a><a href="#how-it-works">How it works</a><a href="#where-it-works">Where it works</a><a href="#pricing">Pricing</a></div><div><strong>Trust</strong><a href="#security">Security</a><a href="/privacy">Privacy notice</a><a href="/admin">Admin UI preview</a></div><div><strong>Company</strong><a href="/terms">Test terms</a><a href="/privacy">Test privacy notice</a></div><p className="footer-bottom">© 2026 Job Hunter Copilot · Built in India for ambitious career moves.</p></footer>
    </main>
  );
}
