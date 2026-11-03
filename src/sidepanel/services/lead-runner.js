import { isLeadUrl, isPeopleSearchUrl, pageOf, urlWithPage } from "../../utils/restli-query.js";
import { nextPick, countFound, wantsMoreLeads } from "../../utils/lead-picker.js";
import { COLUMNS } from "../../utils/priority-board.js";
import { TIMING, LEADS_PER_PAGE } from "../../constants/config.js";
import { randomBetween } from "../../utils/text-utils.js";
import { getSearchTab, sendToContent, FatalError, RateLimitError } from "./tab-service.js";
import { connectLeadGenerator } from "./lead-generator-service.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pathOf = (url) => {
  try {
    return new URL(url).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
};

const describeLead = (lead) =>
  `#${lead.index + 1}${lead.locked ? " [locked]" : ""} "${lead.name}" · ${lead.title || "no title"}` +
  [lead.company, lead.location, lead.tenure].filter(Boolean).map((part) => ` · ${part}`).join("");

const leadNumbers = (leads) => leads.map((lead) => `#${lead.index + 1}`).join(", ");

// Leads are numbered across the pages read (`index`); `row` is the lead's
// row on its own page, for opening it.
const numberLeads = (leads, offset) => leads.map((lead) => ({ ...lead, row: lead.index, index: offset + lead.index }));

// Polls until the lead's details are shown: the tab URL turned into the
// lead's page (linkedin.com/sales/lead/...), or its details appeared over
// the results. Returns how it was seen, or null when time runs out.
async function waitForLeadShown(tabId, lead, timeout) {
  const deadline = Date.now() + timeout;
  const leadPath = pathOf(lead.href);
  while (Date.now() < deadline) {
    const url = (await chrome.tabs.get(tabId)).url;
    if (isLeadUrl(url) && (!leadPath || pathOf(url) === leadPath)) return `URL ${pathOf(url)}`;
    const { open, panel } = await sendToContent(tabId, "leadPanelState", { name: lead.name });
    if (open) return `details on the page ${panel}`;
    await sleep(400);
  }
  return null;
}

async function openLead(tabId, { column, entry, lead }, log) {
  log.info(`Opening ${column} lead "${lead.name}" (${lead.title}) for "${entry}"`);
  const { handled } = await sendToContent(tabId, "openLead", { index: lead.row, name: lead.name });
  const shown = await waitForLeadShown(tabId, lead, TIMING.leadPanelTimeoutMs);
  if (!shown) {
    const why = handled === false ? "the page ignored the click" : "its details didn't show";
    throw new Error(`wasn't opened: ${why}`);
  }
  log.debug(`"${lead.name}" opened: ${shown}`);
}

// Runs Extract, Generate and Save in Lead generator for the opened lead,
// with a pause before each step. Returns "new" when the lead was saved now,
// "duplicate" when an earlier search saved it ("Already saved"), else null.
// Throws FatalError when no more leads can be saved (its limit is reached).
async function saveLead(leadGenerator, lead, log) {
  const pause = () => sleep(randomBetween(...TIMING.betweenLeadGeneratorStepsMs));

  await pause();
  const extracted = await leadGenerator.extract();
  if (!extracted.ok) {
    log.warn(`"${lead.name}": Extract failed (${extracted.reason}), not saved`);
    return null;
  }
  const { firstName, surname, jobPosition, companyName, website } = extracted.lead;
  log.info(
    `"${lead.name}": extracted ${[firstName, surname].filter(Boolean).join(" ")} · ${jobPosition || "no position"} · ` +
      `${companyName || "no company"} · ${website || "no website"}`
  );

  await pause();
  const { email, message } = await leadGenerator.generateEmails();
  if (!email) {
    log.warn(`"${lead.name}": no email (${message}), not saved`);
    return null;
  }
  log.info(`"${lead.name}": email ${email}`);

  await pause();
  const { outcome } = await leadGenerator.save();
  if (outcome === "saved") return "new";
  // Saved by an earlier search: found all the same, but not a new lead.
  if (outcome === "duplicate") {
    log.info(`"${lead.name}": already saved before, counted as found (not toward the daily limit)`);
    return "duplicate";
  }
  if (outcome === "limit") {
    throw new FatalError("Lead generator's saved leads limit is reached: copy and clear its saved leads, then search again");
  }
  log.warn(`"${lead.name}": not saved (no data to save)`);
  return null;
}

