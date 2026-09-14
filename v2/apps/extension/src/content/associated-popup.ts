/** Never widen an unproven popup relationship to the document. */
export function associatedPopups(element: HTMLElement): HTMLElement[] {
  const root = element.getRootNode() as Document | ShadowRoot;
  const ids = [...new Set([element.getAttribute("aria-controls"), element.getAttribute("aria-owns")]
    .flatMap(value => (value ?? "").split(/\s+/)).filter(Boolean))];
  if (!ids.length || ids.length > 10) return [];
  const targets = ids.map(id => {
    let scope: Document | ShadowRoot = root;
    for (let depth = 0; depth < 8; depth++) {
      const found = scope.getElementById(id);
      if (found) return found;
      if (!(scope instanceof ShadowRoot)) break;
      scope = scope.host.getRootNode() as Document | ShadowRoot;
    }
    return null;
  });
  // A partially resolved relationship is not permission to pick any remaining popup.
  if (targets.some(target => !(target instanceof HTMLElement))) return [];
  return (targets as HTMLElement[]).filter(target => target !== element && !target.contains(element)
    && !["HTML", "BODY", "FORM"].includes(target.tagName)
    && target.matches('[role="listbox"],[role="tree"],[role="grid"],[role="dialog"]'));
}
