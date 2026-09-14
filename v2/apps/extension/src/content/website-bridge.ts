import { AuthRuntimeStateSchema, ExtensionResponseSchema, type RuntimeStatus } from "../shared/contracts.js";
import type { BackgroundMessenger } from "./messaging.js";

const WebsiteRequestSchema = {
  parse(value: unknown): { type: "JOB_HUNTER_WEB_PROBE" | "JOB_HUNTER_SESSION_OFFER" | "JOB_HUNTER_LAUNCH_APPLICATION"; nonce: string; accessToken?: string; jobId?: string; applicationUrl?: string } | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (record.source !== "JOB_HUNTER_WEB" || typeof record.nonce !== "string" || record.nonce.length < 16 || record.nonce.length > 160) return null;
    if (!(["JOB_HUNTER_WEB_PROBE", "JOB_HUNTER_SESSION_OFFER", "JOB_HUNTER_LAUNCH_APPLICATION"] as const).includes(record.type as never)) return null;
    if (record.type === "JOB_HUNTER_SESSION_OFFER" && (typeof record.accessToken !== "string" || record.accessToken.length < 16 || record.accessToken.length > 8_192)) return null;
    if (record.type === "JOB_HUNTER_LAUNCH_APPLICATION" && (typeof record.jobId !== "string" || typeof record.applicationUrl !== "string")) return null;
    return record as ReturnType<typeof WebsiteRequestSchema.parse>;
  }
};

function publicStatus(status: RuntimeStatus | null): Record<string, unknown> {
  return {
    installed: true,
    extensionVersion: __JH_EXTENSION_VERSION__,
    protocolVersion: 1,
    authState: AuthRuntimeStateSchema.catch("NOT_AUTHENTICATED").parse(status?.authState),
    runtimeState: status?.runtimeState ?? null,
    siteAccess: status?.siteAccess ?? "NOT_APPLICABLE"
  };
}

function publishLaunchResult(payload: Record<string, unknown>): void {
  window.postMessage({
    source: "JOB_HUNTER_EXTENSION",
    type: "JOB_HUNTER_LAUNCH_RESULT",
    ...payload
  }, location.origin);
}

function launchButton(event: Event): HTMLElement | null {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-jh-copilot-launch]") : null;
  if (!target) return null;
  const jobId = target.getAttribute("data-job-id") ?? "";
  const applicationUrl = target.getAttribute("data-application-url") ?? "";
  return jobId && applicationUrl ? target : null;
}

export function installWebsiteBridge(messenger: BackgroundMessenger, getStatus: () => RuntimeStatus | null): () => void {
  if (!__JH_WEB_ORIGINS__.includes(location.origin) || window.top !== window) return () => undefined;
  const respondTo = (nonce: string, payload: Record<string, unknown>) => window.postMessage({
    source: "JOB_HUNTER_EXTENSION",
    type: "JOB_HUNTER_EXTENSION_STATUS",
    nonce,
    ...payload
  }, location.origin);

  const onWebsiteMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const request = WebsiteRequestSchema.parse(event.data);
    if (!request) return;
    if (request.type === "JOB_HUNTER_WEB_PROBE") { respondTo(request.nonce, publicStatus(getStatus())); return; }
    const operation = request.type === "JOB_HUNTER_SESSION_OFFER"
      ? messenger.request("WEB_SESSION_OFFER", { accessToken: request.accessToken ?? "", websiteOrigin: location.origin }, { dataClass: "CANDIDATE_PRIVATE" })
      : messenger.request("WEB_LAUNCH_REQUEST", { jobId: request.jobId ?? "", applicationUrl: request.applicationUrl ?? "", websiteOrigin: location.origin });
    void operation.then((raw) => {
      const response = ExtensionResponseSchema.parse(raw);
      if (!response.ok) { respondTo(request.nonce, { ...publicStatus(getStatus()), errorCode: response.payload.failure.code }); return; }
      if (response.type === "STATUS_RESPONSE" || response.type === "CONTENT_REGISTERED") respondTo(request.nonce, publicStatus(response.payload.status));
      else if (response.type === "LAUNCH_RESPONSE") respondTo(request.nonce, { ...publicStatus(getStatus()), launch: response.payload });
      else respondTo(request.nonce, publicStatus(getStatus()));
    }).catch(() => respondTo(request.nonce, { ...publicStatus(getStatus()), errorCode: "MESSAGE_SCHEMA_INVALID" }));
  };

  const onApplyClick = (event: Event): void => {
    const button = launchButton(event);
    if (!button || button.getAttribute("data-jh-launch-consumed") === "1") return;
    const jobId = button.getAttribute("data-job-id") ?? "";
    const applicationUrl = button.getAttribute("data-application-url") ?? "";
    button.setAttribute("data-jh-launch-consumed", "1");
    void messenger.request("WEB_LAUNCH_REQUEST", { jobId, applicationUrl, websiteOrigin: location.origin }).then((raw) => {
      const response = ExtensionResponseSchema.parse(raw);
      if (!response.ok) {
        publishLaunchResult({ errorCode: response.payload.failure.code, launch: null });
        return;
      }
      if (response.type === "LAUNCH_RESPONSE") publishLaunchResult({ errorCode: null, launch: response.payload });
      else publishLaunchResult({ errorCode: "LAUNCH_FAILED", launch: null });
    }).catch(() => {
      publishLaunchResult({ errorCode: "LAUNCH_FAILED", launch: null });
    }).finally(() => button.removeAttribute("data-jh-launch-consumed"));
  };

  window.addEventListener("message", onWebsiteMessage);
  document.addEventListener("click", onApplyClick, true);
  window.postMessage({ source: "JOB_HUNTER_EXTENSION", type: "JOB_HUNTER_EXTENSION_AVAILABLE", extensionVersion: __JH_EXTENSION_VERSION__, protocolVersion: 1 }, location.origin);
  return () => {
    window.removeEventListener("message", onWebsiteMessage);
    document.removeEventListener("click", onApplyClick, true);
  };
}
