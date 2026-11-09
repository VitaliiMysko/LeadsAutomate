import { log } from "./log.js";

// Firefox lets the user withhold or revoke the manifest's host permissions
// (Chrome grants them at install). Without them the panel can't see the
// tab's URL, the page script isn't loaded and LinkedIn pages can't be read,
// so a card with a button asks for them; the request needs a click.
export async function initHostAccess({ card, button }) {
  const origins = chrome.runtime.getManifest().host_permissions ?? [];
  const granted = () => chrome.permissions.contains({ origins }).catch(() => true);
  const refresh = async () => {
    card.hidden = await granted();
    return card.hidden;
  };

  button.addEventListener("click", async () => {
    let ok = false;
    try {
      ok = await chrome.permissions.request({ origins });
    } catch (error) {
      log.error(`Could not ask for access to LinkedIn: ${error?.message || error}`);
      return;
    }
    await refresh();
    if (ok) log.success("Access to LinkedIn granted: reload the Sales Navigator tab so the page script loads");
    else log.warn("Access to LinkedIn wasn't granted; the extension can't work without it");
  });
  chrome.permissions.onAdded?.addListener(refresh);
  chrome.permissions.onRemoved?.addListener(refresh);

  if (!(await refresh())) log.warn("No access to LinkedIn pages: click Allow access at the top of the panel");
}
