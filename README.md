# Leads Automate

Chrome side-panel extension (Manifest V3) for **LinkedIn Sales Navigator people search** (`linkedin.com/sales/search/people`). It prioritizes the job titles from the search's "Current job title" filter and runs company-by-company searches through the "Current company" filter. It is meant to work alongside the [Lead generator](../LeadGenerator) extension; that integration isn't implemented yet.

## Features (v0.3)

The panel shows these sections, top to bottom:
1. status area;
2. Company;
3. Companies file;
4. **Job titles**: a collapsible section holding the Job list and the Management / Technical columns. Click its header to hide or show it. The header always shows the counts (titles in the filter, titles in each column), and the open / closed state is remembered;
5. Log.

- **Job list**: every job title selected in Sales Navigator's *Current job title* filter (included values only). It refreshes whenever the search URL changes.
- **Management / Technical** columns: drag titles from the Job list into a column, reorder them within it, or move them to the other column. The first title in a column has the highest priority. The columns have a fixed height and scroll when they hold more titles than fit. Hover a title to see ↑ / ↓ / × buttons (× sends it back to the Job list). A title that is no longer in the filter stays in its column, shown struck through.
  - **Manual entry**: type a title into the *Add job title* field under a column and press Enter or **+**. It goes to the end of that column, dashed and marked *manual*. If the title is already on the board, in the Job list, or differs only in case or spacing, the existing spelling is used and moved to this column. × on a manual title removes it.
- **Leads** fields: the number of Management and Technical leads wanted per search (0–100). The value is stored but not used yet.
- **Company → Search**: removes every value already in the *Current company* filter (included and excluded), types the name and picks the company from the dropdown, then waits for the results.
  - Old values are removed without reloading the page. The extension switches the page to the same search URL without the company filter, the way Back / Forward does, and Sales Navigator updates the filters (about 0.2 s). Script-generated clicks on the remove buttons have no effect. If the page doesn't follow, the search URL is reloaded without the filter, and a `DEBUG` snapshot of the selected value goes to the log.
  - The dropdown option is selected with the keyboard, because Sales Navigator ignores script-generated clicks and hovering. The arrow keys start from the option Sales Navigator highlights when the list opens, so the extension presses ↑ or ↓ toward the chosen option, then Enter. If the chosen option is already highlighted, it steps one option away and back, because Enter on that initial highlight adds the typed text as free text instead of the company.
  - The applied value in the URL must be the chosen option and carry a LinkedIn company id. A different company or free text is logged as an error, removed, and the search counts as failed. A wrong company never stays applied.
  - **Automatic choice**. The rules are tried in this order, and a rule applies only when exactly one option matches it:
    1. an exact match, case-sensitive;
    2. an exact match ignoring case;
    3. the dropdown has only one option;
    4. a match ignoring the legal form, e.g. *Acme* ↔ *Acme GmbH* or *Acme, Inc.* ↔ *Acme LLC*.

    The log names the rule that chose the company, or the reason no company could be chosen.
  - **Manual choice**: when no rule applies, **Search**, **Search next** and the list's **Search** leave the dropdown open and wait up to 5 min for you to pick the company in Sales Navigator. **Stop** cancels the wait. A cancelled or timed-out wait puts the company on the *Needs manual choice* list.
- **Companies file**: a text file with company names separated by commas (line breaks also work). Duplicates and empty entries are skipped.
  - **Search next**: searches the next company in the list.
  - **Search all**: searches the remaining companies one by one, with a random pause of 6–12 s between them. It never waits for you: a company that can't be chosen automatically goes to the *Needs manual choice* list and the run continues. At the end, the status area and the log report how many companies need a manual choice, and which ones. **Stop** ends the run after the current company. **↺** restarts the list from the beginning.
  - The progress bar shows processed / total companies. The company being processed is shown in the *Name company* field.
  - The list and the current position are remembered after the panel is closed.
  - **Needs manual choice**: companies waiting for a manual choice, each with the reason. **Search** runs that company with a manual choice, and the company leaves the list once its filter is applied. **×** or **Clear** removes companies from the list.
- **Match records** (internal, not shown in the UI and never written to disk): every company choice is stored inside the extension, automatic choices under `auto`, manual ones under `manual`. A record holds `time`, `typed` (the name searched for), `chosen` (the company applied), `rule` (auto) or `reason` (why the automatic choice failed, manual), and `options` (all names in the dropdown). They're kept to tune the automatic choice later. Only the last 5000 records of each kind are kept.
- **Status area**: shows the current operation, how long it has been running, and its outcome or total time.
- **Log**: a scrollable list with time-stamped `DEBUG` / `INFO` / `OK` / `WARN` / `ERROR` entries, with Copy (copies the visible entries) and Clear buttons. Lines marked `[page]` come from the script running on the LinkedIn page.
  - **Quick filters**: one toggle per marker with its entry count. Click a toggle to show or hide that marker, double-click it to show only that marker, or click **All** to show everything. The selection is remembered.

Board (including manual titles), lead counts, company name, the companies list, the manual choice list, match records (key `companyMatchRecords`) and the log filter selection are kept in `chrome.storage.local`.

## Install (development)

1. `chrome://extensions/` → enable **Developer mode** → **Load unpacked** → select this folder.
2. Reload any Sales Navigator tabs that were already open.
3. On a Sales Navigator tab, click the extension's toolbar icon to open the side panel. The panel is available only on `linkedin.com/sales/*` tabs.

Requires Chrome 116+.

## How it works

- `src/background.js` enables the side panel only on Sales Navigator tabs.
- The side panel (`sidepanel.html`, `src/sidepanel/`) does all the orchestration. It reads the search filters from the tab URL: Sales Navigator stores them in the `query` parameter in Rest.li syntax, parsed by `src/utils/restli-query.js`. This works in any interface language and doesn't depend on LinkedIn's hashed class names. The URL is also used to check that each step (removing the old company, applying the new one) really happened.
- The content script (`src/content/`) performs the individual page steps:
  - switch the page to a URL without a filter (in-page navigation);
  - type into the filter and return the dropdown's option names;
  - select a given option with the keyboard;
  - close the dropdown;
  - wait for results.

  The side panel decides which option to select (`src/utils/company-match.js`). All DOM selectors are in `src/content/selectors.js`; when Sales Navigator's markup changes, update them there.

## Tests

```
npm install
npm test
```

Jest covers the pure logic in `src/utils/`. DOM and Chrome API code is verified manually in the browser.

## Notes

LinkedIn's User Agreement restricts automated activity. The extension paces its actions (randomized delays, character-by-character typing, pauses between companies), but runs should still be moderate in volume.
