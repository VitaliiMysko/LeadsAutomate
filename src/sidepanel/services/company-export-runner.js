import { isCompanySearchUrl, pageOf, urlWithPage } from "../../utils/restli-query.js";
import { searchKeyOf, takeCompanies, exportComplete, resultNumber } from "../../utils/company-export.js";
import { TIMING, COMPANIES_PER_PAGE, RESULT_PAGES } from "../../constants/config.js";
import { randomBetween } from "../../utils/text-utils.js";
import { getActiveTab, sendToContent, FatalError, RateLimitError } from "./tab-service.js";
import { goToPage } from "./results-pages.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SALES_NAVIGATOR_URL = /^https:\/\/www\.linkedin\.com\/sales\//;
const COMPANY_RESULTS = { isSearchUrl: isCompanySearchUrl, markerAction: "companyResultsMarker" };

export async function getCompanySearchTab() {
  const tab = await getActiveTab();
  if (!tab || !isCompanySearchUrl(tab.url)) {
    throw new FatalError("Open a Sales Navigator company search (linkedin.com/sales/search/company) in the active tab");
  }
  return tab;
}

// Waits for the reloaded tab to show the company search's results, its
// page script answering.
async function waitForCompanyResults(tabId) {
  const deadline = Date.now() + TIMING.pageReloadTimeoutMs;
  let lastError = null;
  await sleep(1000);
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && isCompanySearchUrl(tab.url)) {
        await sendToContent(tabId, "waitForResults");
        return (await chrome.tabs.get(tabId)).url;
      }
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`The company search didn't load${lastError ? ` (${lastError.message})` : ""}`);
}

// Puts the active tab on the export's search, on the results page to read
// next: as it is when it shows that page already; by the page step when it
// shows the same search on another page; else by opening the export's
// search URL on that page. Returns the tab.
async function showExportPage(state, log) {
  const tab = await getActiveTab();
  if (!tab || !SALES_NAVIGATOR_URL.test(tab.url ?? "")) throw new FatalError("Open Sales Navigator in the active tab");
  const sameSearch = isCompanySearchUrl(tab.url) && searchKeyOf(tab.url) === state.searchKey;
  if (sameSearch && pageOf(tab.url) === state.page) return tab;
  if (sameSearch) {
    const { first } = await sendToContent(tab.id, "companyResultsMarker");
    if (await goToPage(tab.id, tab.url, state.page, first, log, COMPANY_RESULTS)) return tab;
  }

  await sleep(randomBetween(...TIMING.betweenPagesMs));
  log.info(`Opening the export's company search on results page ${state.page}`);
  await chrome.tabs.update(tab.id, { url: urlWithPage(state.searchUrl, state.page) });
  const url = await waitForCompanyResults(tab.id);
  if (pageOf(url) !== state.page) {
    throw new Error(`the company search opened on results page ${pageOf(url)}, not ${state.page}`);
  }
  return tab;
}

async function readPage(tabId, page, log) {
  log.info(`Reading the companies on results page ${page}`);
  const { companies, noMatches } = await sendToContent(tabId, "readCompanies");
  if (noMatches) log.info("Sales Navigator shows no matches: no companies to export");
  return companies;
}

// Takes the companies of one page into the export, logging them.
function take(state, rows, page, log) {
  const result = takeCompanies(state, rows, page);
  const { added, state: next } = result;
  if (added.length) {
    log.debug(`Companies from page ${page}: ${added.map(({ id, name }) => `${id} "${name}"`).join(" | ")}`);
    log.info(
      `Page ${page}: ${added.length} companies taken, up to #${resultNumber(page, next.last.index)} ` +
        `(${next.companies.length} of ${state.target})`
    );
  } else {
    log.info(`Page ${page}: no new companies (${rows.length} on the page)`);
  }
  return result;
}

// Exports the companies of the search of `initial` (company-export.js),
// page by page, from its `page`: reads each results page, takes its
// companies, and goes on to the next page (with a pause, see goToPage)
// until the export has its target, the search has no more pages, or Stop
// (`shouldStop`, checked between pages). A page whose row doesn't render is
// read once more; then the export stops there with an error.
// `onUpdate(state)` gets the state after every page (and the page to read
// next), so whatever was taken is kept when the run fails: an error,
// LinkedIn's request limit (RateLimitError) or a closed tab is thrown with
// the last state already reported. Returns { state, end }, `end` one of
// "complete", "last-page" (the search has fewer companies), "stopped".
export async function exportCompanies(initial, { log, shouldStop = () => false, onUpdate = () => {} }) {
  let state = initial;
  const tab = await showExportPage(state, log);
  for (;;) {
    const { page } = state;
    let rows;
    let unread = null;
    for (let attempt = 1; ; attempt++) {
      rows = await readPage(tab.id, page, log);
      ({ state, unread } = take(state, rows, page, log));
      onUpdate(state);
      if (unread === null || exportComplete(state) || attempt === 2) break;
      log.warn(`Company #${resultNumber(page, unread)} on page ${page} didn't load, reading the page again`);
      await sleep(randomBetween(...TIMING.betweenPagesMs));
    }

    if (exportComplete(state)) return { state, end: "complete" };
    if (unread !== null) {
      throw new Error(`company #${resultNumber(page, unread)} on results page ${page} didn't load (no link to its page)`);
    }
    if (rows.length < COMPANIES_PER_PAGE) {
      log.info(`Page ${page} is the last results page`);
      return { state, end: "last-page" };
    }
    if (page >= RESULT_PAGES.max) {
      log.info(`Page ${page} is the last results page Sales Navigator shows`);
      return { state, end: "last-page" };
    }
    // The page is done: an export continued later starts on the next one.
    state = { ...state, page: page + 1 };
    onUpdate(state);
    if (shouldStop()) return { state, end: "stopped" };

    const url = (await chrome.tabs.get(tab.id)).url;
    if (!(await goToPage(tab.id, url, page + 1, rows[0]?.href ?? "", log, COMPANY_RESULTS))) {
      throw new Error(`couldn't go to results page ${page + 1}`);
    }
  }
}
