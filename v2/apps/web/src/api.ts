const API_URL = (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://127.0.0.1:3100";

export interface LearningNoteInput {
  canonicalKey: string; answer: string; expectedCurrentVersionId: string | null; confirmedGlobalDefault: boolean;
  scope?: "GLOBAL"|"APPLICATION"; otherLabel?:string;
  currency?: string; scale?: string; period?: string; unit?: string;
}
export interface SupportGrant { id:string;caseId:string;issuer:string;subject:string;purpose:string;expiresAt:string|null;status:string }

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

async function responseData(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export class CandidateApi {
  reviewedArtifacts(caseId:string){return this.request<{strategyKeys:string[];state:{revision:number;disabled:boolean;current_id:string|null};artifacts:Array<{id:string;strategy_key:string;artifact_hash:string;issuer:string;subject:string;evaluation:{id:string;passed:boolean;live:boolean;result_hash:string;suite_hash:string}|null;approvals:Array<{id:string;evaluation_id:string}>}>}>(`/v1/operator/cases/${encodeURIComponent(caseId)}/artifacts`);}
  proposeReviewed(caseId:string,strategyKey:string){return this.request("/v1/operator/artifacts",{method:"POST",body:JSON.stringify({requestId:crypto.randomUUID(),caseId,strategyKey,apiProtocol:1,extensionProtocol:1})});}
  approveReviewed(artifactId:string,artifactHash:string,evaluationId:string){return this.request("/v1/operator/artifacts/approve",{method:"POST",body:JSON.stringify({requestId:crypto.randomUUID(),artifactId,artifactHash,evaluationId,confirmed:true})});}
  prepareReviewed(artifactId:string,approvalId:string,expectedRevision:number){return this.request("/v1/operator/exports/prepare",{method:"POST",body:JSON.stringify({requestId:crypto.randomUUID(),artifactId,approvalId,expectedRevision,confirmed:true})});}
  controlReviewed(action:"DISABLE"|"ROLLBACK",expectedRevision:number){return this.request("/v1/operator/exports/control",{method:"POST",body:JSON.stringify({requestId:crypto.randomUUID(),action,expectedRevision})});}
  reviewedManifest(){return this.request<Record<string,unknown>>("/v1/operator/exports/manifest?apiProtocol=1&extensionProtocol=1");}
  requestSupport(caseId:string,purpose:string,requestId:string) { return this.request<SupportGrant>("/v1/operator/support",{method:"POST",body:JSON.stringify({caseId,purpose,requestId})}); }
  operatorSupport(caseId:string) { return this.request<{grants:SupportGrant[]}>(`/v1/operator/cases/${encodeURIComponent(caseId)}/support`); }
  readSupport(id:string) { return this.request<{grantId:string;expiresAt:string;evidence:{question:string;answer:string}}>(`/v1/operator/support/${encodeURIComponent(id)}/read`,{method:"POST",body:"{}"}); }
  previewSupport(id:string,itemId:string) { return this.request<SupportGrant>(`/v1/support/${encodeURIComponent(id)}/preview`,{method:"POST",body:JSON.stringify({itemId})}); }
  approveSupport(id:string,itemId:string,durationMinutes:15|60) { return this.request<SupportGrant>(`/v1/support/${encodeURIComponent(id)}/approve`,{method:"POST",body:JSON.stringify({itemId,durationMinutes,confirmed:true})}); }
  revokeSupport(id:string) { return this.request(`/v1/support/${encodeURIComponent(id)}/revoke`,{method:"POST",body:"{}"}); }
  noteSupport(itemId:string) { return this.request<{grants:SupportGrant[]}>(`/v1/learning/inbox/${encodeURIComponent(itemId)}/support`); }
  operatorDetail(caseId: string) { return this.request<{id:string;revision:number;layer:string;reproduction:string;expectedBehavior:string;mergedInto?:string|null;members?:Array<{id:string;release:string;stage:string;code:string}>;timeline:Array<{action:string;at:string;revision:number|null;status:string|null;caseId?:string}>}>(`/v1/operator/cases/${encodeURIComponent(caseId)}`); }
  operatorMerge(caseId:string,input:{requestId:string;targetCaseId:string;expectedSourceRevision:number;expectedTargetRevision:number;confirmed:true}) {return this.request(`/v1/operator/cases/${encodeURIComponent(caseId)}/merge`,{method:"POST",body:JSON.stringify(input)});}
  operatorEdit(caseId: string, input: {requestId:string;expectedRevision:number;layer:string;reproduction:string;expectedBehavior:string}) { return this.request(`/v1/operator/cases/${encodeURIComponent(caseId)}/review`,{method:"POST",body:JSON.stringify(input)}); }
  operatorCases() { return this.request<{ cases: Array<{ id: string; release: string; stage: string; code: string; status: string; revision: number; affectedRuns: number;assigneeIssuer?:string|null;assigneeSubject?:string|null }> }>("/v1/operator/cases"); }
  operatorAssign(caseId:string,expectedRevision:number,action:"CLAIM"|"RELEASE"|"ADMIN_RELEASE",requestId:string) {return this.request(`/v1/operator/cases/${encodeURIComponent(caseId)}/assignment`,{method:"POST",body:JSON.stringify({expectedRevision,action,requestId})});}
  operatorTransition(caseId: string, expectedRevision: number, status: string, requestId: string) { return this.request(`/v1/operator/cases/${encodeURIComponent(caseId)}/status`, { method: "POST", body: JSON.stringify({ expectedRevision, status, requestId }) }); }
  confirmLearningNote(itemId: string, input: LearningNoteInput) { return this.request<{ changeSetId: string; idempotentReplay: boolean }>(`/v1/learning/inbox/${encodeURIComponent(itemId)}/confirm`, { method: "POST", body: JSON.stringify(input) }); }
  previewLearningNote(itemId: string, input: LearningNoteInput) { return this.request<{ display: string; scope: "GLOBAL"|"APPLICATION"; applicationId:string|null; currentValue:NormalizedValue|null; expectedCurrentVersionId:string|null }>(`/v1/learning/inbox/${encodeURIComponent(itemId)}/preview`, { method: "POST", body: JSON.stringify(input) }); }
  learningInbox(cursor?: string) { return this.request<{ nextCursor: string | null; items: Array<{ itemId: string; status: string; expiresAt: string; evidence: { question: string; answer: string; source: string } | null }> }>(`/v1/learning/inbox${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); }
  deleteLearningInboxItem(itemId: string) { return this.request(`/v1/learning/inbox/${encodeURIComponent(itemId)}`, { method: "DELETE" }); }
  learningOutcomes() { return this.request<{ groups: Array<{ stage: string; code: string; affected_runs: number }>; denominator: string }>("/v1/learning/outcomes"); }
  constructor(private readonly token: () => string | null) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.token();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
    const data = await responseData(response) as { error?: { message?: string; code?: string } } | null;
    if (!response.ok) throw new ApiError(
      data?.error?.message ?? "The request could not be completed.",
      data?.error?.code ?? "REQUEST_FAILED",
      response.status
    );
    return data as T;
  }

  bootstrap() { return this.request<SessionResponse>("/v1/auth/bootstrap", { method: "POST" }); }
  logout() { return this.request<null>("/v1/auth/logout", { method: "POST" }); }
  profile() { return this.request<ProfileSnapshot>("/v1/profile"); }
  readiness() { return this.request<Readiness>("/v1/onboarding/readiness"); }
  review() { return this.request<ResumeReview>("/v1/onboarding/resume/review"); }
  history() { return this.request<{ entries: HistoryEntry[] }>("/v1/profile/history?limit=100"); }
  documents() { return this.request<{ documents: CandidateDocument[] }>("/v1/documents"); }
  editableDocument(documentId: string) { return this.request<{ draft: EditableDocumentDraft }>(`/v1/documents/${documentId}/draft`); }
  reviseDocument(documentId: string, draft: EditableDocumentDraft, template: "CLASSIC" | "COMPACT", key: string) {
    return this.request<{ document: CandidateDocument }>(`/v1/documents/${documentId}/draft`, { method: "PUT", headers: { "x-idempotency-key": key }, body: JSON.stringify({ draft, template }) });
  }
  async downloadDocument(documentId: string): Promise<Blob> {
    const token = this.token();
    const response = await fetch(`${API_URL}/v1/documents/${documentId}/download`, {
      headers: token ? { authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
      const data = await responseData(response) as { error?: { message?: string; code?: string } } | null;
      throw new ApiError(data?.error?.message ?? "Document download failed.", data?.error?.code ?? "DOCUMENT_DOWNLOAD_FAILED", response.status);
    }
    return response.blob();
  }
  generateDocument(jobId: string, type: "TAILORED_RESUME" | "COVER_LETTER", strength: "LIGHT" | "FOCUSED", key: string, template: "CLASSIC" | "COMPACT" = "CLASSIC") {
    return this.request<{ document: CandidateDocument }>("/v1/documents/generate", {
      method: "POST", headers: { "x-idempotency-key": key },
      body: JSON.stringify({ jobId, type, strength, template })
    });
  }
  approveDocument(documentId: string, key: string) {
    return this.request<{ document: CandidateDocument; replay: boolean }>(`/v1/documents/${documentId}/approve`, {
      method: "POST", headers: { "x-idempotency-key": key }
    });
  }
  reversals() { return this.request<{ reversals: Reversal[] }>("/v1/profile/reversals"); }
  jobs(input: { query?: string; roleFamily?: string; workMode?: string; countryCode?: string; limit?: number; cursor?: string } = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") query.set(key, String(value));
    return this.request<JobPage>(`/v1/jobs${query.size ? `?${query}` : ""}`);
  }
  job(jobId: string) { return this.request<JobResult>(`/v1/jobs/${jobId}`); }
  searchProfile() { return this.request<SearchProfile>("/v1/job-search/profile"); }
  saveSearchProfile(expectedVersion: number, preferences: SearchPreferences, key: string) {
    return this.request<SearchProfile>("/v1/job-search/profile", {
      method: "PUT", headers: { "x-idempotency-key": key },
      body: JSON.stringify({ expectedVersion, preferences })
    });
  }

  uploadResume(file: File, idempotencyKey: string, progress: (percent: number) => void): Promise<{ document: { id: string } }> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", `${API_URL}/v1/onboarding/resume`);
      const token = this.token();
      if (token) request.setRequestHeader("authorization", `Bearer ${token}`);
      request.setRequestHeader("x-idempotency-key", idempotencyKey);
      request.upload.onprogress = (event) => event.lengthComputable && progress(Math.round(event.loaded / event.total * 100));
      request.onerror = () => reject(new Error("Resume upload failed. Check your connection and retry."));
      request.onload = () => {
        const data = JSON.parse(request.responseText || "null") as { document?: { id: string }; error?: { message?: string; code?: string } } | null;
        if (request.status < 200 || request.status >= 300 || !data?.document) {
          reject(new ApiError(data?.error?.message ?? "Resume upload failed.", data?.error?.code ?? "UPLOAD_FAILED", request.status));
        } else resolve({ document: data.document });
      };
      const body = new FormData();
      body.append("resume", file);
      request.send(body);
    });
  }

  extract(documentId: string, key: string) {
    return this.request<ResumeReview>(`/v1/onboarding/resume/${documentId}/extract`, {
      method: "POST", headers: { "x-idempotency-key": key }
    });
  }
  confirm(body: unknown, key: string) {
    return this.request<{ changeSetId: string | null }>("/v1/onboarding/review/confirm", {
      method: "POST", headers: { "x-idempotency-key": key }, body: JSON.stringify(body)
    });
  }
  saveProfile(items: unknown[], key: string) {
    return this.request<{ changeSetId: string }>("/v1/profile", {
      method: "PUT", headers: { "x-idempotency-key": key }, body: JSON.stringify({ items })
    });
  }
  complete(version: number, key: string) {
    return this.request<{ onboardingVersion: number }>("/v1/onboarding/complete", {
      method: "POST", headers: { "x-idempotency-key": key },
      body: JSON.stringify({ expectedOnboardingVersion: version })
    });
  }
  undo(changeSetId: string, key: string) {
    return this.request<Reversal>(`/v1/profile/changes/${changeSetId}/undo`, {
      method: "POST", headers: { "x-idempotency-key": key }
    });
  }
  restore(versionId: string, expectedCurrentVersionId: string | null, key: string) {
    return this.request<Reversal>(`/v1/profile/versions/${versionId}/restore`, {
      method: "POST", headers: { "x-idempotency-key": key },
      body: JSON.stringify({ expectedCurrentVersionId })
    });
  }
}

export interface SessionResponse {
  email: string | null;
  candidate: { id: string; new: boolean };
  onboarding: { stage: "WELCOME" | "RESUME" | "REVIEW" | "PROFILE" | "READY"; completed: boolean; version: number };
}

export interface NormalizedValue { kind: string; [key: string]: unknown }
export interface ProfileAnswer {
  answerVersionId: string; changeSetId: string; canonicalKey: string; label: string; section: string;
  entityId: string | null; entityType: string | null; scopeType: string; normalizedValue: NormalizedValue;
  scope?: { jobId?: string; applicationId?: string; companyId?: string; countryCode?: string; roleFamily?: string };
  trustState: string; source: string; freshness: { state: string; reason: string }; createdAt: string;
}
export interface ProfileSnapshot {
  answers: ProfileAnswer[]; pendingResumeItems: number; conflictingResumeItems: number;
  onboardingVersion: number; onboardingCompleted: boolean;
}
export interface Readiness {
  ready: boolean; needsConfirmation: number; staleItems: number; conflicts: number;
  requirements: { key: string; label: string; met: boolean; blocking: boolean; reason: string }[];
}
export interface Proposal {
  id: string; field: string; value: NormalizedValue; confidence: number;
  comparison: "NEW" | "MATCH" | "CONFLICT" | "AMBIGUOUS" | "REPEATABLE_ENTITY_MATCH" | "REPEATABLE_ENTITY_NEW" | "UNSUPPORTED"; decision: string;
  sourceSection: "HEADER" | "SUMMARY" | "SKILLS" | "EXPERIENCE" | "EDUCATION" | "PROJECTS" | "CERTIFICATIONS" | "AWARDS" | "OTHER" | "UPLOAD";
}
export interface ResumeReview {
  document: { id: string; fileName: string; byteSize: number; createdAt: string };
  extraction: { id: string; status: string; attempt: number; errorCode: string | null } | null;
  proposals: Proposal[];
}
export interface HistoryEntry extends ProfileAnswer {
  current: boolean; supersedesVersionId: string | null; restoresVersionId: string | null;
}
export interface Reversal {
  reversalSetId: string; summary: { restored: number; forgotten: number; skippedNewerVersion: number };
  items: { canonicalKey: string; outcome: string; compensatingVersionId: string | null }[];
}
export interface EditableDocumentDraft { title: string; titleSourceClaimIds: string[]; blocks: { kind: "HEADING" | "PARAGRAPH" | "BULLET"; text: string; sourceClaimIds: string[] }[] }
export interface CandidateDocument {
  id: string;
  type: "MASTER_RESUME" | "TAILORED_RESUME" | "COVER_LETTER" | "APPLICATION_ATTACHMENT" | "DIAGNOSTIC";
  version: number;
  status: string;
  fileName: string | null;
  mimeType: string;
  byteSize: number;
  sourceDocumentId: string | null;
  jobId: string | null;
  applicationId: string | null;
  isCurrentMaster: boolean;
  failureCode: string | null;
  createdAt: string;
  readyAt: string | null;
  uses: { applicationId: string; applicationRunId: string; documentKind: "RESUME" | "COVER_LETTER"; selectedAt: string }[];
}

export interface JobReason { code: string; message: string; evidence: string[] }
export interface JobResult {
  id: string; company: string; title: string; description: string; roleFamily: string;
  seniority: string; location: string | null; countryCodes: string[]; workMode: string | null;
  employmentType: string | null; compensation: {
    minimumMinor: number | null; maximumMinor: number | null; currency: string; period: string | null;
  } | null;
  skills: { required: { key: string; label: string }[]; preferred: { key: string; label: string }[] };
  applicationUrl: string; ats: string | null;
  freshness: { state: "FRESH" | "AGING" | "STALE"; verifiedAt: string | null };
  match: {
    policyVersion: string; label: "STRONG_MATCH" | "GOOD_MATCH" | "POSSIBLE_MATCH" | "LOW_MATCH";
    score: number; eligibility: "ELIGIBLE" | "UNKNOWN";
    reasons: JobReason[]; gaps: JobReason[]; unknowns: JobReason[];
  };
}
export interface JobPage { items: JobResult[]; nextCursor: string | null; catalogTruncated: boolean; policyVersion: string }
export interface SearchPreferences {
  version: 1; targetRoleFamilies: string[]; acceptableRoleFamilies: string[];
  preferredWorkModes: string[]; preferredCountryCodes: string[]; excludedCompanyNames: string[];
  minimumCompensationMinor: number | null; compensationCurrencyCode: string | null;
  dealBreakers: { mandatoryRelocation: boolean; nightShift: boolean; heavyTravel: boolean; employmentBond: boolean };
}
export interface SearchProfile { candidateId: string; version: number; preferences: SearchPreferences; updatedAt: string | null; idempotentReplay?: boolean }

export function idempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}
