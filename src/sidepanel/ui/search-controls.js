import { STORAGE_KEYS, TIMING, RESULT_PAGES, DAILY_LIMIT } from "../../constants/config.js";
import { clampCount } from "../../utils/priority-board.js";
import { localDateKey, foundToday, addFound, dailyLimitReached } from "../../utils/daily-limit.js";
import { parseCompaniesFile, companiesCsvColumns, columnMappingLines, hasLogoColumn } from "../../utils/companies-file.js";
import { companyPagePath } from "../../utils/company-page.js";
import { formatDuration, randomBetween, isSameName } from "../../utils/text-utils.js";
import { logoSimilarity } from "../../utils/image-hash.js";
import { searchCompany } from "../services/search-runner.js";
import { selectLeads } from "../services/lead-runner.js";
import { loadCompanyLogos } from "../services/logo-service.js";
import { companyIdFromPage } from "../services/company-page-service.js";
import { matchRecordCounts, subscribeMatchRecords, downloadMatchRecords, clearMatchRecords } from "../services/match-recorder.js";
import { FatalError, clearRateLimit } from "../services/tab-service.js";
import { ensureJobTitles, getJobPriorities, COLUMN_COLORS } from "./job-board.js";
import { loadValue, saveValue } from "../store/storage.js";
import { log } from "./log.js";
import { status } from "./status.js";

// "Name company" + Search, the companies file with Search next / Search all
// / Stop and its progress bar, and the list of companies left for a manual
// company choice.
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
// Manual labeling: every search waits for the user's pick; the rules'
// choice is only predicted and recorded next to it.
let labeling = false;
let unresolved = []; // [{ name, reason }]
// Leads tried and saved by lead selection, over all searches until Reset.
let leadStats = { pages: 0, tried: 0, saved: 0 };
// How many results pages lead selection may read per search.
let resultPages = RESULT_PAGES.default;
// The daily limit of found leads ({ enabled, value }) and today's count
// ({ date, saved }, daily-limit.js). Reset of the statistics leaves it.
let dailyLimit = { enabled: false, value: DAILY_LIMIT.default };
let dailyFound = null;
let busy = false;
let batchRunning = false;
let waitingManual = false;
let stopRequested = false;
// Clean deletes the records on a second click within CLEAN_CONFIRM_MS.
const CLEAN_CONFIRM_MS = 4000;
let cleanConfirmTimer = null;

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

