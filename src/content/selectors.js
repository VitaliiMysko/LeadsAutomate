window.leadsAutomate = window.leadsAutomate || {};

// LinkedIn hashes its CSS class names per build, so these rely on data-*
// and ARIA attributes. Each entry is a list of fallbacks tried in order;
// when Sales Navigator's markup changes, fix it here.
window.leadsAutomate.SELECTORS = {
  // `data-x-search-filter` holds the filter type, e.g. CURRENT_COMPANY.
  filterFieldset: (filterType) => [`fieldset[data-x-search-filter="${filterType}"]`],
  // Header button that expands a collapsed filter.
  filterExpandButton: ['button[aria-expanded="false"]'],
  filterInput: ['input[role="combobox"]', 'input[type="text"]', "input:not([type])"],
  suggestionOption: ['[role="option"]'],
  // The company logo inside a dropdown option.
  optionLogo: ["img"],
  resultsContainer: ["#search-results-container", "main"],
  resultItem: ['[data-x-search-result="LEAD"]', "ol.artdeco-list > li.artdeco-list__item"],
  // One row of the results list, rendered or not yet: Sales Navigator fills
  // in a row's details only once it's scrolled into view.
  leadRow: ["ol.artdeco-list > li.artdeco-list__item", '[data-x-search-result="LEAD"]'],
  // Inside a row. `data-anonymize` marks the person's data in every
  // interface language.
  leadLink: ['a[data-anonymize="person-name"]', '[data-anonymize="person-name"]', 'a[href*="/sales/lead/"]'],
  leadName: ['[data-anonymize="person-name"]'],
  leadTitle: ['[data-anonymize="title"]', '[data-anonymize="job-title"]'],
  leadCompany: ['[data-anonymize="company-name"]'],
  leadLocation: ['[data-anonymize="location"]'],
  // The "View profile" button of a locked lead (out of the user's network):
  // its page holds no details, so it's never taken.
  leadLocked: ['[data-control-name*="unlock"]', '[data-control-name*="view_profile"]', '[data-x--lead-locked]'],
  // Time in role / in company.
  leadTenure: [".artdeco-entity-lockup__metadata"],
  // The lead's details opened over the results (the content of
  // linkedin.com/sales/lead/...).
  leadPanel: ['[role="dialog"]', "aside", "#inline-sidesheet-outlet"],
};
