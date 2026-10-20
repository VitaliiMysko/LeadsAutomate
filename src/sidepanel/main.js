import { FILTER_TYPES, getSearchFilters, getFilterTexts, isPeopleSearchUrl } from "../utils/restli-query.js";
import { getActiveTab } from "./services/tab-service.js";
import { initLog, log } from "./ui/log.js";
import { initStatus, status } from "./ui/status.js";
import { initJobBoard, setFilterTitles } from "./ui/job-board.js";
import { initSearchControls } from "./ui/search-controls.js";

const $ = (id) => document.getElementById(id);

let lastTitlesKey = null;

// Job titles come from the active tab's URL, where Sales Navigator records
// every applied filter; refreshed whenever that URL changes.
async function refreshJobTitles() {
  const tab = await getActiveTab().catch(() => null);
  const url = tab?.url;

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
  initLog({
    element: $("log"),
    filterSelect: $("log-level-filter"),
    copyButton: $("log-copy-btn"),
    clearButton: $("log-clear-btn"),
  });

  await initJobBoard({
    root: $("job-board"),
    pool: $("job-pool"),
    poolCount: $("job-pool-count"),
    poolEmpty: $("job-pool-empty"),
    columns: { management: $("management-list"), technical: $("technical-list") },
    countInputs: { management: $("management-count"), technical: $("technical-count") },
  });

  await initSearchControls({
    companyName: $("company-name"),
    searchButton: $("search-btn"),
    fileInput: $("companies-file"),
    fileButton: $("companies-file-btn"),
    fileName: $("companies-file-name"),
    progressText: $("progress-text"),
    progressFill: $("progress-fill"),
    searchNextButton: $("search-next-btn"),
    searchAllButton: $("search-all-btn"),
    stopButton: $("stop-btn"),
    resetQueueButton: $("reset-queue-btn"),
  });

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.url && tab.active) refreshJobTitles();
  });
  chrome.tabs.onActivated.addListener(refreshJobTitles);

  log.info("Side panel ready");
  await refreshJobTitles();
  status.idle("Ready");
});
