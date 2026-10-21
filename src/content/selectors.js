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
};
