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
  // Random pause before going to the next results page.
  betweenPagesMs: [2500, 5000],
  // How long a results page may take to show after the page step.
  pageChangeTimeoutMs: 15000,
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
  // Random pause before opening its panel when it isn't open on the tab.
  beforeOpenPanelMs: [800, 2000],
  // How long its opened panel may take to load and answer.
  panelOpenTimeoutMs: 15000,
  // Pause between two pings while the opened panel loads.
  panelPollMs: 500,
  // The website Extract reads when the company has none: Lead generator's
  // own placeholder (its NO_WEBSITE_FOUND_TEXT), not LinkedIn's text.
  noWebsiteText: "No website found",
};

// How many shorter names (name-variants.js) a search may try after the name
// from the file, when no dropdown option has that name.
export const SHORTER_NAME_ATTEMPTS = 2;

// Logo distances (logoDistance: 0..32 differing hash bits) between the
// companies file's logo and a dropdown option's logo. Set from the 170
// Umbraco partner logos vs. LinkedIn-like copies (small, JPEG): same logo
// ≤10 in ~75% of cases; different logos ≥20 in ~99.8%. Checked on 251
// labelled choices: a unique match chose the right company in 38 of 41.
// Tune them from the distances the log reports.
export const LOGO_THRESHOLDS = {
  // At most this far: same logo.
  matchMaxDistance: 10,
  // The closest option must be this much closer than the next one to win.
  margin: 6,
};

export const LEADS_COUNT = { min: 0, max: 9, default: 1 };

// Leads found for one company in all the columns together, when the user
// turns the limit on (the board's companyLimit).
export const COMPANY_LIMIT = { min: 1, max: 99, default: 5 };

// How many results pages lead selection reads (Sales Navigator shows up to
// 100 pages of LEADS_PER_PAGE leads).
export const RESULT_PAGES = { min: 1, max: 100, default: 1 };
export const LEADS_PER_PAGE = 25;

// How many companies the companies export takes from a company search
// (up to its 100 pages of COMPANIES_PER_PAGE).
export const COMPANY_EXPORT = { min: 1, max: 2500, default: 25 };
export const COMPANIES_PER_PAGE = 25;

// Leads in a row that weren't saved (not opened, no extract, no email, not
// saved) after which lead selection for a company stops and the work goes on
// with the next company, when the user turns it on.
export const FAILED_IN_A_ROW = { min: 1, max: 100, default: 5 };

// The daily limit of found (saved) leads, when the user turns it on.
export const DAILY_LIMIT = { min: 1, max: 1000, default: 50 };

export const STORAGE_KEYS = {
  board: "priorityBoard",
  // Only read: the Management / Technical lead counts of boards saved before
  // each column held its own.
  leadsCount: "leadsCount",
  companyName: "companyName",
  companyQueue: "companyQueue",
  companyLogos: "companyLogos",
  logLevels: "logLevels",
  jobSectionOpen: "jobSectionOpen",
  unresolvedCompanies: "unresolvedCompanies",
  // Only removed: match records kept by earlier versions.
  matchRecords: "companyMatchRecords",
  companyPageIds: "companyPageIds",
  leadStats: "leadStats",
  resultPages: "resultPages",
  collapsedCards: "collapsedCards",
  dailyLimit: "dailyLimit",
  dailyFound: "dailyFound",
  failedInARow: "failedInARow",
  companyExport: "companyExport",
  companyExportCount: "companyExportCount",
  recordLeadTitles: "recordLeadTitles",
  leadTitles: "leadTitles",
};

export const LOG_LIMIT = 1000;
