import { STORAGE_KEYS, TIMING, RESULT_PAGES, DAILY_LIMIT, FAILED_IN_A_ROW, LEAD_GENERATOR, RECHECK_MINUTES } from "../../constants/config.js";
import { clampCount } from "../../utils/priority-board.js";
import { localDateKey, foundToday, addFound, dailyLimitReached } from "../../utils/daily-limit.js";
import { parseCompaniesFile, companiesCsvColumns, columnMappingLines, hasLogoColumn } from "../../utils/companies-file.js";
import { companyPagePath } from "../../utils/company-page.js";
import { formatDuration, randomBetween, isSameName } from "../../utils/text-utils.js";
import {
  scheduleRecheck,
  removeRecheck,
  findRecheck,
  dueRecheck,
  nextRecheckAt,
  recheckCountdown,
  parseRechecks,
} from "../../utils/recheck-queue.js";
import { logoSimilarity } from "../../utils/image-hash.js";
import { searchCompany } from "../services/search-runner.js";
import { selectLeads } from "../services/lead-runner.js";
import { loadCompanyLogos } from "../services/logo-service.js";
import { companyIdFromPage } from "../services/company-page-service.js";
import { FatalError, clearRateLimit } from "../services/tab-service.js";
import { startActivity, endActivity, onActivityChange } from "../services/activity.js";
import { ensureJobTitles, getJobPriorities, COLUMN_COLORS } from "./job-board.js";
import { countLeadTitlesCompany, recordLeadTitles } from "./lead-titles.js";
import { loadValue, saveValue } from "../store/storage.js";
import { log } from "./log.js";
import { status } from "./status.js";

// "Name company" + Search, the companies file with Search next / Search all
// / Stop and its progress bar, and the manual analysis list: companies left
// for a manual company choice or, after an invalid domain, for picking their
// leads by hand.
//
// A company whose lead selection stopped on Lead generator's "unknown
// emails" goes to the recheck list, each on its own clock (recheck-queue.js):
// once its time runs out, Search all and Search next take it before the next
// company of the file, always after the company being processed. Its
// recheck is its last try: the same answer again leaves it as checked.
//
// Search, Search next and the list's Search wait for the user to pick the
// company by hand when it can't be chosen automatically; Search all never
// waits: such companies go to the list and the run moves on.
//
// A CSV companies file may name a logo per company (a path on this
// computer); the user picks the folder holding them once, and their hashes
// and thumbnails are kept (`logos`) so a search can check the dropdown's
// logos against them.
let elements = null;
// companies: [{ name, companyId, logoPath, ... }]. Logos (the folder, the
// logo strip, the logo check) exist only for a file with a `logo` column
// (`hasLogos`).
let queue = { fileName: "", companies: [], index: 0, hasLogos: false };
let logos = {}; // company name → { hash, thumb }
// [{ name, reason, manualLeads }]: companies left for a manual company choice
// or, after Lead generator reported their domain as invalid, for picking
// their leads by hand (`manualLeads`: the list's Search applies only the
// company filter).
let unresolved = [];
// [{ name, dueAt }]: companies to search once more (recheck-queue.js).
let rechecks = [];
// Whether a recheck was due at the last countdown tick.
let recheckWasDue = false;
// Leads tried and saved by lead selection, over all searches until Reset.
let leadStats = { pages: 0, tried: 0, saved: 0 };
// How many results pages lead selection may read per search.
let resultPages = RESULT_PAGES.default;
// Minutes until a company with unknown emails is searched again.
let recheckMinutes = RECHECK_MINUTES.default;
// The daily limit of found leads ({ enabled, value }) and today's count
// ({ date, saved }, daily-limit.js). Reset of the statistics leaves it.
let dailyLimit = { enabled: false, value: DAILY_LIMIT.default };
let dailyFound = null;
// Failed leads in a row after which a company's lead selection stops
// ({ enabled, value }).
let failedLimit = { enabled: false, value: FAILED_IN_A_ROW.default };
let busy = false;
let batchRunning = false;
let waitingManual = false;
let stopRequested = false;

function persistQueue() {
  saveValue(STORAGE_KEYS.companyQueue, queue);
}

function persistLogos() {
  saveValue(STORAGE_KEYS.companyLogos, logos);
}

// The companies-file entry for a name (also for names typed or taken from
// the manual choice list), for its logo.
function findCompany(name) {
  return queue.companies.find((company) => isSameName(company.name, name)) ?? null;
}

// The LinkedIn page URL of a companies-file entry without a company id,
// when it's one the id can be read from (company-page.js).
const pagePathFor = (company) => (company && !company.companyId ? companyPagePath(company.linkedin) : null);

// Gives a company named after its page URL its name on LinkedIn, carrying
// over what's kept by name: its logo, its manual-choice list entry and the
// Name company field.
function renameCompany(company, name) {
  const previous = company.name;
  company.name = name;
  company.nameFromPage = false;
  if (logos[previous]) {
    logos = Object.fromEntries(Object.entries(logos).map(([key, value]) => [key === previous ? name : key, value]));
    persistLogos();
  }
  if (unresolved.some((item) => item.name === previous)) {
    unresolved = unresolved.map((item) => (item.name === previous ? { ...item, name } : item));
    persistUnresolved();
  }
  if (rechecks.some((item) => item.name === previous)) {
    rechecks = rechecks.map((item) => (item.name === previous ? { ...item, name } : item));
    persistRechecks();
  }
  if (elements.companyName.value === previous) setCompanyName(name);
  log.info(`"${previous}" is named "${name}" from its LinkedIn page`);
}

