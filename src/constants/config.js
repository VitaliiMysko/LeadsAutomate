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
  // Random pause before typing a shorter name when the first had no match.
  betweenRetypesMs: [1500, 3500],
  // Random pause before setting a company by its id from the companies file.
  beforeCompanyByIdMs: [800, 2000],
  // Random pause before reading a company id from its LinkedIn page.
  beforeCompanyPageMs: [800, 2000],
  // Pause before each lead is opened from the results. A fixed 3 s for now
  // (a placeholder); the click itself adds a short random delay.
  beforeLeadClickMs: [3000, 3000],
  // How long an opened lead's details may take to show.
  leadPanelTimeoutMs: 8000,
  // Random pause before each Lead generator step (Extract, Generate, Save).
  betweenLeadGeneratorStepsMs: [1500, 3000],
  // Upper bound for one Lead generator step: Extract waits for the company's
  // details, read from its LinkedIn page in a background tab.
  leadGeneratorStepTimeoutMs: 120000,
};

// The companion Lead generator extension, found by its name among the
// installed extensions.
export const LEAD_GENERATOR = {
  name: "Lead generator",
  pingTimeoutMs: 5000,
};

// How many shorter names (name-variants.js) a search may try after the name
// from the file, when no dropdown option has that name.
export const SHORTER_NAME_ATTEMPTS = 2;

// Logo distances (logoDistance: 0..32 differing hash bits) between the
// companies file's logo and a dropdown option's logo. Set from the 170
// Umbraco partner logos vs. LinkedIn-like copies (small, JPEG): same logo
// ≤10 in ~75% of cases; different logos ≥20 in ~99.8%. Checked on 251
// labelled choices: a unique match chose the right company in 38 of 41.
// Tune them from the distances the log and the match records report.
export const LOGO_THRESHOLDS = {
  // At most this far: same logo.
  matchMaxDistance: 10,
  // The closest option must be this much closer than the next one to win.
  margin: 6,
};

export const LEADS_COUNT = { min: 0, max: 9, default: 1 };

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
  companyPageIds: "companyPageIds",
  leadStats: "leadStats",
};

export const LOG_LIMIT = 1000;
