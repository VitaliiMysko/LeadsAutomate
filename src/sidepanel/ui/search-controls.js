import { STORAGE_KEYS, TIMING } from "../../constants/config.js";
import { parseCompaniesFile } from "../../utils/companies-file.js";
import { formatDuration, randomBetween, isSameName } from "../../utils/text-utils.js";
import { logoSimilarity } from "../../utils/image-hash.js";
import { searchCompany } from "../services/search-runner.js";
import { loadCompanyLogos } from "../services/logo-service.js";
import { matchRecordCounts, subscribeMatchRecords, downloadMatchRecords } from "../services/match-recorder.js";
import { FatalError } from "../services/tab-service.js";
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
let queue = { fileName: "", companies: [], index: 0 }; // companies: [{ name, logoPath }]
let logos = {}; // company name → { hash, thumb }
// Manual labeling: every search waits for the user's pick; the rules'
// choice is only predicted and recorded next to it.
let labeling = false;
let unresolved = []; // [{ name, reason }]
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

// CSV data recorded with each match.
function csvFor(name) {
  const company = findCompany(name);
  if (!company) return null;
  return { website: company.website ?? null, country: company.country ?? null, hasLogo: !!company.logoPath };
}

async function renderRecordCounts() {
  const counts = await matchRecordCounts().catch(() => null);
  if (counts) elements.recordCounts.textContent = `Records: ${counts.auto} auto · ${counts.manual} manual`;
}

function logoFor(name) {
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
        : "no logo to compare";
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
  elements.searchButton.disabled = busy || !name;
  elements.searchNextButton.disabled = busy || !hasNext;
  elements.searchAllButton.disabled = busy || !hasNext || labeling;
  elements.searchAllButton.title = labeling ? "Not available in manual labeling: use Search next" : "";
  elements.labelingToggle.checked = labeling;
  elements.labelingToggle.disabled = busy;
  elements.stopButton.disabled = !(batchRunning || waitingManual) || stopRequested;
  elements.resetQueueButton.disabled = busy || queue.index === 0;
  elements.fileInput.disabled = busy;
  elements.fileButton.classList.toggle("btn--disabled", busy);

  const withLogo = queue.companies.filter((company) => company.logoPath);
  const loaded = withLogo.filter((company) => logos[company.name]).length;
  elements.logosRow.hidden = withLogo.length === 0;
  elements.logoFolderInput.disabled = busy;
  elements.logoFolderButton.classList.toggle("btn--disabled", busy);
  elements.logosStatus.textContent =
    loaded === withLogo.length
      ? `Logos: all ${loaded} loaded`
      : `Logos: ${loaded} of ${withLogo.length} loaded. Choose the folder holding them`;
  elements.logosStatus.classList.toggle("logos-status--warn", loaded < withLogo.length);

  const total = queue.companies.length;
  elements.fileName.textContent = queue.fileName ? `${queue.fileName} · ${total} companies` : "No file selected";
  elements.progressText.textContent = `${queue.index} / ${total}`;
  elements.progressFill.style.width = total ? `${(queue.index / total) * 100}%` : "0%";

  renderUnresolved();
}

function setCompanyName(name) {
  elements.companyName.value = name;
  saveValue(STORAGE_KEYS.companyName, name);
}