// Sets the company's id from its LinkedIn page, and its name when the file
// had none; on failure it's searched by name, and the page is tried again on
// its next search.
async function resolveCompanyId(company) {
  const path = pagePathFor(company);
  if (!path) return;
  try {
    const { id, name, cached, signedIn } = await companyIdFromPage(path);
    company.companyId = id;
    const how = cached ? " (remembered)" : signedIn ? " (with your LinkedIn session)" : "";
    log.info(`"${company.name}": company id ${id} read from linkedin.com/${path}${how}`);
    if (company.nameFromPage && name) renameCompany(company, name);
    persistQueue();
  } catch (error) {
    log.warn(`"${company.name}": company id couldn't be read from linkedin.com/${path} (${error.message}), searching by name`);
  }
}

function logoFor(name) {
  if (!queue.hasLogos) return null;
  const company = findCompany(name);
  return company ? logos[company.name] ?? null : null;
}

// "Current company" strip: the file's logo while a company is processed,
// then the logo of the option chosen in the dropdown with their similarity.
function showCurrentLogo(name, result = null) {
  const fileLogo = logoFor(name);
  elements.currentLogo.hidden = !fileLogo;
  if (!fileLogo) return;
  elements.currentFileLogo.src = fileLogo.thumb;
  elements.currentLogoName.textContent = name;

  const logo = result?.logo;
  elements.currentFoundLogo.hidden = !logo?.url;
  if (logo?.url) elements.currentFoundLogo.src = logo.url;
  elements.currentLogoVerdict.textContent = !result
    ? "searching…"
    : logo?.distance !== undefined
      ? `${logoSimilarity(logo.distance)}% similar · ${logo.verdict}`
      : result.outcome === "unresolved"
        ? "not chosen"
        : result.outcome === "by-id"
          ? "chosen by company id"
          : "no logo to compare";
}

function renderLeadStats() {
  const { pages, tried, saved } = leadStats;
  elements.statPages.textContent = pages;
  elements.statTried.textContent = tried;
  elements.statSaved.textContent = saved;
  elements.statShare.textContent = tried ? `${Math.round((saved / tried) * 100)}%` : "—";
  elements.leadStatsResetButton.disabled = busy || (tried === 0 && pages === 0);
}

function updateLeadStats(changes) {
  leadStats = { ...leadStats, ...changes };
  saveValue(STORAGE_KEYS.leadStats, leadStats);
  renderLeadStats();
}

const countPage = () => updateLeadStats({ pages: leadStats.pages + 1 });

// Only a new lead counts toward the daily limit, not one an earlier search
// saved ("Already saved").
function countLead(saved, isNew) {
  updateLeadStats({ tried: leadStats.tried + 1, saved: leadStats.saved + (saved ? 1 : 0) });
  if (!isNew) return;
  dailyFound = addFound(dailyFound, localDateKey());
  saveValue(STORAGE_KEYS.dailyFound, dailyFound);
  renderDailyLimit();
}

// Why no more leads may be taken today, or null.
function dailyLimitReason() {
  if (!dailyLimitReached(dailyFound, dailyLimit, localDateKey())) return null;
  return `Daily limit reached: ${foundToday(dailyFound, localDateKey())} of ${dailyLimit.value} new leads found today. Turn it off or raise it in Settings to go on`;
}

function renderDailyLimit() {
  const found = foundToday(dailyFound, localDateKey());
  elements.dailyLimitInput.disabled = busy || !dailyLimit.enabled;
  elements.dailyLimitToggle.disabled = busy;
  // Statistics: leads found today against the limit, as a bar; with the
  // limit off, only the count ("unlimited"), no bar.
  elements.statDailyValue.textContent = `${found} / ${dailyLimit.enabled ? dailyLimit.value : "unlimited"}`;
  elements.statDailyTrack.hidden = !dailyLimit.enabled;
  elements.statDailyFill.style.width = `${dailyLimit.enabled ? Math.round(Math.min(found / dailyLimit.value, 1) * 100) : 0}%`;
  elements.statDaily.classList.toggle("stat--warn", dailyLimitReached(dailyFound, dailyLimit, localDateKey()));
}

function renderFailedLimit() {
  elements.failedLimitToggle.disabled = busy;
  elements.failedLimitInput.disabled = busy || !failedLimit.enabled;
}

function handleFailedLimitChange() {
  failedLimit = {
    enabled: elements.failedLimitToggle.checked,
    value: clampCount(elements.failedLimitInput.value, FAILED_IN_A_ROW),
  };
  elements.failedLimitInput.value = failedLimit.value;
  saveValue(STORAGE_KEYS.failedInARow, failedLimit);
  log.info(failedLimit.enabled ? `Failed leads in a row per company: ${failedLimit.value}` : "Failed leads in a row per company: no limit");
  renderFailedLimit();
}

function handleDailyLimitChange() {
  dailyLimit = {
    enabled: elements.dailyLimitToggle.checked,
    value: clampCount(elements.dailyLimitInput.value, DAILY_LIMIT),
  };
  elements.dailyLimitInput.value = dailyLimit.value;
  saveValue(STORAGE_KEYS.dailyLimit, dailyLimit);
  log.info(dailyLimit.enabled ? `Daily limit of found leads: ${dailyLimit.value}` : "Daily limit of found leads off");
  renderDailyLimit();
}

function handleResetLeadStats() {
  if (busy) return;
  const { pages, tried, saved } = leadStats;
  log.info(`Statistics reset (were ${pages} pages, ${tried} leads processed, ${saved} found)`);
  leadStats = { pages: 0, tried: 0, saved: 0 };
  saveValue(STORAGE_KEYS.leadStats, leadStats);
  renderLeadStats();
  renderCompanyProgress("", null);
}

