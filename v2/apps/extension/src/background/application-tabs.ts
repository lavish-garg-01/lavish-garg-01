const groupTitle = "Job Hunter · Applying";
let grouping: Promise<void> = Promise.resolve();

/** Do not rename or absorb a user's unrelated tab group. */
export async function groupApplicationTabs(dashboardTabId: number | undefined, applicationTabId: number): Promise<void> {
  const pending = grouping.catch(() => undefined).then(() => groupTabs(dashboardTabId, applicationTabId));
  grouping = pending;
  return pending;
}

async function groupTabs(dashboardTabId: number | undefined, applicationTabId: number): Promise<void> {
  if (!chrome.tabs.group || !chrome.tabGroups) return;
  const application = await chrome.tabs.get(applicationTabId);
  if (application.windowId === undefined) return;
  const owned = (await chrome.tabGroups.query({ windowId: application.windowId, title: groupTitle }))[0];
  if (application.groupId !== -1 && application.groupId !== owned?.id) return;
  const dashboard = dashboardTabId === undefined ? null : await chrome.tabs.get(dashboardTabId).catch(() => null);
  const tabIds: [number, ...number[]] = [applicationTabId];
  if (dashboard?.id !== undefined && dashboard.windowId === application.windowId && (dashboard.groupId === -1 || dashboard.groupId === owned?.id)) tabIds.unshift(dashboard.id);
  const groupId = await chrome.tabs.group({ ...(owned ? { groupId: owned.id } : {}), tabIds });
  await chrome.tabGroups.update(groupId, { title: groupTitle, color: "blue", collapsed: false });
}

export async function setApplicationPanel(tabId: number, enabled: boolean): Promise<void> {
  await chrome.sidePanel?.setOptions({ tabId, path: "sidepanel.html", enabled });
}

/**
 * Keep the toolbar action usable as a manual escape hatch on employer pages.
 * This does not inject, inspect or display Copilot by itself; Chrome still
 * requires an explicit click and an origin permission before page scanning.
 */
export function manualApplicationPanelEligible(urlValue: string | undefined, webOrigins: readonly string[]): boolean {
  if (!urlValue) return false;
  try {
    const url = new URL(urlValue);
    return ["http:", "https:"].includes(url.protocol) && !webOrigins.includes(url.origin);
  } catch {
    return false;
  }
}
