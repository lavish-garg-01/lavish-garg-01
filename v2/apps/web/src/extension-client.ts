export type CopilotConnectionState =
  | "CONNECTING"
  | "NOT_INSTALLED"
  | "NOT_AUTHENTICATED"
  | "AUTHENTICATED_NO_CANDIDATE"
  | "READY"
  | "SESSION_EXPIRED"
  | "BACKEND_UNAVAILABLE"
  | "EXTENSION_UPDATE_REQUIRED"
  | "PERMISSION_REQUIRED"
  | "ERROR";

interface BridgeStatusMessage {
  source: "JOB_HUNTER_EXTENSION";
  type: "JOB_HUNTER_EXTENSION_STATUS";
  nonce: string;
  installed: true;
  extensionVersion: string;
  protocolVersion: number;
  authState: Exclude<CopilotConnectionState, "CONNECTING" | "NOT_INSTALLED" | "PERMISSION_REQUIRED" | "ERROR">;
  runtimeState: string | null;
  siteAccess: "NOT_APPLICABLE" | "REQUIRED" | "GRANTED";
  errorCode?: string;
  launch?: { state: "READY_TO_LAUNCH" | "PERMISSION_REQUIRED"; originPattern: string; tabId: number | null };
}

export interface CopilotConnection {
  state: CopilotConnectionState;
  extensionVersion: string | null;
  errorCode: string | null;
  originPattern: string | null;
}

const protocolVersion = 1;

export function isExtensionAvailableMessage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.source === "JOB_HUNTER_EXTENSION"
    && record.type === "JOB_HUNTER_EXTENSION_AVAILABLE"
    && typeof record.extensionVersion === "string"
    && record.protocolVersion === protocolVersion;
}

export function requiresSessionReconnect(state: CopilotConnectionState): boolean {
  return state === "SESSION_EXPIRED" || state === "NOT_AUTHENTICATED";
}

function isBridgeStatus(value: unknown, nonce: string): value is BridgeStatusMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.source === "JOB_HUNTER_EXTENSION"
    && record.type === "JOB_HUNTER_EXTENSION_STATUS"
    && record.nonce === nonce
    && record.installed === true
    && typeof record.extensionVersion === "string"
    && typeof record.protocolVersion === "number"
    && typeof record.authState === "string";
}

class ExtensionBridgeClient {
  private request(message: Record<string, unknown>, timeoutMs: number): Promise<BridgeStatusMessage | null> {
    const nonce = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
      const listener = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin || !isBridgeStatus(event.data, nonce)) return;
        cleanup();
        resolve(event.data);
      };
      const cleanup = () => { window.clearTimeout(timeout); window.removeEventListener("message", listener); };
      window.addEventListener("message", listener);
      window.postMessage({ source: "JOB_HUNTER_WEB", nonce, ...message }, window.location.origin);
    });
  }

  private connection(message: BridgeStatusMessage | null): CopilotConnection {
    if (!message) return { state: "NOT_INSTALLED", extensionVersion: null, errorCode: null, originPattern: null };
    if (message.protocolVersion !== protocolVersion) return { state: "EXTENSION_UPDATE_REQUIRED", extensionVersion: message.extensionVersion, errorCode: "PROTOCOL_VERSION_MISMATCH", originPattern: null };
    return {
      state: message.errorCode ? (message.errorCode === "AUTH_EXPIRED" ? "SESSION_EXPIRED" : "ERROR") : message.authState,
      extensionVersion: message.extensionVersion,
      errorCode: message.errorCode ?? null,
      originPattern: message.launch?.originPattern ?? null
    };
  }

  async probe(): Promise<CopilotConnection> {
    return this.connection(await this.request({ type: "JOB_HUNTER_WEB_PROBE" }, 900));
  }

  async connect(accessToken: string): Promise<CopilotConnection> {
    const installed = await this.probe();
    if (installed.state === "NOT_INSTALLED" || installed.state === "EXTENSION_UPDATE_REQUIRED") return installed;
    return this.connection(await this.request({ type: "JOB_HUNTER_SESSION_OFFER", accessToken }, 8_500));
  }

  async launch(job: { id: string; applicationUrl: string }): Promise<CopilotConnection> {
    const response = await this.request({ type: "JOB_HUNTER_LAUNCH_APPLICATION", jobId: job.id, applicationUrl: job.applicationUrl }, 5_000);
    const connection = this.connection(response);
    if (response?.launch?.tabId != null) return { ...connection, state: connection.state === "ERROR" ? connection.state : "READY", originPattern: response.launch.originPattern };
    if (response?.launch?.state === "PERMISSION_REQUIRED") return { ...connection, state: "PERMISSION_REQUIRED", originPattern: response.launch.originPattern };
    return connection;
  }

  waitForClickLaunch(timeoutMs = 8_000): Promise<CopilotConnection> {
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => { cleanup(); resolve({ state: "ERROR", extensionVersion: null, errorCode: "LAUNCH_TIMEOUT", originPattern: null }); }, timeoutMs);
      const listener = (event: MessageEvent) => {
        const value = event.data;
        if (event.source !== window || event.origin !== window.location.origin || !value || value.source !== "JOB_HUNTER_EXTENSION" || value.type !== "JOB_HUNTER_LAUNCH_RESULT") return;
        cleanup();
        const launch = value.launch as BridgeStatusMessage["launch"] | null;
        if (value.errorCode === "AUTH_EXPIRED") {
          resolve({ state: "SESSION_EXPIRED", extensionVersion: null, errorCode: "AUTH_EXPIRED", originPattern: launch?.originPattern ?? null });
          return;
        }
        if (launch?.tabId != null) {
          resolve({ state: "READY", extensionVersion: null, errorCode: null, originPattern: launch.originPattern });
          return;
        }
        if (launch?.state === "PERMISSION_REQUIRED") {
          resolve({ state: "PERMISSION_REQUIRED", extensionVersion: null, errorCode: null, originPattern: launch.originPattern });
          return;
        }
        resolve({ state: "ERROR", extensionVersion: null, errorCode: String(value.errorCode ?? "LAUNCH_FAILED"), originPattern: launch?.originPattern ?? null });
      };
      const cleanup = () => { window.clearTimeout(timeout); window.removeEventListener("message", listener); };
      window.addEventListener("message", listener);
    });
  }
}

export const extensionBridge = new ExtensionBridgeClient();
export const extensionInstallUrl = String(import.meta.env?.VITE_EXTENSION_INSTALL_URL ?? "").trim();