// Statistics, Company leads: the company being processed (the last one, once
// done) and its leadProgress; null before any lead selection. Each column's
// chip takes the column's color (its position, as on the board).
function renderCompanyProgress(name, progress) {
  elements.statCompanyName.textContent = progress ? `· ${name}` : "";
  elements.statCompanyValue.textContent = progress ? `${progress.found} / ${progress.wanted}` : "—";
  const share = progress?.wanted ? Math.min(progress.found / progress.wanted, 1) : 0;
  elements.statCompanyFill.style.width = `${Math.round(share * 100)}%`;
  elements.statCompanyFill.classList.toggle("progress__fill--done", !!progress && progress.found >= progress.wanted);
  elements.statCompanyColumns.replaceChildren(
    ...(progress?.columns ?? []).map((column, position) => {
      const chip = document.createElement("span");
      chip.className = "stat__column";
      chip.classList.toggle("stat__column--done", column.found >= column.wanted);
      chip.dataset.color = position % COLUMN_COLORS;
      chip.textContent = `${column.name} ${column.found} / ${column.wanted}`;
      return chip;
    })
  );
}

function persistUnresolved() {
  saveValue(STORAGE_KEYS.unresolvedCompanies, unresolved);
}

// `manualLeads` (the item's "Leads by hand"): when not given, an item
// already on the list keeps its own.
function addUnresolved(name, reason, manualLeads) {
  const previous = unresolved.find((item) => isSameName(item.name, name));
  const entry = { name, reason, manualLeads: manualLeads ?? previous?.manualLeads ?? false };
  unresolved = [...unresolved.filter((item) => item !== previous), entry];
  persistUnresolved();
}

function setManualLeads(name, manualLeads) {
  unresolved = unresolved.map((item) => (isSameName(item.name, name) ? { ...item, manualLeads } : item));
  persistUnresolved();
  log.info(`"${name}": ${manualLeads ? "its leads are picked by hand after Search" : "its leads are selected automatically after Search"}`);
}

function removeUnresolved(name) {
  const next = unresolved.filter((item) => !isSameName(item.name, name));
  if (next.length === unresolved.length) return;
  unresolved = next;
  persistUnresolved();
}

function renderUnresolved() {
  elements.unresolvedBlock.hidden = unresolved.length === 0;
  elements.unresolvedCount.textContent = unresolved.length;
  elements.unresolvedClearButton.disabled = busy;

  elements.unresolvedList.replaceChildren(
    ...unresolved.map(({ name, reason, manualLeads }) => {
      const item = document.createElement("li");
      item.className = "unresolved__item";

      const text = document.createElement("span");
      text.className = "unresolved__text";
      const title = document.createElement("span");
      title.className = "unresolved__name";
      title.textContent = name;
      const why = document.createElement("span");
      why.className = "unresolved__reason";
      why.textContent = reason;
      text.append(title, why);

      const search = document.createElement("button");
      search.type = "button";
      search.className = "btn btn--secondary btn--small";
      search.textContent = "Search";
      search.title = "Search the company, picking it by hand when it can't be chosen automatically";
      search.disabled = busy;
      search.addEventListener("click", () => handleResolve(name));

      // "Leads by hand": Search only applies the company filter; the leads
      // are then picked by hand, with no automatic lead selection.
      const byHand = document.createElement("label");
      byHand.className = "toggle unresolved__by-hand";
      byHand.title = "When on, Search only applies the company filter: pick the leads by hand, no lead is selected automatically";
      const byHandInput = document.createElement("input");
      byHandInput.type = "checkbox";
      byHandInput.checked = manualLeads;
      byHandInput.disabled = busy;
      byHandInput.addEventListener("change", () => setManualLeads(name, byHandInput.checked));
      const byHandText = document.createElement("span");
      byHandText.textContent = "Leads by hand";
      byHand.append(byHandInput, byHandText);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn";
      remove.textContent = "×";
      remove.title = "Remove from the list";
      remove.setAttribute("aria-label", `Remove ${name} from the list`);
      remove.disabled = busy;
      remove.addEventListener("click", () => {
        removeUnresolved(name);
        log.info(`"${name}" removed from the manual analysis list`);
        updateControls();
      });

      item.append(text, byHand, search, remove);
      return item;
    })
  );
}

function persistRechecks() {
  saveValue(STORAGE_KEYS.recheckCompanies, rechecks);
}

// After a company's search: a recheck leaves the list (unknown emails again
// leave the company as checked); unknown emails on a first search put the
// company on the list, due after the recheck delay.
function endRecheck(name, recheck, unknownEmails) {
  if (recheck) {
    rechecks = removeRecheck(rechecks, name);
    persistRechecks();
    if (unknownEmails) log.warn(`"${name}": unknown emails again on its recheck: no more rechecks, the company is checked`);
    else log.info(`"${name}": rechecked`);
  } else if (unknownEmails) {
    rechecks = scheduleRecheck(rechecks, name, Date.now(), recheckMinutes * 60000);
    persistRechecks();
    log.warn(`"${name}": unknown emails: rechecked in ${recheckMinutes} min, after the company being processed then`);
  }
}

// The recheck list, with each company's countdown (updated by
// tickRechecks without rebuilding the list, so its buttons stay clickable).
function renderRechecks() {
  elements.recheckBlock.hidden = rechecks.length === 0;
  elements.recheckCount.textContent = rechecks.length;
  elements.recheckClearButton.disabled = busy;

  elements.recheckList.replaceChildren(
    ...rechecks.map(({ name, dueAt }) => {
      const item = document.createElement("li");
      item.className = "unresolved__item";

      const text = document.createElement("span");
      text.className = "unresolved__text";
      const title = document.createElement("span");
      title.className = "unresolved__name";
      title.textContent = name;
      const when = document.createElement("span");
      when.className = "unresolved__reason";
      when.dataset.dueAt = dueAt;
      when.textContent = recheckLabel(dueAt);
      text.append(title, when);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn";
      remove.textContent = "×";
      remove.title = "Remove from the list: no recheck";
      remove.setAttribute("aria-label", `Remove ${name} from the recheck list`);
      remove.disabled = busy;
      remove.addEventListener("click", () => {
        rechecks = removeRecheck(rechecks, name);
        persistRechecks();
        log.info(`"${name}" removed from the recheck list`);
        updateControls();
      });

      item.append(text, remove);
      return item;
    })
  );
}

