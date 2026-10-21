export const TIMING = {
  // Random pause between two companies in "Search all".
  betweenCompaniesMs: [6000, 12000],
  // How long Sales Navigator may take to reflect a filter change in the URL.
  urlChangeTimeoutMs: 15000,
  // How long a search page may take to reload and render its filters.
  pageReloadTimeoutMs: 30000,
  // How long a selected dropdown option may take to show up in the URL, and
  // a removed company to disappear after in-page navigation.
  selectAttemptTimeoutMs: 6000,
  // Upper bound for one content-script step (typing, waiting for results...).
  contentStepTimeoutMs: 60000,
  // How long a single search waits for the user to pick a company by hand
  // when it can't be chosen automatically.
  manualChoiceTimeoutMs: 5 * 60 * 1000,
};

export const LEADS_COUNT = { min: 0, max: 100, default: 1 };

export const STORAGE_KEYS = {
  board: "priorityBoard",
  leadsCount: "leadsCount",
  companyName: "companyName",
  companyQueue: "companyQueue",
  logLevels: "logLevels",
  jobSectionOpen: "jobSectionOpen",
  unresolvedCompanies: "unresolvedCompanies",
  matchRecords: "companyMatchRecords",
};

export const LOG_LIMIT = 1000;
