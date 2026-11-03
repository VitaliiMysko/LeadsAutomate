import { isPeopleSearchUrl, pageOf, urlWithPage } from "../../utils/restli-query.js";
import { TIMING } from "../../constants/config.js";
import { randomBetween } from "../../utils/text-utils.js";
import { sendToContent } from "./tab-service.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What a kind of search results is told by: its URL, and the page step that
// returns the link of the first result ({ first, noMatches }).
export const PEOPLE_RESULTS = { isSearchUrl: isPeopleSearchUrl, markerAction: "resultsMarker" };

// Polls until the tab shows results page `page`: the URL holds that page
// and the first result is no longer `previousFirst` (or nobody matches).
async function waitForPage(tabId, page, previousFirst, { isSearchUrl, markerAction }) {
  const deadline = Date.now() + TIMING.pageChangeTimeoutMs;
  while (Date.now() < deadline) {
    const url = (await chrome.tabs.get(tabId)).url;
    if (isSearchUrl(url) && pageOf(url) === page) {
      const { first, noMatches } = await sendToContent(tabId, markerAction);
      if (noMatches || (first && first !== previousFirst)) return true;
    }
    await sleep(400);
  }
  return false;
}

// Goes to results page `page` of the search after a pause, the way Back /
// Forward does (the URL's `page` parameter), else by its pagination button.
// Returns false when the page didn't change.
export async function goToPage(tabId, searchUrl, page, previousFirst, log, results = PEOPLE_RESULTS) {
  await sleep(randomBetween(...TIMING.betweenPagesMs));
  log.info(`Going to results page ${page}`);
  await sendToContent(tabId, "navigateInPage", { url: urlWithPage(searchUrl, page) });
  if (await waitForPage(tabId, page, previousFirst, results)) return true;

  log.debug(`Results page ${page} didn't show after the URL change, trying its pagination button`);
  await sendToContent(tabId, "undoInPageNavigation");
  const { clicked } = await sendToContent(tabId, "clickResultsPage", { page, next: true });
  if (clicked && (await waitForPage(tabId, page, previousFirst, results))) return true;
  log.warn(`Couldn't go to results page ${page}${clicked ? "" : " (no pagination button for it)"}`);
  return false;
}