function recheckLabel(dueAt) {
  const left = recheckCountdown(dueAt, Date.now());
  return left === "due" ? "Unknown emails · recheck due" : `Unknown emails · recheck in ${left}`;
}

// Every second: the countdowns, and the buttons once a recheck becomes due.
function tickRechecks() {
  for (const when of elements.recheckList.querySelectorAll("[data-due-at]")) {
    when.textContent = recheckLabel(Number(when.dataset.dueAt));
  }
  const due = dueRecheck(rechecks, Date.now()) !== null;
  if (due !== recheckWasDue) {
    recheckWasDue = due;
    updateControls();
  }
}

function updateControls() {
  const name = elements.companyName.value.trim();
  const hasNext = queue.index < queue.companies.length;
  const recheckDue = dueRecheck(rechecks, Date.now()) !== null;

  elements.companyName.readOnly = busy;
  elements.resultPagesInput.disabled = busy;
  elements.recheckMinutesInput.disabled = busy;
  renderDailyLimit();
  renderFailedLimit();
  elements.searchButton.disabled = busy || !name;
  elements.searchNextButton.disabled = busy || !(hasNext || recheckDue);
  elements.searchAllButton.disabled = busy || !(hasNext || rechecks.length);
  elements.stopButton.disabled = !(batchRunning || waitingManual) || stopRequested;
  elements.prevCompanyButton.disabled = busy || queue.index === 0;
  elements.nextCompanyButton.disabled = busy || !hasNext;
  elements.resetQueueButton.disabled = busy || queue.index === 0;
  elements.fileInput.disabled = busy;
  elements.fileButton.classList.toggle("btn--disabled", busy);

  const withLogo = queue.companies.filter((company) => company.logoPath);
  const loaded = withLogo.filter((company) => logos[company.name]).length;
  elements.logosRow.hidden = !queue.hasLogos;
  elements.logoFolderInput.disabled = busy;
  elements.logoFolderButton.classList.toggle("btn--disabled", busy);
  elements.logosStatus.textContent =
    withLogo.length === 0
      ? "Logos: the logo column is empty"
      : loaded === withLogo.length
        ? `Logos: all ${loaded} loaded`
        : `Logos: ${loaded} of ${withLogo.length} loaded. Choose the folder holding them`;
  elements.logosStatus.classList.toggle("logos-status--warn", loaded < withLogo.length);

  const total = queue.companies.length;
  elements.fileName.textContent = queue.fileName ? `${queue.fileName} · ${total} companies` : "No file selected";
  elements.progressText.textContent = `${queue.index} / ${total}`;
  elements.progressFill.style.width = total ? `${(queue.index / total) * 100}%` : "0%";

  renderLeadStats();
  renderUnresolved();
  renderRechecks();
}

function setCompanyName(name) {
  elements.companyName.value = name;
  saveValue(STORAGE_KEYS.companyName, name);
}

// Saves the company's leads through Lead generator by the job-title
// priorities; returns { saved, invalidDomain, unknownEmails } (selectLeads), or null when
// that failed (a FatalError is passed on). With `recordTitles` (a
// companies-file company) the job titles of the leads read are recorded
// (lead-titles.js).
async function runLeadSelection(name, { recordTitles = false } = {}) {
  status.running(`Selecting leads for "${name}"…`);
  if (recordTitles) countLeadTitlesCompany();
  try {
    const { saved, tried, wanted, pages, invalidDomain, unknownEmails } = await selectLeads(getJobPriorities(), {
      log,
      pages: resultPages,
      maxFailed: failedLimit.enabled ? failedLimit.value : null,
      onPageRead: (leads) => {
        countPage();
        if (recordTitles) recordLeadTitles(leads);
      },
      onLeadTried: countLead,
      onProgress: (progress) => renderCompanyProgress(name, progress),
    });
    (saved >= wanted ? log.success : log.warn)(`"${name}": ${saved} of ${wanted} leads saved (${tried.length} tried, ${pages} results pages read)`);
    return { saved, invalidDomain, unknownEmails };
  } catch (error) {
    if (error instanceof FatalError) throw error;
    log.error(`"${name}": selecting leads failed: ${error.message}`);
    return null;
  }
}

