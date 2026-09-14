"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiConfigured, apiRequest, loadApiProductState } from "../lib/api-client";
import { initialProductState, LOCAL_STORAGE_KEY } from "../lib/local-product";
import type {
  CandidateProfile,
  AvailabilityPrompt,
  JobAvailability,
  IntentInput,
  ProductJob,
  ProductState,
  SearchInput,
  VerifiedProfileInput,
} from "../lib/product-types";

type ResumeProfilePreview = {
  contact?: { fullName?: string; email?: string; phone?: string; linkedin?: string; github?: string };
  career?: { currentTitle?: string; currentCompany?: string; totalExperienceYears?: number | null };
  skills?: string[];
};

type UploadResult = { profilePreview?: ResumeProfilePreview | null; warning?: string };

type ProductContextValue = {
  state: ProductState;
  hydrated: boolean;
  busy: string | null;
  error: string | null;
  clearError: () => void;
  saveIntent: (input: IntentInput) => Promise<void>;
  uploadResume: (file: File) => Promise<UploadResult>;
  skipResume: () => Promise<void>;
  confirmResume: (input: VerifiedProfileInput) => Promise<void>;
  saveSearch: (input: SearchInput) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshJobFeed: () => Promise<void>;
  loadMoreJobs: () => Promise<void>;
  saveJob: (jobId: string) => Promise<void>;
  dismissJob: (jobId: string) => Promise<void>;
  markJobSeen: (jobId: string) => Promise<void>;
  startApplication: (job: ProductJob) => Promise<void>;
  claimJobAvailability: (jobId: string) => Promise<AvailabilityPrompt | null>;
  reportJobAvailability: (jobId: string, input: {
    requestId: string;
    result: "OPEN" | "CLOSED" | "UNCERTAIN";
    evidenceCode?: "NONE" | "APPLY_CONTROL_AVAILABLE";
  }) => Promise<JobAvailability | null>;
  resolveGap: (key: string, value: string) => Promise<void>;
  updateProfile: (patch: Partial<CandidateProfile>) => Promise<void>;
  resetLocalWorkspace: () => void;
};

const ProductContext = createContext<ProductContextValue | null>(null);

function loadLocalState(): ProductState {
  const fallback = initialProductState();
  if (typeof window === "undefined") return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) || "null");
    if (!stored || stored.version !== fallback.version) return fallback;
    const normalizeJob = (job: ProductJob): ProductJob => ({
      ...job,
      fitReasons: Array.isArray(job.fitReasons) ? job.fitReasons : [],
      gaps: Array.isArray(job.gaps) ? job.gaps : [],
      unknowns: Array.isArray(job.unknowns) ? job.unknowns : [],
      skills: Array.isArray(job.skills) ? job.skills : [],
      availability: job.availability || { status: "UNKNOWN" as const, reason: "LOCAL_STATE_MIGRATED", confidence: 0,
        explicitDeadline: null, lastVerifiedAt: null, closedAt: null, verificationRecommended: false },
      actionability: job.actionability || {
        status: job.availability?.status === "CLOSED" ? "CLOSED" : "OPEN",
        canApply: job.availability?.status !== "CLOSED",
        discoveryEligible: true,
        reason: null,
      },
      whyThisJob: job.whyThisJob || { scoringMethod: "MATCHING_POLICY_V1", evidenceCoverage: 0,
        hardRequirementsFirst: true },
    });
    const jobs = Array.isArray(stored.jobs) ? stored.jobs.map(normalizeJob) : fallback.jobs;
    const savedJobs = Array.isArray(stored.savedJobs) ? stored.savedJobs.map(normalizeJob)
      : jobs.filter((job) => job.saved);
    return {
      ...fallback,
      ...stored,
      profile: {
        ...fallback.profile,
        ...(stored.profile || {}),
        experienceTolerance: {
          ...fallback.profile.experienceTolerance,
          ...(stored.profile?.experienceTolerance || {}),
        },
      },
      searchProfile: {
        ...fallback.searchProfile,
        ...(stored.searchProfile || {}),
        experienceTolerance: {
          ...fallback.searchProfile.experienceTolerance,
          ...(stored.searchProfile?.experienceTolerance || {}),
        },
      },
      jobs,
      savedJobs,
      jobFeed: { ...fallback.jobFeed, ...(stored.jobFeed || {}) },
      runtime: { mode: "local", connection: "LOCAL_FALLBACK", message: "Local mode · data stays in this browser" },
    };
  } catch {
    return fallback;
  }
}

