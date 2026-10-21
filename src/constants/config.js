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

// Logo distances (logoDistance: 0..32 differing hash bits) between the
// companies file's logo and a dropdown option's logo. Set from the 170
// Umbraco partner logos vs. LinkedIn-like copies (small, JPEG): same logo
// ≤10 in ~75% of cases, ≥20 in ~8%; different logos ≥20 in ~99.8%.
// Tune them from the distances the log reports.
export const LOGO_THRESHOLDS = {
  // At most this far: same logo.
  matchMaxDistance: 10,
  // At least this far: a different logo.
  mismatchMinDistance: 20,
  // The closest option must be this much closer than the next one to win.
  margin: 6,
};

export const LEADS_COUNT = { min: 0, max: 100, default: 1 };

export const STORAGE_KEYS = {
  board: "priorityBoard",
  leadsCount: "leadsCount",
  companyName: "companyName",
  companyQueue: "companyQueue",
  companyLogos: "companyLogos",
  labelingMode: "labelingMode",
  logLevels: "logLevels",
  jobSectionOpen: "jobSectionOpen",
  unresolvedCompanies: "unresolvedCompanies",
  matchRecords: "companyMatchRecords",
};

export const LOG_LIMIT = 1000;