// Runs one company search, reporting to the log; status is left to the caller.
// `company` is the companies-file entry (for its id), else found by name.
// With `manualLeads` only the company filter is applied: the user picks the
// leads by hand, no lead selection runs.
// A company on the recheck list is searched for its recheck: it leaves the
// list once searched (not after a fatal failure, so it stays due), and
// unknown emails again leave it as checked. Unknown emails on a first
// search put it on the list.
// Returns { ok, fatal, outcome, chosen, count, reason, error, selected,
// invalidDomain, unknownEmails, recheck, manualLeads }.
async function runOne(name, { interactive, company = findCompany(name), manualLeads = false }) {
  // Once the daily limit is reached no new company search starts (Search
  // all stops, leaving this company as the next); a company already started
  // is always finished, even past the limit.
  const limitReason = dailyLimitReason();
  if (limitReason) {
    log.error(limitReason);
    return { ok: false, fatal: true, error: new FatalError(limitReason) };
  }
  const startedAt = Date.now();
  const fileName = company?.name;
  await resolveCompanyId(company);
  // Renamed after its LinkedIn page.
  if (company && company.name !== fileName) name = company.name;
  const recheck = findRecheck(rechecks, name) !== null;
  log.info(
    `${recheck ? "Recheck" : "Search"} started: "${name}"${company?.companyId ? ` (company id ${company.companyId})` : ""}`
  );
  const fileLogo = logoFor(name);
  showCurrentLogo(name);
  try {
    const result = await searchCompany(name, {
      log,
      companyId: company?.companyId ?? null,
      fileLogo,
      waitForManualChoice: interactive,
      shouldStop: () => stopRequested,
      onManualWait: () => {
        waitingManual = true;
        status.running(`Pick the company for "${name}" in the Sales Navigator dropdown…`);
        updateControls();
      },
    });
    const took = formatDuration(Date.now() - startedAt);
    showCurrentLogo(name, result);

    if (result.outcome === "unresolved") {
      addUnresolved(name, result.reason);
      log.warn(`"${name}": left for a manual company choice (${result.reason})`);
    } else {
      removeUnresolved(name);
      if (result.count === 0) {
        // A results page with no leads was read all the same.
        countPage();
        log.warn(`"${name}" → "${result.chosen}": no leads list found on the page (${took})`);
      } else if (manualLeads) {
        result.manualLeads = true;
        log.success(`"${name}" → "${result.chosen}": ${result.count} leads on the page (${took}): pick the leads by hand`);
      } else {
        log.success(`"${name}" → "${result.chosen}": ${result.count} leads on the page (${took})`);
        const selection = await runLeadSelection(name, { recordTitles: !!company });
        result.selected = selection?.saved ?? null;
        result.invalidDomain = selection?.invalidDomain === true;
        // Lead generator can't give any of its leads an email: the company
        // goes on the list, its leads to be picked by hand.
        if (result.invalidDomain) {
          addUnresolved(name, LEAD_GENERATOR.invalidDomainText, true);
          log.warn(`"${name}": left for a manual analysis (${LEAD_GENERATOR.invalidDomainText})`);
        }
        result.unknownEmails = selection?.unknownEmails === true;
      }
    }
    endRecheck(name, recheck, result.unknownEmails === true);
    return { ok: true, fatal: false, recheck, ...result };
  } catch (error) {
    log.error(`"${name}": ${error.message}`);
    const fatal = error instanceof FatalError;
    if (!fatal) endRecheck(name, recheck, false);
    return { ok: false, fatal, recheck, error };
  } finally {
    waitingManual = false;
    updateControls();
  }
}

function finishStatus(name, result) {
  if (!result.ok) status.error(`"${name}" failed: ${result.error.message}`);
  else if (result.outcome === "unresolved") status.warn(`"${name}" needs a manual company choice (${result.reason})`);
  else if (result.count === 0) status.warn(`"${name}" → "${result.chosen}": no leads found`);
  else if (result.manualLeads) status.success(`"${name}" → "${result.chosen}": ${result.count} leads found, pick the leads by hand`);
  else if (result.invalidDomain)
    status.warn(`"${name}" → "${result.chosen}": ${result.selected} saved, then stopped (${LEAD_GENERATOR.invalidDomainText}): left for a manual analysis`);
  else if (result.unknownEmails && result.recheck)
    status.warn(`"${name}" → "${result.chosen}": ${result.selected} saved, unknown emails again on the recheck: checked`);
  else if (result.unknownEmails)
    status.warn(`"${name}" → "${result.chosen}": ${result.selected} saved, then stopped (unknown emails): recheck in ${recheckMinutes} min`);
  else if (result.selected === null) status.warn(`"${name}" → "${result.chosen}": ${result.count} leads found, selecting them failed`);
  else status.success(`"${name}" → "${result.chosen}": ${result.count} leads found, ${result.selected} saved`);
}

// `busy` follows the tab's activity (activity.js): set by this card's
// searches and by the companies export alike.
async function withBusy(task) {
  if (!startActivity("search")) return;
  stopRequested = false;
  clearRateLimit();
  try {
    return await task();
  } finally {
    stopRequested = false;
    endActivity("search");
  }
}

// Every search needs at least one job title in some column.
function checkJobTitles() {
  if (ensureJobTitles()) return true;
  const message = "No job titles: add at least one to a job titles column before searching";
  log.error(message);
  status.error(message);
  return false;
}

async function runInteractive(name, { manualLeads = false } = {}) {
  await withBusy(async () => {
    status.running(`Searching "${name}"…`);
    finishStatus(name, await runOne(name, { interactive: true, manualLeads }));
  });
}

async function handleSearch() {
  const name = elements.companyName.value.trim();
  if (!name || busy || !checkJobTitles()) return;
  setCompanyName(name);
  await runInteractive(name);
}

// The list's Search; with the item's "Leads by hand" it only applies the
// company filter, so no job titles are needed.
async function handleResolve(name) {
  const manualLeads = unresolved.find((item) => isSameName(item.name, name))?.manualLeads === true;
  if (busy || (!manualLeads && !checkJobTitles())) return;
  setCompanyName(name);
  await runInteractive(name, { manualLeads });
}

// Shared by Search next and Search all. Doesn't advance past a company when
// the failure was fatal (wrong page...), so it can be retried.
async function searchQueued({ interactive }) {
  const company = queue.companies[queue.index];
  const { name } = company;
  setCompanyName(name);
  status.running(`Searching "${name}" (${queue.index + 1} of ${queue.companies.length})…`);
  const result = await runOne(name, { interactive, company });
  if (!result.fatal) {
    queue.index++;
    persistQueue();
    updateControls();
  }
  return { name: company.name, result };
}

// Searches a company of the recheck list whose time ran out (`entry`); it
// doesn't move the companies file's position.
async function searchRecheck(entry, { interactive }) {
  setCompanyName(entry.name);
  status.running(`Rechecking "${entry.name}" (unknown emails on its first search)…`);
  const result = await runOne(entry.name, { interactive });
  updateControls();
  return { name: entry.name, result };
}

// The next company for Search next / Search all: a recheck whose time ran
// out goes before the next company of the file. Null when neither is there.
function searchNextCompany({ interactive }) {
  const due = dueRecheck(rechecks, Date.now());
  if (due) return searchRecheck(due, { interactive });
  if (queue.index < queue.companies.length) return searchQueued({ interactive });
  return null;
}

