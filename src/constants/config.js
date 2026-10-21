export const TIMING = {
  // Random pause between two companies in "Search all".
  betweenCompaniesMs: [6000, 12000],
  // How long Sales Navigator may take to reflect a filter change in the URL.
  urlChangeTimeoutMs: 15000,
  // Upper bound for one content-script step (typing, waiting for results...).
  contentStepTimeoutMs: 60000,
};

export const LEADS_COUNT = { min: 0, max: 100, default: 1 };

export const STORAGE_KEYS = {
  board: "priorityBoard",
  leadsCount: "leadsCount",
  companyName: "companyName",
  companyQueue: "companyQueue",
  logLevels: "logLevels",
};

export const LOG_LIMIT = 1000;