// Puts the tab back on the search when opening leads left it on a lead's
// URL, or paging on another results page, so the next search reads its
// filters from the URL again and starts on its page.
async function returnToSearch(tabId, searchUrl, log) {
  const url = (await chrome.tabs.get(tabId)).url;
  if (isPeopleSearchUrl(url) && pageOf(url) === pageOf(searchUrl)) return;
  log.debug(`Back to the search from ${pathOf(url)}`);
  await sendToContent(tabId, "navigateInPage", { url: searchUrl });
}

// Polls until the tab shows results page `page`: the URL holds that page
// and the first lead is no longer `previousFirst` (or nobody matches).
async function waitForPage(tabId, page, previousFirst) {
  const deadline = Date.now() + TIMING.pageChangeTimeoutMs;
  while (Date.now() < deadline) {
    const url = (await chrome.tabs.get(tabId)).url;
    if (isPeopleSearchUrl(url) && pageOf(url) === page) {
      const { first, noMatches } = await sendToContent(tabId, "resultsMarker");
      if (noMatches || (first && first !== previousFirst)) return true;
    }
    await sleep(400);
  }
  return false;
}

// Goes to results page `page` of the search after a pause, the way Back /
// Forward does (the URL's `page` parameter), else by its pagination button.
// Returns false when the page didn't change.
async function goToPage(tabId, searchUrl, page, previousFirst, log) {
  await sleep(randomBetween(...TIMING.betweenPagesMs));
  log.info(`Going to results page ${page}`);
  await sendToContent(tabId, "navigateInPage", { url: urlWithPage(searchUrl, page) });
  if (await waitForPage(tabId, page, previousFirst)) return true;

  log.debug(`Results page ${page} didn't show after the URL change, trying its pagination button`);
  await sendToContent(tabId, "undoInPageNavigation");
  const { clicked } = await sendToContent(tabId, "clickResultsPage", { page, next: true });
  if (clicked && (await waitForPage(tabId, page, previousFirst))) return true;
  log.warn(`Couldn't go to results page ${page}${clicked ? "" : " (no pagination button for it)"}`);
  return false;
}

// Reads the leads of the results page shown, numbered after the `offset`
// leads of the pages read before it.
async function readPage(tabId, page, offset, log) {
  log.info(`Reading the leads on results page ${page}`);
  const { leads: rows, noMatches } = await sendToContent(tabId, "readLeads");
  if (noMatches) log.info("Sales Navigator shows no matches: no leads to take");
  const leads = numberLeads(rows, offset);
  log.debug(`Leads on page ${page} (${leads.length}): ${leads.map(describeLead).join(" | ") || "none"}`);
  const locked = leads.filter((lead) => lead.locked);
  if (locked.length) log.info(`Skipping ${locked.length} locked leads (View profile): ${leadNumbers(locked)}`);
  const unlinked = leads.filter((lead) => !lead.locked && !lead.href);
  if (unlinked.length) log.warn(`Skipping ${unlinked.length} leads without a link to their page: ${leadNumbers(unlinked)}`);
  const untitled = leads.filter((lead) => !lead.title);
  if (untitled.length) log.warn(`No job title read for ${untitled.length} leads: ${leadNumbers(untitled)}`);
  return leads;
}