async function handleSearchNext() {
  const ready = queue.index < queue.companies.length || dueRecheck(rechecks, Date.now()) !== null;
  if (busy || !ready || !checkJobTitles()) return;
  await withBusy(async () => {
    const next = searchNextCompany({ interactive: true });
    if (!next) return;
    const { name, result } = await next;
    finishStatus(name, result);
  });
}

// Waits `ms`, ending early if Stop is pressed; returns false when stopped.
// `note(secondsLeft)` is the status shown meanwhile.
async function interruptibleWait(ms, note = (left) => `Next company in ${left}s… (${queue.index} of ${queue.companies.length} done)`) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (stopRequested) return false;
    status.note("running", note(Math.ceil((until - Date.now()) / 1000)));
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, until - Date.now())));
  }
  return !stopRequested;
}

// Search all: the companies of the file, each recheck taken as soon as its
// time ran out, after the company being processed. Once the file is done,
// it waits for the rechecks still pending.
async function handleSearchAll() {
  if (busy || (queue.index >= queue.companies.length && !rechecks.length) || !checkJobTitles()) return;
  batchRunning = true;
  const stats = { found: 0, empty: 0, failed: 0 };
  const leftForManual = [];
  const leftInvalidDomain = [];
  const leftUnknown = []; // unknown emails again on the recheck
  const startedAt = Date.now();
  let fatalError = null;
  let stopped = false;

  await withBusy(async () => {
    log.info(
      `Search all started: ${queue.companies.length - queue.index} companies left` +
        (rechecks.length ? `, ${rechecks.length} to recheck` : "")
    );
    for (;;) {
      if (stopRequested) {
        stopped = true;
        break;
      }
      const next = searchNextCompany({ interactive: false });
      if (!next) {
        // Only rechecks not yet due are left: wait for the first one.
        const at = nextRecheckAt(rechecks);
        if (at === null) break;
        const first = rechecks.find((item) => item.dueAt === at);
        if (!(await interruptibleWait(Math.max(at - Date.now(), 0), (left) => `Recheck of "${first.name}" in ${formatDuration(left * 1000)}…`))) {
          stopped = true;
          break;
        }
        continue;
      }
      const { name, result } = await next;
      if (result.fatal) {
        fatalError = result.error;
        break;
      }
      if (!result.ok) stats.failed++;
      else if (result.outcome === "unresolved") leftForManual.push(name);
      else if (result.count === 0) stats.empty++;
      else stats.found++;
      if (result.invalidDomain) leftInvalidDomain.push(name);
      if (result.unknownEmails && result.recheck) leftUnknown.push(name);

      if (queue.index >= queue.companies.length && !rechecks.length) break;
      const [min, max] = TIMING.betweenCompaniesMs;
      if (!(await interruptibleWait(randomBetween(min, max)))) {
        stopped = true;
        break;
      }
    }
  });

  batchRunning = false;
  const took = formatDuration(Date.now() - startedAt);
  const summary =
    `${stats.found} with leads, ${stats.empty} empty, ` +
    `${leftForManual.length} need manual choice, ${leftInvalidDomain.length} with an invalid domain, ` +
    `${leftUnknown.length} with unknown emails after the recheck, ${stats.failed} failed`;

  if (fatalError) {
    log.error(`Search all stopped: ${fatalError.message}`);
    status.error(`Stopped: ${fatalError.message}`);
  } else if (stopped) {
    log.warn(`Search all stopped by user after ${took}: ${summary}`);
    status.warn(`Stopped at ${queue.index} of ${queue.companies.length}: ${summary}`);
  } else if (leftForManual.length || leftInvalidDomain.length || leftUnknown.length || stats.failed) {
    log.warn(`Search all finished in ${took}: ${summary}`);
    status.warn(`Finished: ${summary}`);
  } else {
    log.success(`Search all finished in ${took}: ${summary}`);
    status.success(`Finished: ${summary}`);
  }

  if (leftForManual.length) {
    log.warn(
      `${leftForManual.length} companies need a manual company choice: ${leftForManual.join(", ")}. ` +
        "Use Search in the \"Needs manual analysis\" list."
    );
  }
  if (leftInvalidDomain.length) {
    log.warn(
      `${leftInvalidDomain.length} companies stopped on an invalid domain: ${leftInvalidDomain.join(", ")}. ` +
        "Use Search in the \"Needs manual analysis\" list to pick their leads by hand."
    );
  }
  if (leftUnknown.length) {
    log.warn(`${leftUnknown.length} companies still had unknown emails on their recheck: ${leftUnknown.join(", ")}`);
  }
  if (stopped && rechecks.length) log.info(`${rechecks.length} companies still wait for their recheck`);
  updateControls();
}

function handleStop() {
  if (!(batchRunning || waitingManual)) return;
  stopRequested = true;
  if (waitingManual) {
    log.info("Stop requested: cancelling the manual choice");
    status.note("running", "Cancelling the manual choice…");
  } else {
    log.info("Stop requested: finishing the current company");
    status.note("running", "Stopping after the current company…");
  }
  updateControls();
}

// Shows how a CSV file's columns are read: in detail in the log, and the
// columns found in a dialog the user closes with OK; resolves once they have.
async function acknowledgeColumns(fileName, text) {
  const columns = companiesCsvColumns(text);
  if (!columns) return;
  const { found, lines, readAsList } = columnMappingLines(columns);
  const title = `Columns of "${fileName}"`;
  (readAsList ? log.warn : log.info)(`${title}: ${lines.join(" ")}`);

  const { columnsDialog: dialog, columnsDialogTitle, columnsDialogText, columnsDialogOkButton } = elements;
  columnsDialogTitle.textContent = title;
  columnsDialogText.replaceChildren(
    ...found.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    })
  );
  dialog.classList.toggle("notice--warn", readAsList);
  await new Promise((resolve) => {
    columnsDialogOkButton.addEventListener("click", () => dialog.close(), { once: true });
    dialog.addEventListener("close", resolve, { once: true });
    dialog.showModal();
    columnsDialogOkButton.focus();
  });
}

