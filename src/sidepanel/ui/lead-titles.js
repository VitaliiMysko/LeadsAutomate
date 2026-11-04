import { STORAGE_KEYS } from "../../constants/config.js";
import { newLeadTitles, addLeadTitles, leadTitlesCsv, restoreLeadTitles } from "../../utils/lead-titles.js";
import { loadValue, saveValue } from "../store/storage.js";
import { getJobPriorities } from "./job-board.js";
import { downloadCsv } from "./download.js";
import { log } from "./log.js";

// Settings, "Record leads' job titles": while it's on, the job titles of the
// leads on every results page read for a companies-file company (locked
// leads aside) are counted (lead-titles.js), and Download CSV saves them
// with the board column that takes each one. Processing the file from its
// first company starts the record over.
let elements = null;
let enabled = false;
let record = null;

function persist() {
  saveValue(STORAGE_KEYS.leadTitles, record);
}

function render() {
  elements.toggle.checked = enabled;
  elements.downloadButton.disabled = !record?.titles.length;
  if (!record?.titles.length) {
    elements.summary.textContent = enabled
      ? "No titles yet: they're recorded while the companies file is processed, starting over at its first company."
      : "";
    return;
  }
  const since = new Date(record.startedAt).toLocaleString();
  elements.summary.textContent =
    `${record.titles.length} titles from ${record.leads} leads of ${record.companies} companies, since ${since}` +
    (enabled ? "." : " (recording off).");
}

// Called when the companies file is processed from its first company.
export function restartLeadTitles() {
  if (!enabled) return;
  if (record?.titles.length) log.info(`Leads' job titles started over (were ${record.titles.length} titles from ${record.leads} leads)`);
  record = newLeadTitles();
  persist();
  render();
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

export async function initLeadTitles(refs) {
  elements = refs;
  enabled = (await loadValue(STORAGE_KEYS.recordLeadTitles, false)) === true;
  record = restoreLeadTitles(await loadValue(STORAGE_KEYS.leadTitles, null));
  elements.toggle.addEventListener("change", handleToggle);
  elements.downloadButton.addEventListener("click", handleDownload);
  render();
}
