import { STORAGE_KEYS, TIMING } from "../../constants/config.js";
import { parseCompaniesText } from "../../utils/companies-file.js";
import { formatDuration, randomBetween } from "../../utils/text-utils.js";
import { searchCompany } from "../services/search-runner.js";
import { FatalError } from "../services/tab-service.js";
import { loadValue, saveValue } from "../store/storage.js";
import { log } from "./log.js";
import { status } from "./status.js";

// "Name company" + Search, and the companies file with Search next /
// Search all / Stop and its progress bar.
let elements = null;
let queue = { fileName: "", companies: [], index: 0 };
let busy = false;
let batchRunning = false;
let stopRequested = false;

function persistQueue() {
  saveValue(STORAGE_KEYS.companyQueue, queue);
}

function updateControls() {
  const name = elements.companyName.value.trim();
  const hasNext = queue.index < queue.companies.length;

  elements.companyName.readOnly = busy;
  elements.searchButton.disabled = busy || !name;
  elements.searchNextButton.disabled = busy || !hasNext;
  elements.searchAllButton.disabled = busy || !hasNext;
  elements.stopButton.disabled = !batchRunning || stopRequested;
  elements.resetQueueButton.disabled = busy || queue.index === 0;
  elements.fileInput.disabled = busy;
  elements.fileButton.classList.toggle("btn--disabled", busy);

  const total = queue.companies.length;
  elements.fileName.textContent = queue.fileName ? `${queue.fileName} · ${total} companies` : "No file selected";
  elements.progressText.textContent = `${queue.index} / ${total}`;
  elements.progressFill.style.width = total ? `${(queue.index / total) * 100}%` : "0%";
}

function setCompanyName(name) {
  elements.companyName.value = name;
  saveValue(STORAGE_KEYS.companyName, name);
}

// Runs one company search, reporting to the log; status is left to the caller.
// Returns { ok, fatal, count }.
async function runOne(name) {
  const startedAt = Date.now();
  log.info(`Search started: "${name}"`);
  try {
    const { count } = await searchCompany(name, log);
    const took = formatDuration(Date.now() - startedAt);
    if (count === 0) {
      log.warn(`"${name}": no leads list found on the page (${took})`);
    } else {
      log.success(`"${name}": ${count} leads on the page (${took})`);
    }
    return { ok: true, fatal: false, count };
  } catch (error) {
    log.error(`"${name}": ${error.message}`);
    return { ok: false, fatal: error instanceof FatalError, error };
  }
}

function describeResult(name, result) {
  if (!result.ok) return `"${name}" failed: ${result.error.message}`;
  return result.count === 0 ? `"${name}": no leads found` : `"${name}": ${result.count} leads found`;
}

function finishStatus(name, result) {
  if (!result.ok) status.error(describeResult(name, result));
  else if (result.count === 0) status.warn(describeResult(name, result));
  else status.success(describeResult(name, result));
}

async function withBusy(task) {
  busy = true;
  updateControls();
  try {
    return await task();
  } finally {
    busy = false;
    updateControls();
  }
}

async function handleSearch() {
  const name = elements.companyName.value.trim();
  if (!name || busy) return;
  setCompanyName(name);
  await withBusy(async () => {
    status.running(`Searching "${name}"…`);
    finishStatus(name, await runOne(name));
  });
}

// Shared by Search next and Search all. Doesn't advance past a company when
// the failure was fatal (wrong page...), so it can be retried.
async function searchQueued() {
  const name = queue.companies[queue.index];
  setCompanyName(name);
  status.running(`Searching "${name}" (${queue.index + 1} of ${queue.companies.length})…`);
  const result = await runOne(name);
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
    const { name, result } = await searchQueued();
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
  stopRequested = false;
  const stats = { found: 0, empty: 0, failed: 0 };
  const startedAt = Date.now();
  let fatalError = null;

  await withBusy(async () => {
    log.info(`Search all started: ${queue.companies.length - queue.index} companies left`);
    while (queue.index < queue.companies.length && !stopRequested) {
      const { result } = await searchQueued();
      if (result.fatal) {
        fatalError = result.error;
        break;
      }
      if (!result.ok) stats.failed++;
      else if (result.count === 0) stats.empty++;
      else stats.found++;

      if (queue.index >= queue.companies.length) break;
      const [min, max] = TIMING.betweenCompaniesMs;
      if (!(await interruptibleWait(randomBetween(min, max)))) break;
    }
  });

  batchRunning = false;
  const took = formatDuration(Date.now() - startedAt);
  const summary = `${stats.found} with leads, ${stats.empty} empty, ${stats.failed} failed`;
  if (fatalError) {
    log.error(`Search all stopped: ${fatalError.message}`);
    status.error(`Stopped: ${fatalError.message}`);
  } else if (stopRequested) {
    log.warn(`Search all stopped by user after ${took}: ${summary}`);
    status.warn(`Stopped at ${queue.index} of ${queue.companies.length}: ${summary}`);
  } else {
    log.success(`Search all finished in ${took}: ${summary}`);
    (stats.failed ? status.warn : status.success)(`Finished: ${summary}`);
  }
  stopRequested = false;
  updateControls();
}

function handleStop() {
  if (!batchRunning) return;
  stopRequested = true;
  log.info("Stop requested: finishing the current company");
  status.note("running", "Stopping after the current company…");
  updateControls();
}

async function handleFile() {
  const file = elements.fileInput.files?.[0];
  elements.fileInput.value = "";
  if (!file) return;

  try {
    const companies = parseCompaniesText(await file.text());
    if (!companies.length) {
      log.error(`"${file.name}" contains no company names`);
      status.error(`No company names in "${file.name}"`);
      return;
    }
    queue = { fileName: file.name, companies, index: 0 };
    persistQueue();
    setCompanyName(companies[0]);
    log.info(`Loaded ${companies.length} companies from "${file.name}"`);
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
  if (queue.companies.length) setCompanyName(queue.companies[0]);
  log.info("Companies list restarted from the beginning");
  updateControls();
}

export async function initSearchControls(controlElements) {
  elements = controlElements;

  const storedQueue = await loadValue(STORAGE_KEYS.companyQueue, null);
  if (Array.isArray(storedQueue?.companies)) {
    queue = {
      fileName: String(storedQueue.fileName ?? ""),
      companies: storedQueue.companies.filter((name) => typeof name === "string"),
      index: Math.min(Math.max(Number(storedQueue.index) || 0, 0), storedQueue.companies.length),
    };
  }
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

  updateControls();
}
