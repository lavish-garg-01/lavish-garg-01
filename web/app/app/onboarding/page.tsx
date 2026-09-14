"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Brand } from "../../components/brand";
import { useProduct } from "../../components/product-provider";
import { ApiRequestError } from "../../lib/api-client";
import type { VerifiedProfileInput } from "../../lib/product-types";

const steps = [
  { id: "intent", label: "Goal" },
  { id: "resume", label: "Resume" },
  { id: "verify", label: "Verify" },
  { id: "search", label: "Search" },
  { id: "value", label: "Matches" },
] as const;

const STEP_INDEX: Record<string, number> = Object.fromEntries(steps.map((step, index) => [step.id, index]));

function list(value: string) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
}

function fitLabel(value: string) {
  if (value === "STRONG_FIT") return "Strong fit";
  if (value === "POSSIBLE_FIT") return "Possible fit";
  return "Review carefully";
}

function runUiAction(action: () => Promise<unknown>) {
  void action().catch(() => undefined);
}

export default function OnboardingPage() {
  const { state, hydrated, busy, error, clearError, saveIntent, uploadResume, skipResume, confirmResume, saveSearch, completeOnboarding } = useProduct();
  const initialized = useRef(false);
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState({ currentTitle: "", currentCompany: "", experience: "", roles: "" });
  const [verified, setVerified] = useState<VerifiedProfileInput>({
    name: "", email: "", phone: "", currentTitle: "", currentCompany: "", totalExperienceYears: null,
    skills: [], linkedinUrl: "", githubUrl: "",
  });
  const [skillText, setSkillText] = useState("");
  const [search, setSearch] = useState({ locations: "", workModes: ["Hybrid", "Remote"], employmentTypes: ["Full-time"], minimumSalary: "", excludedSkills: "", dealBreakers: [] as string[] });
  const [resumeWarning, setResumeWarning] = useState("");

  useEffect(() => {
    if (!hydrated || initialized.current) return;
    initialized.current = true;
    const profile = state.profile;
    setIntent({
      currentTitle: profile.currentTitle,
      currentCompany: profile.currentCompany,
      experience: profile.totalExperienceYears == null ? "" : String(profile.totalExperienceYears),
      roles: profile.targetRoles.join(", "),
    });
    setVerified({
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      currentTitle: profile.currentTitle,
      currentCompany: profile.currentCompany,
      totalExperienceYears: profile.totalExperienceYears,
      skills: profile.skills,
      linkedinUrl: profile.linkedinUrl,
      githubUrl: profile.githubUrl,
    });
    setSkillText(profile.skills.join(", "));
    setSearch({
      locations: profile.preferredLocations.join(", "),
      workModes: profile.preferredWorkModes.length ? profile.preferredWorkModes : ["Hybrid", "Remote"],
      employmentTypes: profile.employmentTypes.length ? profile.employmentTypes : ["Full-time"],
      minimumSalary: profile.minimumSalary == null ? "" : String(profile.minimumSalary),
      excludedSkills: profile.excludedSkills.join(", "),
      dealBreakers: profile.dealBreakers,
    });
    setStep(state.onboarding.complete ? 4 : STEP_INDEX[state.onboarding.lastStep] ?? 0);
  }, [hydrated, state]);

  const visibleJobs = useMemo(() => state.jobs.filter((job) => !job.dismissed).slice(0, 3), [state.jobs]);
  const progress = Math.round((step / (steps.length - 1)) * 100);
  const isBusy = Boolean(busy);

  async function handleIntent() {
    const roles = list(intent.roles);
    if (!roles.length) return;
    await saveIntent({
      currentTitle: intent.currentTitle.trim(),
      currentCompany: intent.currentCompany.trim(),
      totalExperienceYears: intent.experience ? Number(intent.experience) : null,
      targetRoles: roles,
    });
    setVerified((current) => ({ ...current, currentTitle: intent.currentTitle.trim(), currentCompany: intent.currentCompany.trim(), totalExperienceYears: intent.experience ? Number(intent.experience) : null }));
    setStep(1);
  }

  async function handleUpload(file?: File) {
    if (!file) return;
    const result = await uploadResume(file);
    const preview = result.profilePreview || {};
    const contact = preview.contact || {};
    const career = preview.career || {};
    setVerified((current) => ({
      ...current,
      name: contact.fullName || current.name,
      email: contact.email || current.email,
      phone: contact.phone || current.phone,
      currentTitle: career.currentTitle || current.currentTitle,
      currentCompany: career.currentCompany || current.currentCompany,
      totalExperienceYears: career.totalExperienceYears ?? current.totalExperienceYears,
      skills: Array.isArray(preview.skills) ? preview.skills : current.skills,
      linkedinUrl: contact.linkedin || current.linkedinUrl,
      githubUrl: contact.github || current.githubUrl,
    }));
    if (Array.isArray(preview.skills)) setSkillText(preview.skills.join(", "));
    setResumeWarning(result.warning || "");
    setStep(2);
  }

  async function handleSkip() {
    await skipResume();
    setResumeWarning("No problem. Add the minimum career facts now; you can upload a resume later.");
    setStep(2);
  }

  async function handleVerify() {
    const payload = { ...verified, skills: list(skillText) };
    if (!payload.name || !payload.email || !payload.currentTitle || !payload.skills.length) return;
    await confirmResume(payload);
    setStep(3);
  }

  async function handleSearch() {
    try {
      await saveSearch({
        preferredLocations: list(search.locations),
        preferredWorkModes: search.workModes,
        employmentTypes: search.employmentTypes,
        minimumSalary: search.minimumSalary ? Number(search.minimumSalary) : null,
        excludedSkills: list(search.excludedSkills),
        dealBreakers: search.dealBreakers,
        excludedCompanies: [],
      });
      await completeOnboarding();
      setStep(4);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.data.code === "ONBOARDING_INCOMPLETE") {
        const onboarding = reason.data.onboarding;
        const next = onboarding && typeof onboarding === "object" && !Array.isArray(onboarding)
          ? (onboarding as Record<string, unknown>).next
          : null;
        const nextId = next && typeof next === "object" && !Array.isArray(next)
          ? String((next as Record<string, unknown>).id || "")
          : "";
        if (nextId in STEP_INDEX) setStep(STEP_INDEX[nextId]);
      }
    }
  }

  function toggleChoice(field: "workModes" | "employmentTypes" | "dealBreakers", choice: string) {
    setSearch((current) => {
      const values = current[field];
      const next = values.includes(choice) ? values.filter((value) => value !== choice) : [...values, choice];
      return { ...current, [field]: next };
    });
  }

  return (
    <main className="onboarding-page real-onboarding">
      <header className="onboarding-header">
        <Brand />
        <div className="onboarding-header-actions"><span className="local-mode-pill"><i />{state.runtime.mode === "api" ? "Local API · SQLite" : "Local browser preview"}</span><Link href="/">Leave for now</Link></div>
      </header>
      <div className="onboarding-shell">
        <aside className="onboarding-context">
          <p className="section-kicker">About 4 minutes</p>
          <h1>Teach Copilot what a good switch looks like.</h1>
          <p>Start with enough information to find relevant engineering roles. Application-specific questions can wait until a recent form actually needs them.</p>
          <div className="onboarding-progress-card">
            <div><span>Search setup</span><strong>{progress}%</strong></div>
            <i><b style={{ width: `${progress}%` }} /></i>
            <p>{step < 4 ? "Saved after every step. Resume facts stay unverified until you approve them." : "Your search foundation is ready. Copilot will learn application details progressively."}</p>
          </div>
          <div className="privacy-callout"><span>✓</span><div><strong>You remain the final reviewer</strong><p>Copilot can prepare and fill verified information. It never submits an employer application.</p></div></div>
        </aside>

        <section className="onboarding-card real-onboarding-card">
          <div className="stepper real-stepper">
            {steps.map((item, index) => <button type="button" key={item.id} className={index <= step ? "complete" : ""} onClick={() => index < step && setStep(index)} disabled={index > step}>
              <span>{index < step ? "✓" : index + 1}</span><small>{item.label}</small>
            </button>)}
          </div>

          {error ? <div className="inline-error" role="alert"><span>!</span><p><strong>We couldn&apos;t save that.</strong>{error}</p><button onClick={clearError}>Dismiss</button></div> : null}

          {step === 0 ? <div className="step-content">
            <p className="page-eyebrow">Step 1 of 5 · Job intent</p>
            <h2>What move are you making?</h2>
            <p>Your resume describes your past. This tells us what you want next.</p>
            <label className="form-field"><span>Target roles *</span><input value={intent.roles} onChange={(event) => setIntent({ ...intent, roles: event.target.value })} placeholder="Backend Engineer, Platform Engineer" /><small>Separate alternatives with commas.</small></label>
            <div className="form-grid"><label className="form-field"><span>Current or most recent title</span><input value={intent.currentTitle} onChange={(event) => setIntent({ ...intent, currentTitle: event.target.value })} placeholder="Software Engineer" /></label><label className="form-field"><span>Total experience</span><div className="input-suffix"><input type="number" min="0" max="50" step="0.5" value={intent.experience} onChange={(event) => setIntent({ ...intent, experience: event.target.value })} /><span>years</span></div></label></div>
            <label className="form-field"><span>Current company <em>optional</em></span><input value={intent.currentCompany} onChange={(event) => setIntent({ ...intent, currentCompany: event.target.value })} placeholder="Company name" /></label>
            <div className="onboarding-tip"><span>↗</span><p><strong>Why ask this first?</strong> Someone with PHP and Node.js experience can choose to see only Node.js roles. Historical skills never become unwanted recommendations.</p></div>
          </div> : null}

          {step === 1 ? <div className="step-content">
            <p className="page-eyebrow">Step 2 of 5 · Career evidence</p>
            <h2>Add your master resume.</h2>
            <p>We extract a proposed profile. You decide what becomes trusted information.</p>
            {state.resume && state.resume.status !== "SKIPPED" ? <div className="uploaded-resume"><span className="resume-file-icon">PDF</span><div><strong>{state.resume.fileName}</strong><p>{state.resume.status === "CONFIRMED" ? "Verified" : "Ready to review"}{state.resume.parseConfidence ? ` · ${Math.round(state.resume.parseConfidence * 100)}% parse confidence` : ""}</p></div><button onClick={() => setStep(2)}>Review</button></div> : <label className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); runUiAction(() => handleUpload(event.dataTransfer.files?.[0])); }}><input type="file" accept="application/pdf,.pdf" onChange={(event) => runUiAction(() => handleUpload(event.target.files?.[0]))} /><span className="upload-icon">⇧</span><strong>Drop your resume here</strong><small>PDF · up to 10 MB</small><b>{busy || "Choose file"}</b></label>}
            <button className="text-button onboarding-skip" onClick={() => runUiAction(handleSkip)} disabled={isBusy}>Continue without a resume</button>
            <div className="onboarding-tip"><span>✓</span><p><strong>No silent overwrite.</strong> Replacing a resume creates a new review. Candidate-confirmed facts remain the source of truth until you approve a change.</p></div>
          </div> : null}

          {step === 2 ? <div className="step-content">
            <p className="page-eyebrow">Step 3 of 5 · Verification</p>
            <h2>{state.resume?.status === "SKIPPED" ? "Add the minimum career profile." : "Review what Copilot found."}</h2>
            <p>{resumeWarning || "Confirm only the facts you would be comfortable reusing in an application."}</p>
            <div className="review-confidence"><span className="status-dot" /><p><strong>{state.resume?.parseConfidence ? `${Math.round(state.resume.parseConfidence * 100)}% extraction confidence` : "Candidate review required"}</strong><small>Uncertain fields stay suggestions until you confirm them.</small></p></div>
            <div className="form-grid"><label className="form-field"><span>Full name *</span><input value={verified.name} onChange={(event) => setVerified({ ...verified, name: event.target.value })} /></label><label className="form-field"><span>Email *</span><input type="email" value={verified.email} onChange={(event) => setVerified({ ...verified, email: event.target.value })} /></label><label className="form-field"><span>Phone</span><input value={verified.phone} onChange={(event) => setVerified({ ...verified, phone: event.target.value })} /></label><label className="form-field"><span>Total experience</span><div className="input-suffix"><input type="number" step="0.5" value={verified.totalExperienceYears ?? ""} onChange={(event) => setVerified({ ...verified, totalExperienceYears: event.target.value ? Number(event.target.value) : null })} /><span>years</span></div></label></div>
            <div className="form-grid"><label className="form-field"><span>Current title *</span><input value={verified.currentTitle} onChange={(event) => setVerified({ ...verified, currentTitle: event.target.value })} /></label><label className="form-field"><span>Current company</span><input value={verified.currentCompany} onChange={(event) => setVerified({ ...verified, currentCompany: event.target.value })} /></label></div>
            <label className="form-field"><span>Core skills *</span><textarea rows={3} value={skillText} onChange={(event) => setSkillText(event.target.value)} placeholder="Node.js, TypeScript, PostgreSQL, AWS" /><small>Keep skills you can support with real experience.</small></label>
            <details className="optional-details"><summary>Professional links <span>Optional</span></summary><div className="form-grid"><label className="form-field"><span>LinkedIn</span><input value={verified.linkedinUrl} onChange={(event) => setVerified({ ...verified, linkedinUrl: event.target.value })} placeholder="linkedin.com/in/…" /></label><label className="form-field"><span>GitHub</span><input value={verified.githubUrl} onChange={(event) => setVerified({ ...verified, githubUrl: event.target.value })} placeholder="github.com/…" /></label></div></details>
          </div> : null}

          {step === 3 ? <div className="step-content">
            <p className="page-eyebrow">Step 4 of 5 · Search essentials</p>
            <h2>Set boundaries, not a giant questionnaire.</h2>
            <p>Current CTC, notice period and relocation can wait until a recent application form proves they are useful.</p>
            <label className="form-field"><span>Preferred locations *</span><input value={search.locations} onChange={(event) => setSearch({ ...search, locations: event.target.value })} placeholder="Bengaluru, Pune, Remote India" /></label>
            <fieldset className="choice-field"><legend>Work mode *</legend><div className="choice-row">{["Remote", "Hybrid", "Office"].map((choice) => <button type="button" key={choice} aria-pressed={search.workModes.includes(choice)} className={search.workModes.includes(choice) ? "selected" : ""} onClick={() => toggleChoice("workModes", choice)}>{search.workModes.includes(choice) ? "✓ " : ""}{choice}</button>)}</div></fieldset>
            <div className="form-grid"><fieldset className="choice-field"><legend>Employment</legend><div className="choice-row compact">{["Full-time", "Contract"].map((choice) => <button type="button" key={choice} aria-pressed={search.employmentTypes.includes(choice)} className={search.employmentTypes.includes(choice) ? "selected" : ""} onClick={() => toggleChoice("employmentTypes", choice)}>{choice}</button>)}</div></fieldset><label className="form-field"><span>Minimum compensation <em>optional</em></span><div className="input-suffix"><input type="number" min="0" value={search.minimumSalary} onChange={(event) => setSearch({ ...search, minimumSalary: event.target.value })} placeholder="20" /><span>LPA</span></div></label></div>
            <label className="form-field"><span>Technologies you don&apos;t want</span><input value={search.excludedSkills} onChange={(event) => setSearch({ ...search, excludedSkills: event.target.value })} placeholder="PHP, legacy .NET" /></label>
            <fieldset className="choice-field"><legend>Optional deal-breakers</legend><div className="choice-row">{["No internships", "No night shifts", "No 6-day week", "No staffing agencies"].map((choice) => <button type="button" key={choice} aria-pressed={search.dealBreakers.includes(choice)} className={search.dealBreakers.includes(choice) ? "selected" : ""} onClick={() => toggleChoice("dealBreakers", choice)}>{choice}</button>)}</div></fieldset>
          </div> : null}

          {step === 4 ? <div className="step-content value-step">
            <div className="value-ready-head"><span className="ready-check">✓</span><div><p className="page-eyebrow">{state.runtime.mode === "api" ? "First value · local results" : "First value · sample UI preview"}</p><h2>{visibleJobs.length ? `${visibleJobs.length} ${state.runtime.mode === "api" ? "roles" : "sample roles"} worth reviewing first.` : "Your search is ready."}</h2><p>{visibleJobs.length ? (state.runtime.mode === "api" ? "Your saved rules produced this shortlist. Hard requirements come before confidence." : "These sample cards demonstrate the workflow; connect the local API and run discovery for your own shortlist.") : "No current roles satisfy every boundary. Relax one filter or run job discovery—your profile is safely saved."}</p></div></div>
            {visibleJobs.length ? <div className="onboarding-job-list">{visibleJobs.map((job) => <article key={job.id}><div className="job-card-top"><span className="company-avatar">{job.logo}</span><div><p className="page-eyebrow">{job.company} · {job.source}</p><h3>{job.role}</h3><span>{job.location} · {job.salary}</span></div><b className={`fit-label fit-${job.fit.toLowerCase()}`}>{fitLabel(job.fit)}</b></div><ul>{job.fitReasons.slice(0, 3).map((reason) => <li key={reason}>✓ {reason}</li>)}</ul>{job.gaps.length ? <p className="job-gap">△ {job.gaps[0]}</p> : null}</article>)}</div> : <div className="empty-state compact-empty"><span>⌕</span><strong>No invented job count</strong><p>When your local API has no matches, Copilot says so and keeps your setup ready for the next discovery run.</p></div>}
            <div className="activation-card"><span className="mode-icon">◎</span><div><strong>Browser Copilot is the next step—not a signup gate.</strong><p>Connect it when you are ready to apply. Search, saving and tracking still work without the extension.</p></div><span className="ui-badge badge-neutral">Optional</span></div>
            <a href="/app" className="button button-primary full-button">Open my workspace →</a>
          </div> : null}

          {step < 4 ? <div className="onboarding-actions"><button className="back-button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || isBusy}>Back</button><button className="button button-primary" disabled={isBusy || (step === 0 && !list(intent.roles).length) || (step === 2 && (!verified.name || !verified.email || !verified.currentTitle || !list(skillText).length)) || (step === 3 && (!list(search.locations).length || !search.workModes.length))} onClick={() => runUiAction(step === 0 ? handleIntent : step === 1 ? handleSkip : step === 2 ? handleVerify : handleSearch)}>{busy || (step === 1 ? "Enter profile manually" : step === 3 ? "Find my first jobs" : "Save & continue")} {!busy ? "→" : ""}</button></div> : null}
        </section>
      </div>
    </main>
  );
}
