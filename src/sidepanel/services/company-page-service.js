import { STORAGE_KEYS, TIMING } from "../../constants/config.js";
import {
  companyPageUrl,
  companyIdFromPageHtml,
  companyNameFromPageHtml,
  organizationFromSignedInPageHtml,
} from "../../utils/company-page.js";
import { randomBetween } from "../../utils/text-utils.js";
import { loadValue, saveValue } from "../store/storage.js";

// Reads a company's numeric LinkedIn id, and its name on LinkedIn, from its
// LinkedIn page, for companies whose file row has only the page URL. A
// company or showcase page is fetched without the user's cookies, as a
// logged-out visitor, so it adds no request to the user's account. LinkedIn
// shows school pages only to members (a logged-out visitor gets HTTP 999),
// so those are fetched with the user's LinkedIn session: one page view, as
// if the user opened it. What's found is kept in storage by page path
// (company-page.js), so a page is read once.

// Entries stored as the id alone, before the name was kept too, are read
// again for the name.
const cachedEntry = (value) => (typeof value?.id === "string" ? { id: value.id, name: value.name ?? null } : null);

const needsSignIn = (path) => path.startsWith("school/");

// Resolves to { id, name, cached, signedIn } (`name` null when the page has
// none); throws with the reason when the id can't be read (page missing,
// LinkedIn's rate limit or sign-in wall, no id in it).
export async function companyIdFromPage(path) {
  const signedIn = needsSignIn(path);
  const cache = await loadValue(STORAGE_KEYS.companyPageIds, {});
  const entry = cachedEntry(cache[path]);
  if (entry) return { ...entry, cached: true, signedIn };

  const [min, max] = TIMING.beforeCompanyPageMs;
  await new Promise((resolve) => setTimeout(resolve, randomBetween(min, max)));

  let response;
  try {
    response = await fetch(companyPageUrl(path), { credentials: signedIn ? "include" : "omit" });
  } catch {
    // Also a redirect outside the page paths the extension may load, such as
    // LinkedIn's sign-in wall.
    throw new Error(
      signedIn
        ? "the page couldn't be loaded; is LinkedIn signed in in this browser?"
        : "the page couldn't be loaded (LinkedIn may be asking to sign in)",
    );
  }
  if (!response.ok) {
    const refused = response.status === 999 || response.status === 429;
    throw new Error(
      !refused
        ? `HTTP ${response.status}`
        : signedIn
          ? `LinkedIn refused the page with the user's session (HTTP ${response.status}); is LinkedIn signed in in this browser?`
          : `LinkedIn limited the requests (HTTP ${response.status})`,
    );
  }
  const html = await response.text();
  const found = signedIn
    ? organizationFromSignedInPageHtml(html, path)
    : { id: companyIdFromPageHtml(html), name: companyNameFromPageHtml(html) };
  if (!found?.id) throw new Error("no company id in the page");
  const { id, name } = found;

  const latest = await loadValue(STORAGE_KEYS.companyPageIds, {});
  await saveValue(STORAGE_KEYS.companyPageIds, { ...latest, [path]: { id, name } });
  return { id, name, cached: false, signedIn };
}