// Takes leads of the search results by the Management and Technical
// priorities (`priorities` from getJobPriorities), one at a time in priority
// order (lead-picker.js): opens the lead, with a pause before the click, then
// has Lead generator extract it, find its email and save it. Only a saved
// lead counts toward its column's and its item's lead count; otherwise the
// next matching lead is tried. Reads up to `pages` results pages, from the
// one shown: the next page only while a column still wants leads (and the
// page was full). Returns { leads, pages, tried, columns, saved }.
// `onPageRead()` is called after each results page read,
// `onLeadTried(saved, isNew)` after each lead tried, for the statistics
// (`isNew` false for a lead saved by an earlier search).
// Throws FatalError when Lead generator can't be used or the tab is
// unusable; a lead that fails is logged and skipped.
export async function selectLeads(priorities, { log, pages = 1, onPageRead = () => {}, onLeadTried = () => {} }) {
  const tab = await getSearchTab();
  const searchUrl = tab.url;
  const firstPage = pageOf(searchUrl);
  const lastPage = firstPage + pages - 1;
  const { leadsCount } = priorities;

  for (const column of COLUMNS) {
    const items = priorities[column].map((item) => `${item.name} ×${item.count}`).join(", ");
    log.debug(`Plan ${column} (${leadsCount[column]} leads): ${items || "no titles"}`);
  }
  const leadGenerator = await connectLeadGenerator(tab.id, log);

  const allLeads = [];
  const tried = [];
  let page = firstPage;
  try {
    for (;;) {
      const leads = await readPage(tab.id, page, allLeads.length, log);
      allLeads.push(...leads);
      onPageRead();
      await tryLeads(tab.id, leadGenerator, leads, priorities, tried, onLeadTried, log);

      if (!wantsMoreLeads(priorities, leadsCount, tried)) break;
      if (page >= lastPage) {
        if (pages > 1) log.info(`Read the ${pages} results pages set`);
        break;
      }
      if (leads.length < LEADS_PER_PAGE) {
        log.info(`Page ${page} is the last results page`);
        break;
      }
      if (!(await goToPage(tab.id, searchUrl, page + 1, leads[0]?.href ?? "", log))) break;
      page++;
    }
  } finally {
    // Not after LinkedIn's rate limit: the run stops, with that reason.
    await returnToSearch(tab.id, searchUrl, log).catch((error) => {
      if (!(error instanceof RateLimitError)) log.warn(`Could not return to the search: ${error.message}`);
    });
  }

  const columns = countFound(tried, leadsCount);
  for (const column of COLUMNS) {
    const { wanted, found } = columns[column];
    const names = tried.filter((item) => item.column === column && item.saved).map((item) => `"${allLeads[item.index].name}"`);
    (found < wanted ? log.warn : log.info)(`${column}: ${found} of ${wanted} leads saved${names.length ? `: ${names.join(", ")}` : ""}`);
  }
  return {
    leads: allLeads.length,
    pages: page - firstPage + 1,
    tried,
    columns,
    saved: tried.filter((item) => item.saved).length,
  };
}

// Tries the leads of one results page in priority order, adding to `tried`.
async function tryLeads(tabId, leadGenerator, leads, priorities, tried, onLeadTried, log) {
  const { leadsCount } = priorities;
  for (let pick; (pick = nextPick(leads, priorities, leadsCount, tried)); ) {
    const attempt = { index: pick.lead.index, column: pick.column, entryIndex: pick.entryIndex, saved: false, isNew: false };
    tried.push(attempt);
    await sleep(randomBetween(...TIMING.beforeLeadClickMs));
    try {
      await openLead(tabId, pick, log);
      const outcome = await saveLead(leadGenerator, pick.lead, log);
      attempt.saved = outcome !== null;
      attempt.isNew = outcome === "new";
    } catch (error) {
      if (error instanceof FatalError) throw error;
      log.warn(`"${pick.lead.name}": ${error.message}`);
    }
    onLeadTried(attempt.saved, attempt.isNew);
    if (attempt.saved) log.success(`"${pick.lead.name}" saved as a ${pick.column} lead for "${pick.entry}"`);
  }
}