// CSV data recorded with each match.
function csvFor(company) {
  if (!company) return null;
  return {
    companyId: company.companyId ?? null,
    linkedin: company.linkedin ?? null,
    hasLogo: !!company.logoPath,
  };
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

async function renderRecordCounts() {
  const counts = await matchRecordCounts().catch(() => null);
  if (counts) elements.recordCounts.textContent = `Records: ${counts.auto} auto · ${counts.manual} manual`;
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

function addUnresolved(name, reason) {
  unresolved = [...unresolved.filter((item) => !isSameName(item.name, name)), { name, reason }];
  persistUnresolved();
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
    ...unresolved.map(({ name, reason }) => {
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
      search.title = "Search and pick the company by hand";
      search.disabled = busy;
      search.addEventListener("click", () => handleResolve(name));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn";
      remove.textContent = "×";
      remove.title = "Remove from the list";
      remove.setAttribute("aria-label", `Remove ${name} from the list`);
      remove.disabled = busy;
      remove.addEventListener("click", () => {
        removeUnresolved(name);
        log.info(`"${name}" removed from the manual choice list`);
        updateControls();
      });

      item.append(text, search, remove);
      return item;
    })
  );
}

function updateControls() {
  const name = elements.companyName.value.trim();
  const hasNext = queue.index < queue.companies.length;

  elements.companyName.readOnly = busy;
  elements.resultPagesInput.disabled = busy;
  renderDailyLimit();
  elements.searchButton.disabled = busy || !name;
  elements.searchNextButton.disabled = busy || !hasNext;
  elements.searchAllButton.disabled = busy || !hasNext || labeling;
  elements.searchAllButton.title = labeling ? "Not available in manual labeling: use Search next" : "";
  elements.labelingToggle.checked = labeling;
  elements.labelingToggle.disabled = busy;
  if (!labeling || busy) resetCleanConfirm();
  elements.cleanRecordsButton.hidden = !labeling;
  elements.cleanRecordsButton.disabled = busy;
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
}

function setCompanyName(name) {
  elements.companyName.value = name;
  saveValue(STORAGE_KEYS.companyName, name);
}

// Saves the company's leads through Lead generator by the job-title
// priorities; returns how many were saved, or null when that failed (a
// FatalError is passed on).
async function runLeadSelection(name) {
  status.running(`Selecting leads for "${name}"…`);
  try {
    const { saved, tried, wanted, pages } = await selectLeads(getJobPriorities(), {
      log,
      pages: resultPages,
      onPageRead: countPage,
      onLeadTried: countLead,
      onProgress: (progress) => renderCompanyProgress(name, progress),
    });
    (saved >= wanted ? log.success : log.warn)(`"${name}": ${saved} of ${wanted} leads saved (${tried.length} tried, ${pages} results pages read)`);
    return saved;
  } catch (error) {
    if (error instanceof FatalError) throw error;
    log.error(`"${name}": selecting leads failed: ${error.message}`);
    return null;
  }
}

// Runs one company search, reporting to the log; status is left to the caller.
// `company` is the companies-file entry (for its id), else found by name.
// Returns { ok, fatal, outcome, chosen, count, reason, error }.
async function runOne(name, { interactive, company = findCompany(name) }) {
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
  log.info(`Search started: "${name}"${company?.companyId ? ` (company id ${company.companyId})` : ""}`);
  const fileLogo = logoFor(name);
  showCurrentLogo(name);
  try {
    const result = await searchCompany(name, {
      log,
      companyId: company?.companyId ?? null,
      fileLogo,
      csv: csvFor(company),
      labeling,
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
        log.warn(`"${name}" → "${result.chosen}": no leads list found on the page (${took})`);
      } else {
        log.success(`"${name}" → "${result.chosen}": ${result.count} leads on the page (${took})`);
        result.selected = await runLeadSelection(name);
      }
    }
    return { ok: true, fatal: false, ...result };
  } catch (error) {
    log.error(`"${name}": ${error.message}`);
    return { ok: false, fatal: error instanceof FatalError, error };
  } finally {
    waitingManual = false;
    updateControls();
  }
}

function finishStatus(name, result) {
  if (!result.ok) status.error(`"${name}" failed: ${result.error.message}`);
  else if (result.outcome === "unresolved") status.warn(`"${name}" needs a manual company choice (${result.reason})`);
  else if (result.count === 0) status.warn(`"${name}" → "${result.chosen}": no leads found`);
  else if (result.selected === null) status.warn(`"${name}" → "${result.chosen}": ${result.count} leads found, selecting them failed`);
  else status.success(`"${name}" → "${result.chosen}": ${result.count} leads found, ${result.selected} saved`);
}

async function withBusy(task) {
  busy = true;
  stopRequested = false;
  clearRateLimit();
  updateControls();
  try {
    return await task();
  } finally {
    busy = false;
    stopRequested = false;
    updateControls();
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

async function runInteractive(name) {
  await withBusy(async () => {
    status.running(`Searching "${name}"…`);
    finishStatus(name, await runOne(name, { interactive: true }));
  });
}

async function handleSearch() {
  const name = elements.companyName.value.trim();
  if (!name || busy || !checkJobTitles()) return;
  setCompanyName(name);
  await runInteractive(name);
}

async function handleResolve(name) {
  if (busy || !checkJobTitles()) return;
  setCompanyName(name);
  await runInteractive(name);
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

async function handleSearchNext() {
  if (busy || queue.index >= queue.companies.length || !checkJobTitles()) return;
  await withBusy(async () => {
    const { name, result } = await searchQueued({ interactive: true });
    finishStatus(name, result);
  });
}

// Waits `ms`, ending early if Stop is pressed; returns false when stopped.
async function interruptibleWait(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (stopRequested) return false;
    const left = Math.ceil((until - Date.now()) / 1000);
    status.note("running", `Next company in ${left}s… (${queue.index} of ${queue.companies.length} done)`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, until - Date.now())));
  }
  return !stopRequested;
}

async function handleSearchAll() {
  if (busy || queue.index >= queue.companies.length || !checkJobTitles()) return;
  batchRunning = true;
  const stats = { found: 0, empty: 0, failed: 0 };
  const leftForManual = [];
  const startedAt = Date.now();
  let fatalError = null;
  let stopped = false;

  await withBusy(async () => {
    log.info(`Search all started: ${queue.companies.length - queue.index} companies left`);
    while (queue.index < queue.companies.length) {
      if (stopRequested) {
        stopped = true;
        break;
      }
      const { name, result } = await searchQueued({ interactive: false });
      if (result.fatal) {
        fatalError = result.error;
        break;
      }
      if (!result.ok) stats.failed++;
      else if (result.outcome === "unresolved") leftForManual.push(name);
      else if (result.count === 0) stats.empty++;
      else stats.found++;

      if (queue.index >= queue.companies.length) break;
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
    `${leftForManual.length} need manual choice, ${stats.failed} failed`;

  if (fatalError) {
    log.error(`Search all stopped: ${fatalError.message}`);
    status.error(`Stopped: ${fatalError.message}`);
  } else if (stopped) {
    log.warn(`Search all stopped by user after ${took}: ${summary}`);
    status.warn(`Stopped at ${queue.index} of ${queue.companies.length}: ${summary}`);
  } else if (leftForManual.length || stats.failed) {
    log.warn(`Search all finished in ${took}: ${summary}`);
    status.warn(`Finished: ${summary}`);
  } else {
    log.success(`Search all finished in ${took}: ${summary}`);
    status.success(`Finished: ${summary}`);
  }

  if (leftForManual.length) {
    log.warn(
      `${leftForManual.length} companies need a manual company choice: ${leftForManual.join(", ")}. ` +
        "Use Search in the \"Needs manual choice\" list."
    );
  }
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

async function handleExportRecords() {
  try {
    const counts = await downloadMatchRecords();
    log.info(`Exported match records: ${counts.auto} auto, ${counts.manual} manual`);
  } catch (error) {
    log.error(`Could not export match records: ${error.message}`);
  }
}

function resetCleanConfirm() {
  if (!cleanConfirmTimer) return;
  clearTimeout(cleanConfirmTimer);
  cleanConfirmTimer = null;
  elements.cleanRecordsButton.textContent = "Clean";
  elements.cleanRecordsButton.classList.remove("btn--danger");
}

// Deletes all match records, so a labelling session starts from an empty
// set. The first click only asks for confirmation.
async function handleCleanRecords() {
  if (busy || !labeling) return;
  if (!cleanConfirmTimer) {
    elements.cleanRecordsButton.textContent = "Confirm?";
    elements.cleanRecordsButton.classList.add("btn--danger");
    cleanConfirmTimer = setTimeout(resetCleanConfirm, CLEAN_CONFIRM_MS);
    log.info("Click Clean again to delete all match records (Export them first to keep them)");
    return;
  }
  resetCleanConfirm();
  try {
    const counts = await clearMatchRecords();
    log.success(`Match records deleted: ${counts.auto} auto, ${counts.manual} manual`);
    status.idle("Match records cleaned");
  } catch (error) {
    log.error(`Could not delete match records: ${error.message}`);
  }
}

function handleLabelingToggle() {
  labeling = elements.labelingToggle.checked;
  saveValue(STORAGE_KEYS.labelingMode, labeling);
  log.info(
    labeling
      ? "Manual labeling on: every search waits for your pick; the rules' choice is only predicted and recorded"
      : "Manual labeling off"
  );
  updateControls();
}

function handleClearUnresolved() {
  if (busy || !unresolved.length) return;
  log.info(`Manual choice list cleared (${unresolved.length} companies)`);
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
  labeling = (await loadValue(STORAGE_KEYS.labelingMode, false)) === true;
  const storedLogos = await loadValue(STORAGE_KEYS.companyLogos, {});
  logos = storedLogos && typeof storedLogos === "object" ? storedLogos : {};
  const storedUnresolved = await loadValue(STORAGE_KEYS.unresolvedCompanies, []);
  unresolved = (Array.isArray(storedUnresolved) ? storedUnresolved : [])
    .filter((item) => typeof item?.name === "string")
    .map(({ name, reason }) => ({ name, reason: String(reason ?? "") }));
  const storedStats = await loadValue(STORAGE_KEYS.leadStats, null);
  leadStats = {
    pages: Math.max(Number(storedStats?.pages) || 0, 0),
    tried: Math.max(Number(storedStats?.tried) || 0, 0),
    saved: Math.max(Number(storedStats?.saved) || 0, 0),
  };
  resultPages = clampCount(await loadValue(STORAGE_KEYS.resultPages, RESULT_PAGES.default), RESULT_PAGES);
  const storedLimit = await loadValue(STORAGE_KEYS.dailyLimit, null);
  dailyLimit = {
    enabled: storedLimit?.enabled === true,
    value: clampCount(storedLimit?.value ?? DAILY_LIMIT.default, DAILY_LIMIT),
  };
  dailyFound = await loadValue(STORAGE_KEYS.dailyFound, null);
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
  elements.dailyLimitInput.min = DAILY_LIMIT.min;
  elements.dailyLimitInput.max = DAILY_LIMIT.max;
  elements.dailyLimitInput.value = dailyLimit.value;
  elements.dailyLimitToggle.checked = dailyLimit.enabled;
  elements.dailyLimitToggle.addEventListener("change", handleDailyLimitChange);
  elements.dailyLimitInput.addEventListener("change", handleDailyLimitChange);
  // Today's count starts over at midnight while the panel stays open.
  setInterval(renderDailyLimit, 60000);
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
  elements.labelingToggle.addEventListener("change", handleLabelingToggle);
  elements.exportRecordsButton.addEventListener("click", handleExportRecords);
  elements.cleanRecordsButton.addEventListener("click", handleCleanRecords);
  // Only OK closes the column mapping dialog, not Esc.
  elements.columnsDialog.addEventListener("cancel", (event) => event.preventDefault());
  subscribeMatchRecords(renderRecordCounts);
  renderRecordCounts();
  elements.unresolvedClearButton.addEventListener("click", handleClearUnresolved);

  updateControls();
  if (unresolved.length) log.warn(`${unresolved.length} companies still need a manual company choice`);
}
