import { STORAGE_KEYS } from "../../constants/config.js";
import { newLeadTitles, addLeadTitles, leadTitlesCsv, restoreLeadTitles } from "../../utils/lead-titles.js";
import { loadValue, saveValue } from "../store/storage.js";
import { getJobPriorities } from "./job-board.js";
import { downloadCsv } from "./download.js";
import { log } from "./log.js";

// Settings, "Record leads' job titles": while it's on, the job titles of the
// leads on every results page read for a companies-file company (locked
// leads aside) are counted (lead-titles.js), and Download CSV saves them
// with the board column that takes each one. The record keeps growing over
// every companies file processed, until Clear (a second click within
// CLEAR_CONFIRM_MS confirms it).
const CLEAR_CONFIRM_MS = 4000;
let elements = null;
let enabled = false;
let record = null;
let clearConfirmTimer = null;

function persist() {
  saveValue(STORAGE_KEYS.leadTitles, record);
}

function render() {
  elements.toggle.checked = enabled;
  elements.downloadButton.disabled = !record?.titles.length;
  elements.clearButton.disabled = !record?.titles.length;
  elements.clearButton.textContent = clearConfirmTimer ? "Clear?" : "Clear";
  if (!record?.titles.length) {
    elements.summary.textContent = enabled
      ? "No titles yet: they're recorded while companies files are processed, kept until Clear."
      : "";
    return;
  }
  const since = new Date(record.startedAt).toLocaleString();
  elements.summary.textContent =
    `${record.titles.length} titles from ${record.leads} leads of ${record.companies} companies, since ${since}` +
    (enabled ? "." : " (recording off).");
}

// Called once per lead selection of a companies-file company.
export function countLeadTitlesCompany() {
  if (!enabled) return;
  record = { ...(record ?? newLeadTitles()), companies: (record?.companies ?? 0) + 1 };
  persist();
  render();
}

// Called with the leads of each results page read for that company.
export function recordLeadTitles(leads) {
  if (!enabled) return;
  record = addLeadTitles(record ?? newLeadTitles(), leads);
  persist();
  render();
}

function handleToggle() {
  enabled = elements.toggle.checked;
  saveValue(STORAGE_KEYS.recordLeadTitles, enabled);
  log.info(enabled ? "Recording leads' job titles: on" : "Recording leads' job titles: off");
  render();
}

function handleDownload() {
  if (!record?.titles.length) return;
  const fileName = downloadCsv(leadTitlesCsv(record, getJobPriorities().columns), "lead-titles");
  log.info(`${record.titles.length} leads' job titles saved to ${fileName}`);
}

function resetClearConfirm() {
  clearTimeout(clearConfirmTimer);
  clearConfirmTimer = null;
  render();
}

// Clear deletes the record, so it asks for a second click ("Clear?").
function handleClear() {
  if (!record?.titles.length) return;
  if (!clearConfirmTimer) {
    clearConfirmTimer = setTimeout(resetClearConfirm, CLEAR_CONFIRM_MS);
    render();
    return;
  }
  log.info(`Leads' job titles cleared (were ${record.titles.length} titles from ${record.leads} leads of ${record.companies} companies)`);
  record = null;
  persist();
  resetClearConfirm();
}

export async function initLeadTitles(refs) {
  elements = refs;
  enabled = (await loadValue(STORAGE_KEYS.recordLeadTitles, false)) === true;
  record = restoreLeadTitles(await loadValue(STORAGE_KEYS.leadTitles, null));
  elements.toggle.addEventListener("change", handleToggle);
  elements.downloadButton.addEventListener("click", handleDownload);
  elements.clearButton.addEventListener("click", handleClear);
  render();
}
