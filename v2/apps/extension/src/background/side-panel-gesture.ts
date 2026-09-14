export function isWebLaunchRequest(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && "type" in raw && raw.type === "WEB_LAUNCH_REQUEST");
}

export function consumeLaunchGesture(raw: unknown, sender: chrome.runtime.MessageSender): void {
  if (!isWebLaunchRequest(raw) || !chrome.sidePanel?.open) return;
  const windowId = sender.tab?.windowId;
  const tabId = sender.tab?.id;
  if (windowId === undefined) return;
  if (tabId !== undefined) void chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
  void chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
  void chrome.sidePanel.open({ windowId });
}
