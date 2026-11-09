// Chrome: the side panel is enabled only on Sales Navigator tabs: clicking
// the toolbar icon there opens it, and switching to any other tab hides it.
// The whole /sales/ section (not just people search) keeps the panel open
// while the user glances at a lead page in the same tab.
//
// Firefox has no side panel API but a sidebar, which belongs to the window,
// not to a tab: the toolbar icon toggles it, and on other tabs the panel
// itself says to open a Sales Navigator search (as it does for any page
// that isn't one).
const SALES_NAVIGATOR_URL_REGEX = /^https:\/\/www\.linkedin\.com\/sales\//;
const PANEL_PATH = "sidepanel.html";

// tab.url is only visible for hosts in host_permissions, so it's undefined
// everywhere outside Sales Navigator, which correctly disables the panel.
function updatePanelForTab(tabId, url) {
  const enabled = !!url && SALES_NAVIGATOR_URL_REGEX.test(url);
  chrome.sidePanel
    .setOptions(enabled ? { tabId, path: PANEL_PATH, enabled } : { tabId, enabled })
    .catch(() => {});
}

if (chrome.sidePanel) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
    chrome.sidePanel.setOptions({ enabled: false }).catch(console.error);
  });

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!info.url && info.status !== "complete") return;
    updatePanelForTab(tabId, tab.url);
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      updatePanelForTab(tabId, tab.url);
    } catch {
      // tab closed in the meantime
    }
  });
} else {
  const sidebarAction = globalThis.browser?.sidebarAction ?? chrome.sidebarAction;
  // toggle() must run straight in the click handler (a user action), with
  // no await before it.
  chrome.action.onClicked.addListener(() => {
    sidebarAction?.toggle().catch(console.error);
  });
}