async function handleFile() {
  const file = elements.fileInput.files?.[0];
  elements.fileInput.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    if (/\.csv$/i.test(file.name)) await acknowledgeColumns(file.name, text);
    const companies = parseCompaniesFile(text);
    if (!companies.length) {
      log.error(`"${file.name}" contains no company names`);
      status.error(`No company names in "${file.name}"`);
      return;
    }
    queue = { fileName: file.name, companies, index: 0, hasLogos: hasLogoColumn(text) };
    persistQueue();
    logos = {};
    persistLogos();
    elements.currentLogo.hidden = true;
    setCompanyName(companies[0].name);
    const withLogo = companies.filter((company) => company.logoPath).length;
    const withId = companies.filter((company) => company.companyId).length;
    const withPage = companies.filter(pagePathFor).length;
    const extras = [
      withId && `${withId} with a company id`,
      withPage && `${withPage} with a LinkedIn page to read the id from when searched`,
      withLogo && `${withLogo} with a logo`,
    ].filter(Boolean);
    log.info(`Loaded ${companies.length} companies from "${file.name}"${extras.length ? `, ${extras.join(", ")}` : ""}`);
    const badIds = companies.filter((company) => company.rawCompanyId && !company.companyId && !pagePathFor(company));
    if (badIds.length) {
      log.warn(
        `company_id isn't a numeric LinkedIn id for ${badIds.length} companies, searched by name instead: ` +
          badIds.map((company) => `"${company.name}" (${company.rawCompanyId})`).join(", ")
      );
    }
    const badPages = companies.filter((company) => company.linkedin && !company.companyId && !pagePathFor(company));
    if (badPages.length) {
      log.warn(
        `linkedin isn't a LinkedIn company page URL for ${badPages.length} companies, searched by name instead: ` +
          badPages.map((company) => `"${company.name}" (${company.linkedin})`).join(", ")
      );
    }
    if (withLogo) log.warn("Choose the folder holding the logos so they can be compared with LinkedIn's");
    status.idle(`${companies.length} companies loaded`);
  } catch (error) {
    log.error(`Could not read "${file.name}": ${error.message}`);
    status.error(`Could not read "${file.name}"`);
  } finally {
    updateControls();
  }
}

// ‹ / ›: moves the list's position by one company without searching, so
// Search next searches the previous company again or skips the current one.
function handleMoveQueue(step) {
  const index = queue.index + step;
  if (busy || index < 0 || index > queue.companies.length) return;
  queue.index = index;
  persistQueue();
  const company = queue.companies[index];
  if (company) setCompanyName(company.name);
  log.info(
    company
      ? `Companies list moved to "${company.name}" (${index + 1} of ${queue.companies.length})`
      : "Companies list moved past the last company"
  );
  updateControls();
}

function handleResetQueue() {
  if (busy) return;
  queue.index = 0;
  persistQueue();
  if (queue.companies.length) setCompanyName(queue.companies[0].name);
  log.info("Companies list restarted from the beginning");
  updateControls();
}

// The user picked the folder holding the CSV's logo files: hash them all.
async function handleLogoFolder() {
  const files = [...(elements.logoFolderInput.files ?? [])];
  elements.logoFolderInput.value = "";
  if (!files.length || busy || !queue.hasLogos) return;

  await withBusy(async () => {
    status.running("Reading logos…");
    const result = await loadCompanyLogos(queue.companies, files, (done, total) =>
      status.note("running", `Reading logos… ${done} of ${total}`)
    );
    logos = Object.fromEntries(result.logos);
    persistLogos();

    const total = queue.companies.filter((company) => company.logoPath).length;
    const summary = `${result.logos.size} of ${total} logos loaded`;
    if (result.missing.length) log.warn(`Logo file not found in the folder for: ${result.missing.join(", ")}`);
    if (result.failed.length) log.warn(`Logo couldn't be read for: ${result.failed.join(", ")}`);
    const complete = result.logos.size === total;
    (complete ? log.success : log.warn)(summary);
    (complete ? status.success : status.warn)(summary);
  });
}

function handleClearRechecks() {
  if (busy || !rechecks.length) return;
  log.info(`Recheck list cleared (${rechecks.length} companies)`);
  rechecks = [];
  persistRechecks();
  updateControls();
}

function handleClearUnresolved() {
  if (busy || !unresolved.length) return;
  log.info(`Manual analysis list cleared (${unresolved.length} companies)`);
  unresolved = [];
  persistUnresolved();
  updateControls();
}

