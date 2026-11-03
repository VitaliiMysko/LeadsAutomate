import { FILTER_TYPES, getSearchFilters, getFilterTexts, isPeopleSearchUrl, isLeadUrl } from "../utils/restli-query.js";
import { STORAGE_KEYS } from "../constants/config.js";
import { getActiveTab } from "./services/tab-service.js";
import { removeValue } from "./store/storage.js";
import { initLog, log } from "./ui/log.js";
import { initStatus, status } from "./ui/status.js";
import { initJobBoard, setFilterTitles } from "./ui/job-board.js";
import { initSearchControls } from "./ui/search-controls.js";
import { initCollapsibleCards } from "./ui/collapsible-cards.js";
import { initCompanyExport } from "./ui/company-export.js";

const $ = (id) => document.getElementById(id);

let lastTitlesKey = null;

// Job titles come from the active tab's URL, where Sales Navigator records
// every applied filter; refreshed whenever that URL changes.
async function refreshJobTitles() {
  const tab = await getActiveTab().catch(() => null);
  const url = tab?.url;
  // A lead opened from the results: the search (and its filters) is still
  // behind it.
  if (isLeadUrl(url)) return;

  let titles = null;
  let message = "";
  if (!isPeopleSearchUrl(url)) {
    message = "Open a Sales Navigator people search to load job titles";
  } else if (!getSearchFilters(url)) {
    message = "No filters found in the page URL. Change any filter in Sales Navigator to refresh.";
  } else {
    titles = getFilterTexts(url, FILTER_TYPES.CURRENT_TITLE);
    if (!titles.length) message = "No \"Current job title\" selected in the Sales Navigator filters";
  }

  const key = JSON.stringify(titles);
  if (key !== lastTitlesKey) {
    lastTitlesKey = key;
    if (titles?.length) log.info(`Job titles from filters (${titles.length}): ${titles.join(", ")}`);
    else log.warn(`Job titles: ${message}`);
  }
  setFilterTitles(titles, message);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("app-version").textContent = `v${chrome.runtime.getManifest().version}`;

  initStatus($("status"));
  await initCollapsibleCards();
  await initLog({
    element: $("log"),
    filtersContainer: $("log-filters"),
    copyButton: $("log-copy-btn"),
    clearButton: $("log-clear-btn"),
  });

  await initJobBoard({
    root: $("job-board"),
    section: $("job-section"),
    sectionSummary: $("job-section-summary"),
    pool: $("job-pool"),
    poolCount: $("job-pool-count"),
    poolEmpty: $("job-pool-empty"),
    companyLimitToggle: $("company-limit-toggle"),
    companyLimitInput: $("company-limit"),
    board: $("job-columns"),
    addColumnButton: $("add-column-btn"),
    saveButton: $("board-save-btn"),
    fileInput: $("board-file"),
  });

  await initSearchControls({
    companyName: $("company-name"),
    searchButton: $("search-btn"),
    resultPagesInput: $("result-pages"),
    dailyLimitToggle: $("daily-limit-toggle"),
    dailyLimitInput: $("daily-limit"),
    statDaily: $("stat-daily"),
    statDailyValue: $("stat-daily-value"),
    statDailyTrack: $("stat-daily-track"),
    statDailyFill: $("stat-daily-fill"),
    statCompanyName: $("stat-company-name"),
    statCompanyValue: $("stat-company-value"),
    statCompanyFill: $("stat-company-fill"),
    statCompanyColumns: $("stat-company-columns"),
    fileInput: $("companies-file"),
    fileButton: $("companies-file-btn"),
    fileName: $("companies-file-name"),
    progressText: $("progress-text"),
    progressFill: $("progress-fill"),
    statPages: $("stat-pages"),
    statTried: $("stat-tried"),
    statSaved: $("stat-saved"),
    statShare: $("stat-share"),
    leadStatsResetButton: $("lead-stats-reset-btn"),
    searchNextButton: $("search-next-btn"),
    searchAllButton: $("search-all-btn"),
    stopButton: $("stop-btn"),
    prevCompanyButton: $("prev-company-btn"),
    nextCompanyButton: $("next-company-btn"),
    resetQueueButton: $("reset-queue-btn"),
    unresolvedBlock: $("unresolved-block"),
    unresolvedCount: $("unresolved-count"),
    unresolvedList: $("unresolved-list"),
    unresolvedClearButton: $("unresolved-clear-btn"),
    logosRow: $("logos-row"),
    logoFolderInput: $("logo-folder"),
    logoFolderButton: $("logo-folder-btn"),
    logosStatus: $("logos-status"),
    currentLogo: $("current-logo"),
    currentFileLogo: $("current-file-logo"),
    currentFoundLogo: $("current-found-logo"),
    currentLogoName: $("current-logo-name"),
    currentLogoVerdict: $("current-logo-verdict"),
    columnsDialog: $("columns-dialog"),
    columnsDialogTitle: $("columns-dialog-title"),
    columnsDialogText: $("columns-dialog-text"),
    columnsDialogOkButton: $("columns-dialog-ok-btn"),
  });

  await initCompanyExport({
    countInput: $("export-count"),
    progressText: $("export-progress-text"),
    progressFill: $("export-progress-fill"),
    position: $("export-position"),
    startButton: $("export-start-btn"),
    continueButton: $("export-continue-btn"),
    stopButton: $("export-stop-btn"),
    downloadButton: $("export-download-btn"),
  });

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.url && tab.active) refreshJobTitles();
  });
  chrome.tabs.onActivated.addListener(refreshJobTitles);

  // Match records are no longer kept: drops those left by earlier versions.
  await removeValue(STORAGE_KEYS.matchRecords);

  log.info("Side panel ready");
  await refreshJobTitles();
  status.idle("Ready");
});