function withLocalRuntime(state: ProductState): ProductState {
  return { ...state, runtime: { mode: "local", connection: "LOCAL_FALLBACK", message: "Local mode · data stays in this browser" } };
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProductState>(() => initialProductState());
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshApi = useCallback(async () => {
    const next = await loadApiProductState();
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (apiConfigured()) {
        try {
          let next = await loadApiProductState();
          if (next.onboarding.complete && next.jobFeed.stale) {
            await apiRequest("/jobs/feed/rebuild", { method: "POST", body: JSON.stringify({ limit: 20 }) });
            next = await loadApiProductState();
          }
          if (active) setState(next);
        } catch (reason) {
          if (active) {
            setState(withLocalRuntime(loadLocalState()));
            setError(`Local backend unavailable. Your draft is safe in this browser. ${reason instanceof Error ? reason.message : ""}`.trim());
          }
        }
      } else if (active) {
        setState(withLocalRuntime(loadLocalState()));
      }
      if (active) setHydrated(true);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || state.runtime.mode !== "local") return;
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const run = useCallback(async <T,>(label: string, operation: () => Promise<T>): Promise<T> => {
    setBusy(label);
    setError(null);
    try { return await operation(); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : "Something went wrong.";
      setError(message);
      throw reason;
    } finally { setBusy(null); }
  }, []);

  const saveIntent = useCallback((input: IntentInput) => run("Saving your goal", async () => {
    if (state.runtime.mode === "api") {
      await apiRequest("/onboarding/intent", { method: "PUT", body: JSON.stringify(input) });
      await refreshApi();
      return;
    }
    setState((current) => ({
      ...current,
      profile: { ...current.profile, ...input },
      searchProfile: { ...current.searchProfile, targetRoles: input.targetRoles,
        profileVersion: current.searchProfile.profileVersion + 1 },
      onboarding: { ...current.onboarding, status: "INTENT_SAVED", lastStep: "resume", intentReviewed: true, searchReadiness: 25 },
    }));
  }), [refreshApi, run, state.runtime.mode]);

  const uploadResume = useCallback((file: File) => run("Reading your resume", async () => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Please upload a PDF resume.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Resume must be 10 MB or smaller.");
    if (state.runtime.mode === "api") {
      const body = new FormData();
      body.append("resume", file);
      const result = await apiRequest<{ profilePreview?: ResumeProfilePreview | null }>("/onboarding/resume", { method: "POST", body });
      await refreshApi();
      return { profilePreview: result.profilePreview || null };
    }
    const resume = {
      id: `local-resume-${Date.now()}`,
      fileName: file.name,
      pageCount: null,
      parseConfidence: null,
      status: "REVIEW" as const,
      uploadedAt: new Date().toISOString(),
      warning: "Browser-local mode stores the file name only. Connect the local backend for PDF extraction.",
    };
    setState((current) => ({
      ...current,
      resume,
      onboarding: { ...current.onboarding, status: "RESUME_REVIEW", lastStep: "verify" },
    }));
    return { profilePreview: null, warning: resume.warning };
  }), [refreshApi, run, state.runtime.mode]);

  const skipResume = useCallback(() => run("Preparing manual profile", async () => {
    if (state.runtime.mode === "api") {
      await apiRequest("/onboarding/resume/skip", { method: "POST" });
      await refreshApi();
      return;
    }
    setState((current) => ({
      ...current,
      resume: { id: `skipped-${Date.now()}`, fileName: "No resume yet", pageCount: null, parseConfidence: null, status: "SKIPPED", uploadedAt: new Date().toISOString() },
      onboarding: { ...current.onboarding, status: "MANUAL_PROFILE", lastStep: "verify", resumeSkipped: true },
    }));
  }), [refreshApi, run, state.runtime.mode]);

  const confirmResume = useCallback((input: VerifiedProfileInput) => run("Saving verified facts", async () => {
    if (state.runtime.mode === "api") {
      if (state.resume && state.resume.status !== "SKIPPED") {
        await apiRequest(`/onboarding/resume/${state.resume.id}/confirm`, { method: "POST", body: JSON.stringify({ profile: input }) });
      } else {
        await apiRequest("/onboarding/manual-profile", { method: "PUT", body: JSON.stringify(input) });
      }
      await refreshApi();
      return;
    }
    setState((current) => ({
      ...current,
      profile: { ...current.profile, ...input },
      resume: current.resume ? { ...current.resume, status: current.resume.status === "SKIPPED" ? "SKIPPED" : "CONFIRMED" } : null,
      onboarding: { ...current.onboarding, status: "PROFILE_VERIFIED", lastStep: "search", resumeReviewed: true, searchReadiness: 50 },
      readiness: { ...current.readiness, label: "Profile foundation ready", knownFieldCount: 8 },
    }));
  }), [refreshApi, run, state.resume, state.runtime.mode]);

  const saveSearch = useCallback((input: SearchInput) => run("Building your search", async () => {
    if (state.runtime.mode === "api") {
      await apiRequest("/onboarding/search", { method: "PUT", body: JSON.stringify(input) });
      await refreshApi();
      return;
    }
    setState((current) => ({
      ...current,
      profile: { ...current.profile, ...input },
      searchProfile: {
        ...current.searchProfile,
        preferredLocations: input.preferredLocations,
        preferredWorkModes: input.preferredWorkModes.map((value) => value.toUpperCase()) as ProductState["searchProfile"]["preferredWorkModes"],
        employmentTypes: input.employmentTypes.map((value) => value.replace(/-/g, "_").toUpperCase()) as ProductState["searchProfile"]["employmentTypes"],
        minimumSalary: input.minimumSalary,
        excludedSkills: input.excludedSkills,
        excludedCompanies: input.excludedCompanies,
        dealBreakers: input.dealBreakers,
        profileVersion: current.searchProfile.profileVersion + 1,
      },
      onboarding: { ...current.onboarding, status: "SEARCH_READY", lastStep: "value", searchReviewed: true, searchReadiness: 100 },
    }));
  }), [refreshApi, run, state.runtime.mode]);

  const completeOnboarding = useCallback(() => run("Finding your first jobs", async () => {
    if (state.runtime.mode === "api") {
      await apiRequest("/onboarding/complete", { method: "POST" });
      await refreshApi();
      return;
    }
    setState((current) => ({
      ...current,
      onboarding: { ...current.onboarding, status: "ACTIVE", lastStep: "value", complete: true, valueShown: true },
      readiness: { ...current.readiness, label: "Profile foundation ready", knownFieldCount: 11 },
    }));
  }), [refreshApi, run, state.runtime.mode]);

  const refreshJobFeed = useCallback(() => run("Refreshing your matches", async () => {
    if (state.runtime.mode !== "api") return;
    const response = await apiRequest<{ jobs: ProductJob[]; page: {
      nextCursor: string | null; hasMore: boolean; total: number;
    }; feed: {
      status: ProductState["jobFeed"]["status"]; stale: boolean; staleReasons?: string[];
      generationId: string | null; builtAt: string | null; durationMs?: number | null;
    } }>("/jobs/feed/rebuild", { method: "POST", body: JSON.stringify({ limit: 20 }) });
    setState((current) => ({
      ...current,
      jobs: response.jobs,
      jobFeed: {
        status: response.feed.status,
        stale: response.feed.stale,
        staleReasons: response.feed.staleReasons || [],
        generationId: response.feed.generationId,
        builtAt: response.feed.builtAt,
        durationMs: response.feed.durationMs ?? null,
        total: response.page.total,
        nextCursor: response.page.nextCursor,
        hasMore: response.page.hasMore,
      },
    }));
  }), [run, state.runtime.mode]);

  const loadMoreJobs = useCallback(() => run("Loading more matches", async () => {
    if (state.runtime.mode !== "api" || !state.jobFeed.nextCursor) return;
    const response = await apiRequest<{ jobs: ProductJob[]; page: {
      nextCursor: string | null; hasMore: boolean; total: number;
    } }>(`/jobs/feed?limit=20&cursor=${encodeURIComponent(state.jobFeed.nextCursor)}`);
    setState((current) => {
      const known = new Set(current.jobs.map((job) => job.id));
      return {
        ...current,
        jobs: [...current.jobs, ...response.jobs.filter((job) => !known.has(job.id))],
        jobFeed: { ...current.jobFeed, total: response.page.total,
          nextCursor: response.page.nextCursor, hasMore: response.page.hasMore },
      };
    });
  }), [run, state.jobFeed.nextCursor, state.runtime.mode]);

  const saveJob = useCallback((jobId: string) => run("Saving job", async () => {
    const job = state.jobs.find((item) => item.id === jobId) || state.savedJobs.find((item) => item.id === jobId);
    if (!job) return;
    if (state.runtime.mode === "api") {
      await apiRequest(`/jobs/${jobId}/state`, { method: "PUT", body: JSON.stringify({ saved: !job.saved }) });
      await refreshApi();
      return;
    }
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((item) => item.id === jobId ? { ...item, saved: !job.saved } : item),
      savedJobs: job.saved
        ? current.savedJobs.filter((item) => item.id !== jobId)
        : [{ ...job, saved: true }, ...current.savedJobs.filter((item) => item.id !== jobId)],
    }));
  }), [refreshApi, run, state.jobs, state.savedJobs, state.runtime.mode]);

  const dismissJob = useCallback((jobId: string) => run("Dismissing job", async () => {
    if (state.runtime.mode === "api") {
      await apiRequest(`/jobs/${jobId}/state`, { method: "PUT", body: JSON.stringify({ dismissed: true }) });
      await refreshApi();
      return;
    }
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((job) => job.id === jobId ? { ...job, dismissed: true } : job),
    }));
  }), [refreshApi, run, state.runtime.mode]);

  const markJobSeen = useCallback(async (jobId: string) => {
    if (state.runtime.mode === "api") {
      await apiRequest(`/jobs/${jobId}/state`, { method: "PUT", body: JSON.stringify({ seen: true }) });
      return;
    }
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((job) => job.id === jobId
        ? { ...job, personalState: { ...(job.personalState || {
          saved: Boolean(job.saved), dismissed: Boolean(job.dismissed), hasMaterialUpdate: false,
          currentMatchVersion: 1, seenMatchVersion: null, savedMatchVersion: null,
          dismissedMatchVersion: null, seenAt: null, savedAt: null, dismissedAt: null,
        }), seen: true, seenAt: new Date().toISOString(), seenMatchVersion: job.personalState?.currentMatchVersion || 1 } }
        : job),
    }));
  }, [state.runtime.mode]);

  const startApplication = useCallback((job: ProductJob) => run("Preparing application", async () => {
    if (state.runtime.mode === "api") {
      await apiRequest(`/jobs/${job.id}/applications`, { method: "POST" });
      await refreshApi();
      return;
    }
    setState((current) => {
      if (current.applications.some((application) => application.jobId === job.id)) return current;
      return {
        ...current,
        applications: [{
          id: `local-application-${Date.now()}`,
          jobId: job.id,
          company: job.company,
          role: job.role,
          url: job.url,
          stage: "Ready to open",
          status: "QUEUED",
          matchScore: job.matchScore,
          pendingQuestions: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          nextAction: "Open the employer form with Copilot",
        }, ...current.applications],
      };
    });
  }), [refreshApi, run, state.runtime.mode]);

  const claimJobAvailability = useCallback(async (jobId: string) => {
    if (state.runtime.mode !== "api") return null;
    const response = await apiRequest<{ prompt: AvailabilityPrompt | null }>(
      `/jobs/${jobId}/availability-verification/claim`, { method: "POST" }
    );
    return response.prompt;
  }, [state.runtime.mode]);

  const reportJobAvailability = useCallback((jobId: string, input: {
    requestId: string;
    result: "OPEN" | "CLOSED" | "UNCERTAIN";
    evidenceCode?: "NONE" | "APPLY_CONTROL_AVAILABLE";
  }) => run("Saving availability", async () => {
    if (state.runtime.mode !== "api") return null;
    const response = await apiRequest<{ availability: JobAvailability }>(
      `/jobs/${jobId}/availability-feedback`, { method: "POST", body: JSON.stringify(input) }
    );
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((job) => job.id === jobId ? { ...job, availability: response.availability } : job),
    }));
    return response.availability;
  }), [run, state.runtime.mode]);

  const resolveGap = useCallback((key: string, value: string) => run("Saving answer", async () => {
    if (!value.trim()) throw new Error("Enter an answer before saving.");
    if (state.runtime.mode === "api") {
      await apiRequest(`/attention/gaps/${encodeURIComponent(key)}/resolve`, { method: "POST", body: JSON.stringify({ value }) });
      await refreshApi();
      return;
    }
    const patch: Partial<CandidateProfile> = key === "CURRENT_CTC" ? { currentCTC: Number(value) }
      : key === "EXPECTED_CTC" ? { expectedCTC: Number(value) }
        : key === "NOTICE_PERIOD" ? { noticePeriodDays: Number(value) }
          : key === "WORK_AUTHORIZATION" ? { workAuthorization: value } : {};
    setState((current) => ({
      ...current,
      profile: { ...current.profile, ...patch },
      attention: { ...current.attention, gaps: current.attention.gaps.filter((gap) => gap.canonicalFieldKey !== key) },
      readiness: { ...current.readiness, knownFieldCount: current.readiness.knownFieldCount + 1 },
    }));
  }), [refreshApi, run, state.runtime.mode]);

  const updateProfile = useCallback((patch: Partial<CandidateProfile>) => run("Saving profile", async () => {
    if (state.runtime.mode === "api") {
      await apiRequest("/profile", { method: "PUT", body: JSON.stringify(patch) });
      await refreshApi();
      return;
    }
    setState((current) => {
      const searchChanged = [
        "targetRoles", "primaryCoreStacks", "acceptableCoreStacks", "adjacentCareerTracks",
        "desiredSeniorityLevels", "preferredSkills", "excludedSkills", "preferredLocations",
        "preferredWorkModes", "employmentTypes", "minimumSalary", "excludedCompanies", "dealBreakers",
        "compensationConstraintMode", "locationConstraintMode", "workModeConstraintMode",
        "employmentTypeConstraintMode", "experienceTolerance", "searchCountryCode", "workAuthorization",
        "sponsorshipNeed", "relocationPreference",
      ].some((key) => Object.hasOwn(patch, key));
      return {
        ...current,
        profile: { ...current.profile, ...patch },
        searchProfile: {
          ...current.searchProfile,
          ...(patch.targetRoles ? { targetRoles: patch.targetRoles } : {}),
          ...(patch.primaryCoreStacks ? { primaryCoreStacks: patch.primaryCoreStacks } : {}),
          ...(patch.acceptableCoreStacks ? { acceptableCoreStacks: patch.acceptableCoreStacks } : {}),
          ...(patch.adjacentCareerTracks ? { adjacentCareerTracks: patch.adjacentCareerTracks } : {}),
          ...(patch.desiredSeniorityLevels ? { desiredSeniorityLevels: patch.desiredSeniorityLevels } : {}),
          ...(patch.preferredSkills ? { preferredSkills: patch.preferredSkills } : {}),
          ...(patch.excludedSkills ? { excludedSkills: patch.excludedSkills } : {}),
          ...(patch.preferredLocations ? { preferredLocations: patch.preferredLocations } : {}),
          ...(patch.preferredWorkModes ? { preferredWorkModes: patch.preferredWorkModes.map((value) => value.toUpperCase()) as ProductState["searchProfile"]["preferredWorkModes"] } : {}),
          ...(patch.employmentTypes ? { employmentTypes: patch.employmentTypes.map((value) => value.replace(/-/g, "_").toUpperCase()) as ProductState["searchProfile"]["employmentTypes"] } : {}),
          ...(patch.minimumSalary !== undefined ? { minimumSalary: patch.minimumSalary } : {}),
          ...(patch.excludedCompanies ? { excludedCompanies: patch.excludedCompanies } : {}),
          ...(patch.dealBreakers ? { dealBreakers: patch.dealBreakers } : {}),
          ...(patch.compensationConstraintMode ? { compensationConstraintMode: patch.compensationConstraintMode } : {}),
          ...(patch.locationConstraintMode ? { locationConstraintMode: patch.locationConstraintMode } : {}),
          ...(patch.workModeConstraintMode ? { workModeConstraintMode: patch.workModeConstraintMode } : {}),
          ...(patch.employmentTypeConstraintMode ? { employmentTypeConstraintMode: patch.employmentTypeConstraintMode } : {}),
          ...(patch.experienceTolerance ? { experienceTolerance: patch.experienceTolerance } : {}),
          ...(patch.searchCountryCode ? { countryCode: patch.searchCountryCode } : {}),
          ...(patch.workAuthorization ? { workAuthorization: patch.workAuthorization as ProductState["searchProfile"]["workAuthorization"] } : {}),
          ...(patch.sponsorshipNeed ? { sponsorshipNeed: patch.sponsorshipNeed } : {}),
          ...(patch.relocationPreference ? { relocationPreference: patch.relocationPreference } : {}),
          profileVersion: searchChanged ? current.searchProfile.profileVersion + 1 : current.searchProfile.profileVersion,
        },
      };
    });
  }), [refreshApi, run, state.runtime.mode]);

  const resetLocalWorkspace = useCallback(() => {
    if (state.runtime.mode !== "local") return;
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    setState(withLocalRuntime(initialProductState()));
    setError(null);
  }, [state.runtime.mode]);

  const value = useMemo<ProductContextValue>(() => ({
    state, hydrated, busy, error, clearError: () => setError(null), saveIntent, uploadResume,
    skipResume, confirmResume, saveSearch, completeOnboarding, refreshJobFeed, loadMoreJobs, saveJob, dismissJob, markJobSeen,
    startApplication, claimJobAvailability, reportJobAvailability, resolveGap, updateProfile, resetLocalWorkspace,
  }), [state, hydrated, busy, error, saveIntent, uploadResume, skipResume, confirmResume, saveSearch,
    completeOnboarding, refreshJobFeed, loadMoreJobs, saveJob, dismissJob, markJobSeen, startApplication, claimJobAvailability, reportJobAvailability,
    resolveGap, updateProfile, resetLocalWorkspace]);

  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useProduct() {
  const context = useContext(ProductContext);
  if (!context) throw new Error("useProduct must be used inside ProductProvider.");
  return context;
}
