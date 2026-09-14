export type StructuralChangeReason = "SPA_NAVIGATION" | "STRUCTURAL_MUTATION" | "RECOVERY";

export class CoalescingScheduler {
  private timer: number | null = null;
  private pending: StructuralChangeReason | null = null;
  constructor(private readonly callback: (reason: StructuralChangeReason) => void, private readonly delayMs = 180) {}

  schedule(reason: StructuralChangeReason): void {
    if (reason === "SPA_NAVIGATION" || !this.pending) this.pending = reason;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const next = this.pending;
      this.pending = null;
      this.timer = null;
      if (next) this.callback(next);
    }, this.delayMs);
  }

  flush(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    const next = this.pending;
    this.pending = null;
    this.timer = null;
    if (next) this.callback(next);
  }

  stop(): void { if (this.timer !== null) window.clearTimeout(this.timer); this.timer = null; this.pending = null; }
}

function meaningfulMutation(record: MutationRecord): boolean {
  if (record.type === "characterData") return Boolean(record.target.parentElement?.closest('h1,h2,h3,button,[role="heading"],[role="button"]'));
  if (record.type === "attributes") return [
    "disabled", "hidden", "aria-disabled", "aria-expanded", "aria-hidden", "required", "aria-required",
    "aria-invalid", "aria-controls", "aria-owns", "data-required", "data-invalid", "type"
  ].includes(record.attributeName ?? "");
  return [...record.addedNodes, ...record.removedNodes].some((node) =>
    node instanceof Element && (
      node.matches("h1,h2,h3,a,dialog,[role=dialog],[role=button],form,input,select,option,textarea,button,fieldset,section,iframe,label,[role=combobox],[role=textbox],[role=group],[role=alert],[role=tabpanel],[contenteditable=true],[data-repeatable-item]")
      || Boolean(node.querySelector("h1,h2,h3,a,dialog,[role=dialog],[role=button],form,input,select,option,textarea,button,fieldset,section,iframe,label,[role=combobox],[role=textbox],[role=group],[role=alert],[role=tabpanel],[contenteditable=true],[data-repeatable-item]"))
    )
  );
}

export class PageObserver {
  private mutationObserver: MutationObserver | null = null;
  private restoreHistory: (() => void) | null = null;
  private locationTimer: number | null = null;
  private readonly scheduler: CoalescingScheduler;

  constructor(callback: (reason: StructuralChangeReason) => void, delayMs = 180) {
    this.scheduler = new CoalescingScheduler(callback, delayMs);
  }

  start(document: Document, history: History, window: Window): void {
    let lastLocation = window.location.href;
    const locationChanged = () => {
      if (window.location.href === lastLocation) return false;
      lastLocation = window.location.href;
      this.scheduler.schedule("SPA_NAVIGATION");
      return true;
    };
    this.mutationObserver = new MutationObserver((records) => {
      if (!locationChanged() && records.some(meaningfulMutation)) this.scheduler.schedule("STRUCTURAL_MUTATION");
    });
    this.mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "disabled", "hidden", "aria-disabled", "aria-expanded", "aria-hidden", "required", "aria-required",
        "aria-invalid", "aria-controls", "aria-owns", "data-required", "data-invalid", "type"
      ]
    });
    const observedRoots = new WeakSet<ShadowRoot>();
    const discoverRoots = () => {
      const roots: Array<Document | ShadowRoot> = [document];
      for (let index = 0; index < roots.length; index += 1) for (const host of roots[index]!.querySelectorAll("*")) {
        const root = host.shadowRoot;
        if (!root || root.mode !== "open") continue;
        roots.push(root);
        if (observedRoots.has(root)) continue;
        observedRoots.add(root);
        this.mutationObserver?.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled", "hidden", "aria-hidden", "aria-expanded", "required", "aria-required", "aria-invalid", "type"] });
        this.scheduler.schedule("STRUCTURAL_MUTATION");
      }
    };
    discoverRoots();

    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    const navigated = () => { lastLocation = window.location.href; this.scheduler.schedule("SPA_NAVIGATION"); };
    const online = () => this.scheduler.schedule("RECOVERY");
    history.pushState = (...args) => { push(...args); navigated(); };
    history.replaceState = (...args) => { replace(...args); navigated(); };
    window.addEventListener("popstate", navigated);
    window.addEventListener("online", online);
    let discoveryTick = 0;
    this.locationTimer = window.setInterval(() => { locationChanged(); if (++discoveryTick % 4 === 0) discoverRoots(); }, 500);
    this.restoreHistory = () => {
      history.pushState = push;
      history.replaceState = replace;
      window.removeEventListener("popstate", navigated);
      window.removeEventListener("online", online);
      if (this.locationTimer !== null) window.clearInterval(this.locationTimer);
      this.locationTimer = null;
    };
  }

  stop(): void { this.mutationObserver?.disconnect(); this.mutationObserver = null; this.scheduler.stop(); this.restoreHistory?.(); this.restoreHistory = null; }
}
