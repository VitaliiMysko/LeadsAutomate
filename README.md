# Leads Automate

Chrome side-panel extension (Manifest V3) for **LinkedIn Sales Navigator people search** (`linkedin.com/sales/search/people`). It prioritizes the job titles from the search's "Current job title" filter and runs company-by-company searches through the "Current company" filter. It is meant to work alongside the [Lead generator](../LeadGenerator) extension; that integration isn't implemented yet.

## Features (v0.1)

- **Job list**: every job title selected in Sales Navigator's *Current job title* filter (included values only). It refreshes whenever the search URL changes.
- **Management / Technical** columns: drag titles from the Job list into a column, reorder them within it, or move them to the other column. The first title in a column has the highest priority. Hover a title to see ↑ / ↓ / × buttons (× sends it back to the Job list). A title that is no longer in the filter stays in its column, shown struck through.
- **Leads** fields: the number of Management and Technical leads wanted per search (0–100). The value is stored but not used yet.
- **Company → Search**: replaces the *Current company* filter with the typed name, picks the best typeahead suggestion and waits for the results.
- **Companies file**: a text file with company names separated by commas (line breaks also work). Duplicates and empty entries are skipped.
  - **Search next**: searches the next company in the list.
  - **Search all**: searches the remaining companies one by one, with a random pause of 6–12 s between them. **Stop** ends the run after the current company. **↺** restarts the list from the beginning.
  - The progress bar shows processed / total companies. The company being processed is shown in the *Name company* field.
  - The list and the current position are remembered after the panel is closed.
- **Status area**: shows the current operation, how long it has been running, and its outcome or total time.
- **Log**: a scrollable list with time-stamped `DEBUG` / `INFO` / `OK` / `WARN` / `ERROR` entries. It has a level filter and Copy / Clear buttons. Lines marked `[page]` come from the script running on the LinkedIn page.

Board, lead counts, company name and the companies list are kept in `chrome.storage.local`.

## Install (development)

1. `chrome://extensions/` → enable **Developer mode** → **Load unpacked** → select this folder.
2. Reload any Sales Navigator tabs that were already open.
3. On a Sales Navigator tab, click the extension's toolbar icon to open the side panel. The panel is available only on `linkedin.com/sales/*` tabs.

Requires Chrome 116+.

## How it works

- `src/background.js` enables the side panel only on Sales Navigator tabs.
- The side panel (`sidepanel.html`, `src/sidepanel/`) does all the orchestration. It reads the search filters from the tab URL: Sales Navigator stores them in the `query` parameter in Rest.li syntax, parsed by `src/utils/restli-query.js`. This works in any interface language and doesn't depend on LinkedIn's hashed class names. The URL is also used to check that each step (removing the old company, applying the new one) really happened.
- The content script (`src/content/`) performs the individual page steps: remove filter values, type into the filter, pick a suggestion, wait for results. All DOM selectors are in `src/content/selectors.js`; when Sales Navigator's markup changes, update them there.

## Tests

```
npm install
npm test
```

Jest covers the pure logic in `src/utils/`. DOM and Chrome API code is verified manually in the browser.

## Notes

LinkedIn's User Agreement restricts automated activity. The extension paces its actions (randomized delays, character-by-character typing, pauses between companies), but runs should still be moderate in volume.
