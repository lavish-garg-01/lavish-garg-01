import type { JourneyEvidence } from "../shared/application-journey.js";

/** Guidance is page-local, isolated from the scanner, and never clicks employer actions. */
export class JourneyCard {
  private host: HTMLElement | null = null;
  private signature = "";
  constructor(private readonly inspect: () => void) {}
  remove(): void { this.host?.remove(); this.host = null; this.signature = ""; }
  render(evidence: JourneyEvidence): void {
    if (["UNRELATED", "JOB_LIST", "APPLICATION_FORM"].includes(evidence.stage)) { this.remove(); return; }
    const signature = JSON.stringify(evidence);
    if (this.host?.isConnected && this.signature === signature) return;
    this.remove(); this.signature = signature;
    const host = document.createElement("aside"); host.dataset.jobHunterUi = "";
    host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483000;width:min(300px,calc(100vw - 32px))";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style"); style.textContent = ":host{font:14px/1.5 system-ui;color:#17382f}.card{padding:16px;background:#fff;border:1px solid #ceded6;border-radius:14px;box-shadow:0 8px 30px #17382f20}strong{display:block}p{margin:6px 0;color:#52685f;font-size:13px}button{font:inherit;padding:8px 12px;border:1px solid #c4dbd0;border-radius:8px;color:#075345;background:#edf6f1;cursor:pointer}button:focus-visible{outline:2px solid #075345;outline-offset:3px}";
    const card = document.createElement("div"); card.className = "card"; card.setAttribute("role", "status");
    const title = document.createElement("strong");
    const detail = document.createElement("p");
    const copy: Record<string, [string, string]> = {
      JOB_DETAIL: ["✦ Job recognized", "Choose the employer’s Apply action. Copilot will watch for the application."],
      UNCERTAIN: ["✦ Applying here?", "Inspect this page with Copilot. Only confirmed application fields can be filled."],
      AUTH_REQUIRED: ["✦ Sign in to continue", "Complete sign-in yourself. Copilot never enters passwords or verification codes."],
      APPLICATION_ENTRY: ["✦ Application entry", "Use the employer’s action to continue. It may share your profile or submit immediately."],
      APPLICATION_REVIEW: ["✦ Review your application", "Check the employer’s summary and declarations. You choose when to submit."],
      APPLICATION_SUCCESS: ["✦ Confirmation detected", "Saved-answer learning requires verified submission evidence; this message alone does not confirm a save."]
    };
    [title.textContent, detail.textContent] = copy[evidence.stage] ?? copy.UNCERTAIN!;
    if (evidence.method === "NATIVE_APPLY" && evidence.stage === "APPLICATION_ENTRY") { title.textContent = "✦ Native application"; detail.textContent = "Use this platform’s application controls. Automatic clicks and submissions are disabled; no claim is made that your saved platform profile is complete."; }
    card.append(title, detail);
    if (evidence.method !== "NATIVE_APPLY" && ["UNCERTAIN", "JOB_DETAIL", "APPLICATION_ENTRY"].includes(evidence.stage)) {
      const button = document.createElement("button"); button.textContent = "Use Copilot on this page"; button.addEventListener("click", this.inspect); card.append(button);
    }
    root.append(style, card); document.documentElement.append(host); this.host = host;
  }
}
