import { STORAGE_KEYS, COMPANY_EXPORT } from "../../constants/config.js";
import { clampCount } from "../../utils/priority-board.js";
import {
  newCompanyExport,
  canContinueExport,
  companiesCsv,
  restoreCompanyExport,
  resultNumber,
} from "../../utils/company-export.js";
import { formatDuration } from "../../utils/text-utils.js";
import { exportCompanies, getCompanySearchTab } from "../services/company-export-runner.js";
import { clearRateLimit } from "../services/tab-service.js";
import { currentActivity, startActivity, endActivity, onActivityChange } from "../services/activity.js";
import { loadValue, saveValue } from "../store/storage.js";
import { log } from "./log.js";
import { status } from "./status.js";

// Companies export card: the companies of a Sales Navigator company search
// saved as a CSV file (company_id, company_name). Export starts a new one
// from the page shown; an export cut short (an error, LinkedIn's request
// limit, Stop, the panel closed) is kept (`state`, company-export.js) and
// Continue picks it up after the last company taken.
let elements = null;
let state = null;
let count = COMPANY_EXPORT.default;
let stopRequested = false;
// Export replaces an unfinished export only on a second click within
// REPLACE_CONFIRM_MS.
const REPLACE_CONFIRM_MS = 4000;
let replaceConfirmTimer = null;

const describeLast = ({ last }) => `#${resultNumber(last.page, last.index)} "${last.name}" (page ${last.page})`;

function persist() {
  saveValue(STORAGE_KEYS.companyExport, state);
}

function resetReplaceConfirm() {
  clearTimeout(replaceConfirmTimer);
  replaceConfirmTimer = null;
  elements.startButton.textContent = "Export";
}

// Where the export stands, under its progress bar.
function positionText() {
  if (!state) return "";
  const taken = state.companies.length;
  if (state.done) {
    return taken < state.target
      ? `Done: the search had no more companies, ${taken} exported.`
      : `Done: ${taken} companies exported.`;
  }
  if (currentActivity() === "export") return `Reading results page ${state.page}…`;
  const where = state.last ? `Stopped after ${describeLast(state)}` : "No company exported yet";
  const why = state.stopped ? `: ${state.stopped.reason}` : "";
  return `${where}${why}. Continue goes on from results page ${state.page}.`;
}

function render() {
  const activity = currentActivity();
  const running = activity === "export";
  const taken = state?.companies.length ?? 0;
  const target = state?.target ?? count;

  elements.countInput.disabled = activity !== null;
  elements.startButton.disabled = activity !== null;
  elements.continueButton.disabled = activity !== null || !canContinueExport(state);
  elements.stopButton.disabled = !running || stopRequested;
  elements.downloadButton.disabled = running || !taken;
  if (activity) resetReplaceConfirm();

  elements.progressText.textContent = `${taken} / ${target}`;
  elements.progressFill.style.width = `${Math.round(Math.min(taken / target, 1) * 100)}%`;
  elements.progressFill.classList.toggle("progress__fill--done", !!state?.done);
  elements.position.textContent = positionText();
}

function update(next) {
  state = next;
  persist();
  render();
  if (currentActivity() === "export") {
    status.running(`Exporting companies: ${state.companies.length} of ${state.target}, results page ${state.page}…`);
  }
}

// Saves the companies taken so far as a CSV file through the browser's
// download. With a BOM, so Excel reads the names as UTF-8.
function download() {
  const text = companiesCsv(state.companies);
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `companies-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log.info(`${state.companies.length} companies saved to ${link.download}`);
  return link.download;
}

async function run() {
  if (!startActivity("export")) return;
  stopRequested = false;
  clearRateLimit();
  const startedAt = Date.now();
  update({ ...state, stopped: null });
  try {
    const { state: final, end } = await exportCompanies(state, {
      log,
      shouldStop: () => stopRequested,
      onUpdate: update,
    });
    const took = formatDuration(Date.now() - startedAt);
    if (end === "stopped") {
      update({ ...final, stopped: { reason: "stopped by you", at: Date.now() } });
      log.warn(`Companies export stopped by you after ${took}: ${state.companies.length} of ${state.target}`);
      status.warn(`Export stopped: ${state.companies.length} of ${state.target} companies. Continue goes on from there`);
      return;
    }
    update({ ...final, done: true });
    const fileName = download();
    const short = state.companies.length < state.target;
    (short ? log.warn : log.success)(
      `Companies export finished in ${took}: ${state.companies.length} of ${state.target}` +
        (short ? " (the search has no more companies)" : "")
    );
    (short ? status.warn : status.success)(`${state.companies.length} companies exported to ${fileName}`);
  } catch (error) {
    update({ ...state, stopped: { reason: error.message, at: Date.now() } });
    log.error(`Companies export stopped: ${error.message}`);
    if (state.last) log.info(`Last company exported: ${describeLast(state)}; Continue goes on from results page ${state.page}`);
    status.error(`Export stopped at ${state.companies.length} of ${state.target}: ${error.message}`);
  } finally {
    stopRequested = false;
    endActivity("export");
  }
}

async function handleStart() {
  if (currentActivity()) return;
  if (canContinueExport(state) && state.companies.length && !replaceConfirmTimer) {
    elements.startButton.textContent = "Replace?";
    replaceConfirmTimer = setTimeout(resetReplaceConfirm, REPLACE_CONFIRM_MS);
    log.warn(
      `An unfinished export holds ${state.companies.length} companies: click Export again to start a new one ` +
        "(Download CSV keeps them), or Continue it"
    );
    return;
  }
  resetReplaceConfirm();
  let tab;
  try {
    tab = await getCompanySearchTab();
  } catch (error) {
    log.error(error.message);
    status.error(error.message);
    return;
  }
  state = newCompanyExport(tab.url, count);
  log.info(`Companies export started: ${count} companies from results page ${state.page}`);
  await run();
}

async function handleContinue() {
  if (currentActivity() || !canContinueExport(state)) return;
  resetReplaceConfirm();
  log.info(
    `Companies export continued: ${state.companies.length} of ${state.target}` +
      (state.last ? `, after ${describeLast(state)}` : "")
  );
  await run();
}

function handleStop() {
  if (currentActivity() !== "export") return;
  stopRequested = true;
  log.info("Stop requested: the export stops after the current page");
  status.note("running", "Stopping the export after the current page…");
  render();
}

function handleCountChange() {
  count = clampCount(elements.countInput.value, COMPANY_EXPORT);
  elements.countInput.value = count;
  saveValue(STORAGE_KEYS.companyExportCount, count);
  log.info(`Companies to export: ${count}`);
  render();
}

export async function initCompanyExport(refs) {
  elements = refs;
  state = restoreCompanyExport(await loadValue(STORAGE_KEYS.companyExport, null));
  count = clampCount(await loadValue(STORAGE_KEYS.companyExportCount, COMPANY_EXPORT.default), COMPANY_EXPORT);

  elements.countInput.min = COMPANY_EXPORT.min;
  elements.countInput.max = COMPANY_EXPORT.max;
  elements.countInput.value = count;
  elements.countInput.addEventListener("change", handleCountChange);
  elements.startButton.addEventListener("click", handleStart);
  elements.continueButton.addEventListener("click", handleContinue);
  elements.stopButton.addEventListener("click", handleStop);
  elements.downloadButton.addEventListener("click", () => state?.companies.length && download());
  onActivityChange(render);

  render();
  if (canContinueExport(state)) {
    log.warn(`An unfinished companies export holds ${state.companies.length} of ${state.target} companies: Continue goes on`);
  }
}