export async function initSearchControls(controlElements) {
  elements = controlElements;

  const storedQueue = await loadValue(STORAGE_KEYS.companyQueue, null);
  if (Array.isArray(storedQueue?.companies)) {
    // Entries were plain names before logos (v0.3).
    const companies = storedQueue.companies
      .map((entry) => (typeof entry === "string" ? { name: entry, logoPath: null } : entry))
      .filter((entry) => typeof entry?.name === "string")
      .map(({ name, companyId, rawCompanyId, logoPath, linkedin, nameFromPage }) => ({
        name,
        companyId: typeof companyId === "string" ? companyId : null,
        rawCompanyId: typeof rawCompanyId === "string" ? rawCompanyId : null,
        logoPath: typeof logoPath === "string" ? logoPath : null,
        linkedin: typeof linkedin === "string" ? linkedin : null,
        nameFromPage: nameFromPage === true,
      }));
    queue = {
      fileName: String(storedQueue.fileName ?? ""),
      companies,
      index: Math.min(Math.max(Number(storedQueue.index) || 0, 0), companies.length),
      // Stored before the flag (v0.6): a file with logo paths had the column.
      hasLogos:
        typeof storedQueue.hasLogos === "boolean"
          ? storedQueue.hasLogos
          : companies.some((company) => company.logoPath),
    };
  }
  const storedLogos = await loadValue(STORAGE_KEYS.companyLogos, {});
  logos = storedLogos && typeof storedLogos === "object" ? storedLogos : {};
  const storedUnresolved = await loadValue(STORAGE_KEYS.unresolvedCompanies, []);
  unresolved = (Array.isArray(storedUnresolved) ? storedUnresolved : [])
    .filter((item) => typeof item?.name === "string")
    .map(({ name, reason, manualLeads }) => ({ name, reason: String(reason ?? ""), manualLeads: manualLeads === true }));
  rechecks = parseRechecks(await loadValue(STORAGE_KEYS.recheckCompanies, []));
  recheckWasDue = dueRecheck(rechecks, Date.now()) !== null;
  const storedStats = await loadValue(STORAGE_KEYS.leadStats, null);
  leadStats = {
    pages: Math.max(Number(storedStats?.pages) || 0, 0),
    tried: Math.max(Number(storedStats?.tried) || 0, 0),
    saved: Math.max(Number(storedStats?.saved) || 0, 0),
  };
  resultPages = clampCount(await loadValue(STORAGE_KEYS.resultPages, RESULT_PAGES.default), RESULT_PAGES);
  recheckMinutes = clampCount(await loadValue(STORAGE_KEYS.recheckMinutes, RECHECK_MINUTES.default), RECHECK_MINUTES);
  const storedLimit = await loadValue(STORAGE_KEYS.dailyLimit, null);
  dailyLimit = {
    enabled: storedLimit?.enabled === true,
    value: clampCount(storedLimit?.value ?? DAILY_LIMIT.default, DAILY_LIMIT),
  };
  dailyFound = await loadValue(STORAGE_KEYS.dailyFound, null);
  const storedFailed = await loadValue(STORAGE_KEYS.failedInARow, null);
  failedLimit = {
    enabled: storedFailed?.enabled === true,
    value: clampCount(storedFailed?.value ?? FAILED_IN_A_ROW.default, FAILED_IN_A_ROW),
  };
  elements.companyName.value = await loadValue(STORAGE_KEYS.companyName, "");

  elements.companyName.addEventListener("input", updateControls);
  elements.companyName.addEventListener("change", () => setCompanyName(elements.companyName.value.trim()));
  elements.companyName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleSearch();
  });
  elements.resultPagesInput.min = RESULT_PAGES.min;
  elements.resultPagesInput.max = RESULT_PAGES.max;
  elements.resultPagesInput.value = resultPages;
  elements.resultPagesInput.addEventListener("change", () => {
    resultPages = clampCount(elements.resultPagesInput.value, RESULT_PAGES);
    elements.resultPagesInput.value = resultPages;
    saveValue(STORAGE_KEYS.resultPages, resultPages);
    log.info(`Result pages to check: ${resultPages}`);
  });
  elements.recheckMinutesInput.min = RECHECK_MINUTES.min;
  elements.recheckMinutesInput.max = RECHECK_MINUTES.max;
  elements.recheckMinutesInput.value = recheckMinutes;
  elements.recheckMinutesInput.addEventListener("change", () => {
    recheckMinutes = clampCount(elements.recheckMinutesInput.value, RECHECK_MINUTES);
    elements.recheckMinutesInput.value = recheckMinutes;
    saveValue(STORAGE_KEYS.recheckMinutes, recheckMinutes);
    log.info(`Recheck after unknown emails: ${recheckMinutes} min (companies already waiting keep their time)`);
  });
  elements.dailyLimitInput.min = DAILY_LIMIT.min;
  elements.dailyLimitInput.max = DAILY_LIMIT.max;
  elements.dailyLimitInput.value = dailyLimit.value;
  elements.dailyLimitToggle.checked = dailyLimit.enabled;
  elements.dailyLimitToggle.addEventListener("change", handleDailyLimitChange);
  elements.dailyLimitInput.addEventListener("change", handleDailyLimitChange);
  elements.failedLimitInput.min = FAILED_IN_A_ROW.min;
  elements.failedLimitInput.max = FAILED_IN_A_ROW.max;
  elements.failedLimitInput.value = failedLimit.value;
  elements.failedLimitToggle.checked = failedLimit.enabled;
  elements.failedLimitToggle.addEventListener("change", handleFailedLimitChange);
  elements.failedLimitInput.addEventListener("change", handleFailedLimitChange);
  // Today's count starts over at midnight while the panel stays open.
  setInterval(renderDailyLimit, 60000);
  setInterval(tickRechecks, 1000);
  elements.searchButton.addEventListener("click", handleSearch);
  elements.searchNextButton.addEventListener("click", handleSearchNext);
  elements.searchAllButton.addEventListener("click", handleSearchAll);
  elements.stopButton.addEventListener("click", handleStop);
  elements.prevCompanyButton.addEventListener("click", () => handleMoveQueue(-1));
  elements.nextCompanyButton.addEventListener("click", () => handleMoveQueue(1));
  elements.resetQueueButton.addEventListener("click", handleResetQueue);
  elements.leadStatsResetButton.addEventListener("click", handleResetLeadStats);
  elements.fileInput.addEventListener("change", handleFile);
  elements.logoFolderInput.addEventListener("change", handleLogoFolder);
  // Only OK closes the column mapping dialog, not Esc.
  elements.columnsDialog.addEventListener("cancel", (event) => event.preventDefault());
  elements.unresolvedClearButton.addEventListener("click", handleClearUnresolved);
  elements.recheckClearButton.addEventListener("click", handleClearRechecks);
  onActivityChange((activity) => {
    busy = activity !== null;
    updateControls();
  });

  updateControls();
  if (unresolved.length) log.warn(`${unresolved.length} companies are still on the manual analysis list`);
  if (rechecks.length) log.info(`${rechecks.length} companies wait for their recheck (Search all or Search next takes them when due)`);
}
