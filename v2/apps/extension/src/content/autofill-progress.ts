import type { AutofillProgress } from "../shared/contracts.js";

export function fieldLabel(key: string | null, index: number): string {
  if (!key) return `Question ${index + 1}`;
  return key.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function progressHeading(progress: AutofillProgress): string {
  if (progress.phase === "FILLING") return "Copilot is filling your form…";
  if (progress.phase === "PAUSED") return "Autofill paused";
  if (progress.phase === "DETECTING") return "Connect from Job Hunter to start";
  if (progress.phase === "RESOLVING") return "Finding your saved answers…";
  const outstanding = progress.fields.some(field => !["COMPLETED", "ATS_AUTOFILLED"].includes(field.state) && (field.required || field.state === "ATTENTION"));
  return progress.phase === "FAILED" || progress.scanIncomplete || outstanding ? "Some questions still need you" : "Check your answers before submitting";
}

/** Closed shadow root: our controls are never included in application scans. */
export class ApplicationProgressCard {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private readonly noteMessages = new Map<string, string>();
  private readonly savingNotes = new Set<string>();
  constructor(private readonly focus: (fieldId: string) => void, private readonly toggle: () => void, private readonly openPanel: () => void = () => {}, private readonly saveNote?: (fieldId: string) => Promise<string>) {}
  remove(): void { this.host?.remove(); this.host = null; this.root = null; }
  render(progress: AutofillProgress): void {
    const visibleIds = new Set(progress.fields.map((field) => field.fieldRuntimeId));
    for (const id of this.noteMessages.keys()) if (!visibleIds.has(id) && !this.savingNotes.has(id)) this.noteMessages.delete(id);
    if (!this.host) {
      this.host = document.createElement("aside"); this.host.setAttribute("data-job-hunter-ui", "");
      this.host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483000;width:min(290px,calc(100vw - 32px))";
      this.root = this.host.attachShadow({ mode: "closed" }); document.documentElement.append(this.host);
    }
    const root = this.root!; const expanded = Boolean(root.querySelector("details[open]"));
    const done = progress.fields.filter((field) => ["COMPLETED", "ATS_AUTOFILLED"].includes(field.state)).length;
    root.replaceChildren();
    const style = document.createElement("style"); style.textContent = ":host{font:14px/1.5 system-ui;color:#172720}*{box-sizing:border-box}.card{background:#fff;border:1px solid #cbd8d2;border-radius:14px;box-shadow:0 8px 35px #10251c22;padding:14px}strong{font-size:15px}small{display:block;color:#56675e}summary{cursor:pointer;padding:6px 0}ul{list-style:none;padding:0;max-height:220px;overflow:auto}button{font:inherit;border:0;background:#eef5f0;color:#154e3c;border-radius:7px;padding:7px 10px;cursor:pointer}li button{display:block;width:100%;text-align:left;margin:5px 0}.toggle{margin-top:8px}progress{width:100%;height:7px;accent-color:#146b51}button:focus-visible,summary:focus-visible{outline:2px solid #146b51;outline-offset:2px}"; root.append(style);
    const card = document.createElement("div"); card.className = "card";
    const heading = document.createElement("strong"); heading.textContent = progressHeading(progress);
    const count = document.createElement("small"); count.textContent = `${done} of ${progress.fields.length} scanned questions populated · You review and submit${progress.scanIncomplete ? ' · Some controls could not be scanned' : ''}`;
    const bar = document.createElement("progress"); bar.max = Math.max(1, progress.fields.length); bar.value = done;
    const details = document.createElement("details"); details.open = expanded;
    const summary = document.createElement("summary"); summary.textContent = "View fields & attention"; details.append(summary);
    const list = document.createElement("ul");
    progress.fields.forEach((field, index) => { const li = document.createElement("li"); const button = document.createElement("button"); button.textContent = `${["COMPLETED", "ATS_AUTOFILLED"].includes(field.state) ? "✓" : "○"} ${fieldLabel(field.canonicalKey, index)} · ${field.state.toLowerCase().replaceAll("_", " ")}`; button.addEventListener("click", () => this.focus(field.fieldRuntimeId)); li.append(button); list.append(li); });
    if (this.saveNote) progress.fields.forEach((field, index) => {
      if (field.canonicalKey) return;
      const item = list.children[index];
      if (!item) return;
      const save = document.createElement("button"); save.textContent = this.noteMessages.get(field.fieldRuntimeId) ?? "Save answer as private note";
      save.disabled = this.savingNotes.has(field.fieldRuntimeId);
      save.addEventListener("click", async () => {
        if (this.savingNotes.has(field.fieldRuntimeId)) return;
        this.savingNotes.add(field.fieldRuntimeId); save.disabled = true;
        try { this.noteMessages.set(field.fieldRuntimeId, await this.saveNote!(field.fieldRuntimeId)); }
        catch { this.noteMessages.set(field.fieldRuntimeId, "Not saved — retry"); }
        finally { this.savingNotes.delete(field.fieldRuntimeId); save.textContent = this.noteMessages.get(field.fieldRuntimeId)!; save.disabled = false; }
      });
      item.append(save);
    });
    details.append(list); const toggle = document.createElement("button"); toggle.className = "toggle"; toggle.textContent = ["PAUSED", "FAILED"].includes(progress.phase) ? "Resume / retry" : "Pause autofill"; toggle.addEventListener("click", this.toggle);
    const open = document.createElement("button"); open.textContent = "◧"; open.title = "Open Copilot side panel"; open.setAttribute("aria-label", open.title); open.style.cssText = "float:right;margin-left:8px;padding:3px 8px"; open.addEventListener("click", this.openPanel);
    card.append(open, heading, count, bar, details, toggle); root.append(card);
  }
}
