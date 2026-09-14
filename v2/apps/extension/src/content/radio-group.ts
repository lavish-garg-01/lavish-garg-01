/** One definition of radio membership for scanning, execution and observation.
 * Native groups use browser form ownership and tree scope, never proximity.
 * ARIA groups require an explicit nearest radiogroup; orphan radios stand alone. */
export function radioMembers(element: HTMLElement): HTMLElement[] {
  if (element instanceof HTMLInputElement && element.type === "radio") {
    if (!element.name) return [element];
    const root = element.getRootNode() as Document | ShadowRoot;
    return [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .filter(input => input.name === element.name && input.form === element.form);
  }
  const group = element.closest('[role="radiogroup"]');
  if (!group) return element.getAttribute("role") === "radio" ? [element] : [];
  return [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
    .filter(input => input.closest('[role="radiogroup"]') === group);
}

export function radioOptionLabel(element: HTMLElement): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const referenced = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
    .map(id => root.getElementById(id)?.textContent ?? "").join(" ").trim();
  if (referenced) return referenced;
  if (element.getAttribute("aria-label")) return element.getAttribute("aria-label")!.trim();
  if (element instanceof HTMLInputElement) {
    return (element.labels?.[0]?.textContent ?? element.value).trim();
  }
  return (element.textContent ?? "").trim();
}

export function selectedRadio(element: HTMLElement): HTMLElement | null {
  return radioMembers(element).find(input => input instanceof HTMLInputElement ? input.checked : input.getAttribute("aria-checked") === "true") ?? null;
}

export function composedVisible(element: HTMLElement): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return true;
}
