import { isLeadUrl, isPeopleSearchUrl } from "../../utils/restli-query.js";
import { pickLeads } from "../../utils/lead-picker.js";
import { COLUMNS } from "../../utils/priority-board.js";
import { TIMING } from "../../constants/config.js";
import { randomBetween } from "../../utils/text-utils.js";
import { getSearchTab, sendToContent, FatalError } from "./tab-service.js";

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
  const { handled } = await sendToContent(tabId, "openLead", { index: lead.index, name: lead.name });
  const shown = await waitForLeadShown(tabId, lead, TIMING.leadPanelTimeoutMs);
  if (!shown) {
    const why = handled === false ? "the page ignored the click" : "its details didn't show";
    throw new Error(`"${lead.name}" wasn't opened: ${why}`);
  }
  log.debug(`"${lead.name}" opened: ${shown}`);
}

// Puts the tab back on the search when opening leads left it on a lead's
// URL, so the next search reads its filters from the URL again.
async function returnToSearch(tabId, searchUrl, log) {
  const url = (await chrome.tabs.get(tabId)).url;
  if (isPeopleSearchUrl(url)) return;
  log.debug(`Back to the search from ${pathOf(url)}`);
  await sendToContent(tabId, "navigateInPage", { url: searchUrl });
}

// Finds the leads of the results page to take, by the Management and
// Technical priorities (`priorities` from getJobPriorities), and opens them
// one by one in priority order, with a pause before each. Returns
// { leads, picks, columns, opened }. Throws FatalError when the tab is
// unusable; a lead that couldn't be opened is logged and skipped.
export async function selectLeads(priorities, { log }) {
  const tab = await getSearchTab();
  const searchUrl = tab.url;

  log.info("Reading the leads on the page");
  const { leads } = await sendToContent(tab.id, "readLeads");
  log.debug(`Leads on the page (${leads.length}): ${leads.map(describeLead).join(" | ") || "none"}`);
  for (const lead of leads) {
    log.debug(`  #${lead.index + 1} buttons: ${lead.buttons.join(" ; ") || "none"}`);
  }
  const locked = leads.filter((lead) => lead.locked);
  if (locked.length) log.info(`Skipping ${locked.length} locked leads (View profile): ${locked.map((lead) => `#${lead.index + 1}`).join(", ")}`);
  const unlinked = leads.filter((lead) => !lead.locked && !lead.href);
  if (unlinked.length) log.warn(`Skipping ${unlinked.length} leads without a link to their page: ${unlinked.map((lead) => `#${lead.index + 1}`).join(", ")}`);
  const untitled = leads.filter((lead) => !lead.title);
  if (untitled.length) log.warn(`No job title read for ${untitled.length} leads: ${untitled.map((lead) => `#${lead.index + 1}`).join(", ")}`);

  const { picks, columns } = pickLeads(leads, priorities, priorities.leadsCount);
  for (const column of COLUMNS) {
    const { wanted, found } = columns[column];
    const names = picks.filter((pick) => pick.column === column).map((pick) => `"${pick.lead.name}" (${pick.entry})`);
    (found < wanted ? log.warn : log.info)(
      `${column}: ${found} of ${wanted} leads found${names.length ? `: ${names.join(", ")}` : ""}`
    );
  }

  let opened = 0;
  try {
    for (const pick of picks) {
      await sleep(randomBetween(...TIMING.beforeLeadClickMs));
      try {
        await openLead(tab.id, pick, log);
        opened++;
      } catch (error) {
        if (error instanceof FatalError) throw error;
        log.warn(error.message);
      }
    }
  } finally {
    await returnToSearch(tab.id, searchUrl, log).catch((error) => log.warn(`Could not return to the search: ${error.message}`));
  }
  return { leads: leads.length, picks, columns, opened };
}