// Runs one company search, reporting to the log; status is left to the caller.
// Returns { ok, fatal, outcome, chosen, count, reason, error }.
async function runOne(name, { interactive }) {
  const startedAt = Date.now();
  log.info(`Search started: "${name}"`);
  const fileLogo = logoFor(name);
  showCurrentLogo(name);
  try {
    const result = await searchCompany(name, {
      log,
      fileLogo,
      csv: csvFor(name),
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
  else status.success(`"${name}" → "${result.chosen}": ${result.count} leads found`);
}

async function withBusy(task) {
  busy = true;
  stopRequested = false;
  updateControls();
  try {
    return await task();
  } finally {
    busy = false;
    stopRequested = false;
    updateControls();
  }
}

async function runInteractive(name) {
  await withBusy(async () => {
    status.running(`Searching "${name}"…`);
    finishStatus(name, await runOne(name, { interactive: true }));
  });
}

async function handleSearch() {
  const name = elements.companyName.value.trim();
  if (!name || busy) return;
  setCompanyName(name);
  await runInteractive(name);
}

async function handleResolve(name) {
  if (busy) return;
  setCompanyName(name);
  await runInteractive(name);
}

// Shared by Search next and Search all. Doesn't advance past a company when
// the failure was fatal (wrong page...), so it can be retried.
async function searchQueued({ interactive }) {
  const { name } = queue.companies[queue.index];
  setCompanyName(name);
  status.running(`Searching "${name}" (${queue.index + 1} of ${queue.companies.length})…`);
  const result = await runOne(name, { interactive });
  if (!result.fatal) {
    queue.index++;
    persistQueue();
    updateControls();
  }
  return { name, result };
}

async function handleSearchNext() {
  if (busy || queue.index >= queue.companies.length) return;
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
  if (busy || queue.index >= queue.companies.length) return;
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

async function handleFile() {
  const file = elements.fileInput.files?.[0];
  elements.fileInput.value = "";
  if (!file) return;

  try {
    const companies = parseCompaniesFile(await file.text());
    if (!companies.length) {
      log.error(`"${file.name}" contains no company names`);
      status.error(`No company names in "${file.name}"`);
      return;
    }
    queue = { fileName: file.name, companies, index: 0 };
    persistQueue();
    logos = {};
    persistLogos();
    setCompanyName(companies[0].name);
    const withLogo = companies.filter((company) => company.logoPath).length;
    log.info(`Loaded ${companies.length} companies from "${file.name}"${withLogo ? `, ${withLogo} with a logo` : ""}`);
    if (withLogo) log.warn("Choose the folder holding the logos so they can be compared with LinkedIn's");
    status.idle(`${companies.length} companies loaded`);
  } catch (error) {
    log.error(`Could not read "${file.name}": ${error.message}`);
    status.error(`Could not read "${file.name}"`);
  } finally {
    updateControls();
  }
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
  if (!files.length || busy) return;

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
    if (result.failed.length) log.warn(`Logo couldn't be read (or is blank) for: ${result.failed.join(", ")}`);
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
      .map(({ name, logoPath, website, country }) => ({
        name,
        logoPath: typeof logoPath === "string" ? logoPath : null,
        website: typeof website === "string" ? website : null,
        country: typeof country === "string" ? country : null,
      }));
    queue = {
      fileName: String(storedQueue.fileName ?? ""),
      companies,
      index: Math.min(Math.max(Number(storedQueue.index) || 0, 0), companies.length),
    };
  }
  labeling = (await loadValue(STORAGE_KEYS.labelingMode, false)) === true;
  const storedLogos = await loadValue(STORAGE_KEYS.companyLogos, {});
  logos = storedLogos && typeof storedLogos === "object" ? storedLogos : {};
  const storedUnresolved = await loadValue(STORAGE_KEYS.unresolvedCompanies, []);
  unresolved = (Array.isArray(storedUnresolved) ? storedUnresolved : [])
    .filter((item) => typeof item?.name === "string")
    .map(({ name, reason }) => ({ name, reason: String(reason ?? "") }));
  elements.companyName.value = await loadValue(STORAGE_KEYS.companyName, "");

  elements.companyName.addEventListener("input", updateControls);
  elements.companyName.addEventListener("change", () => setCompanyName(elements.companyName.value.trim()));
  elements.companyName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleSearch();
  });
  elements.searchButton.addEventListener("click", handleSearch);
  elements.searchNextButton.addEventListener("click", handleSearchNext);
  elements.searchAllButton.addEventListener("click", handleSearchAll);
  elements.stopButton.addEventListener("click", handleStop);
  elements.resetQueueButton.addEventListener("click", handleResetQueue);
  elements.fileInput.addEventListener("change", handleFile);
  elements.logoFolderInput.addEventListener("change", handleLogoFolder);
  elements.labelingToggle.addEventListener("change", handleLabelingToggle);
  elements.exportRecordsButton.addEventListener("click", handleExportRecords);
  subscribeMatchRecords(renderRecordCounts);
  renderRecordCounts();
  elements.unresolvedClearButton.addEventListener("click", handleClearUnresolved);

  updateControls();
  if (unresolved.length) log.warn(`${unresolved.length} companies still need a manual company choice`);
}
