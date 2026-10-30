import { isLeadUrl, isPeopleSearchUrl } from "../../utils/restli-query.js";
import { nextPick, countFound } from "../../utils/lead-picker.js";
import { COLUMNS } from "../../utils/priority-board.js";
import { TIMING } from "../../constants/config.js";
import { randomBetween } from "../../utils/text-utils.js";
import { getSearchTab, sendToContent, FatalError } from "./tab-service.js";
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
    throw new Error(`wasn't opened: ${why}`);
  }
  log.debug(`"${lead.name}" opened: ${shown}`);
}

// Runs Extract, Generate and Save in Lead generator for the opened lead,
// with a pause before each step. Returns true when the lead was saved, now
// or by an earlier search ("Already saved").
// Throws FatalError when no more leads can be saved (its limit is reached).
async function saveLead(leadGenerator, lead, log) {
  const pause = () => sleep(randomBetween(...TIMING.betweenLeadGeneratorStepsMs));

  await pause();
  const extracted = await leadGenerator.extract();
  if (!extracted.ok) {
    log.warn(`"${lead.name}": Extract failed (${extracted.reason}), not saved`);
    return false;
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
    return false;
  }
  log.info(`"${lead.name}": email ${email}`);

  await pause();
  const { outcome } = await leadGenerator.save();
  if (outcome === "saved") return true;
  // Saved by an earlier search: found all the same.
  if (outcome === "duplicate") {
    log.info(`"${lead.name}": already saved before, counted as found`);
    return true;
  }
  if (outcome === "limit") {
    throw new FatalError("Lead generator's saved leads limit is reached: copy and clear its saved leads, then search again");
  }
  log.warn(`"${lead.name}": not saved (no data to save)`);
  return false;
}

// Puts the tab back on the search when opening leads left it on a lead's
// URL, so the next search reads its filters from the URL again.
async function returnToSearch(tabId, searchUrl, log) {
  const url = (await chrome.tabs.get(tabId)).url;
  if (isPeopleSearchUrl(url)) return;
  log.debug(`Back to the search from ${pathOf(url)}`);
  await sendToContent(tabId, "navigateInPage", { url: searchUrl });
}

// Takes leads of the results page by the Management and Technical
// priorities (`priorities` from getJobPriorities), one at a time in priority
// order (lead-picker.js): opens the lead, with a pause before the click, then
// has Lead generator extract it, find its email and save it. Only a saved
// lead counts toward its column's and its item's lead count; otherwise the
// next matching lead is tried. Returns { leads, tried, columns, saved }.
// Throws FatalError when Lead generator can't be used or the tab is
// unusable; a lead that fails is logged and skipped.
export async function selectLeads(priorities, { log }) {
  const tab = await getSearchTab();
  const searchUrl = tab.url;
  const { leadsCount } = priorities;

  for (const column of COLUMNS) {
    const items = priorities[column].map((item) => `${item.name} ×${item.count}`).join(", ");
    log.debug(`Plan ${column} (${leadsCount[column]} leads): ${items || "no titles"}`);
  }
  const leadGenerator = await connectLeadGenerator(tab.id, log);

  log.info("Reading the leads on the page");
  const { leads } = await sendToContent(tab.id, "readLeads");
  log.debug(`Leads on the page (${leads.length}): ${leads.map(describeLead).join(" | ") || "none"}`);
  const locked = leads.filter((lead) => lead.locked);
  if (locked.length) log.info(`Skipping ${locked.length} locked leads (View profile): ${leadNumbers(locked)}`);
  const unlinked = leads.filter((lead) => !lead.locked && !lead.href);
  if (unlinked.length) log.warn(`Skipping ${unlinked.length} leads without a link to their page: ${leadNumbers(unlinked)}`);
  const untitled = leads.filter((lead) => !lead.title);
  if (untitled.length) log.warn(`No job title read for ${untitled.length} leads: ${leadNumbers(untitled)}`);

  const tried = [];
  try {
    for (let pick; (pick = nextPick(leads, priorities, leadsCount, tried)); ) {
      const attempt = { index: pick.lead.index, column: pick.column, entryIndex: pick.entryIndex, saved: false };
      tried.push(attempt);
      await sleep(randomBetween(...TIMING.beforeLeadClickMs));
      try {
        await openLead(tab.id, pick, log);
        attempt.saved = await saveLead(leadGenerator, pick.lead, log);
      } catch (error) {
        if (error instanceof FatalError) throw error;
        log.warn(`"${pick.lead.name}": ${error.message}`);
      }
      if (attempt.saved) log.success(`"${pick.lead.name}" saved as a ${pick.column} lead for "${pick.entry}"`);
    }
  } finally {
    await returnToSearch(tab.id, searchUrl, log).catch((error) => log.warn(`Could not return to the search: ${error.message}`));
  }

  const columns = countFound(tried, leadsCount);
  for (const column of COLUMNS) {
    const { wanted, found } = columns[column];
    const names = tried.filter((item) => item.column === column && item.saved).map((item) => `"${leads[item.index].name}"`);
    (found < wanted ? log.warn : log.info)(`${column}: ${found} of ${wanted} leads saved${names.length ? `: ${names.join(", ")}` : ""}`);
  }
  return { leads: leads.length, tried, columns, saved: tried.filter((item) => item.saved).length };
}
