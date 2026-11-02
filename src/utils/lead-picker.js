import { normalizeName } from "./text-utils.js";
import { COLUMNS } from "./priority-board.js";

// Chooses which leads of a search results page to take, by the job-title
// priorities of the Management and Technical columns (priority-board.js,
// getColumnPlan). Leads: [{ index, name, title, ... }] in page order.

// Lower case, punctuation and symbols as spaces: "Head of R&D, EMEA" →
// "head of r d emea".
function titleWords(value) {
  return normalizeName(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// What separates the titles a lead holds at once: "and", "at" (whole words,
// any case), & / | , ( ) [ ] @ ;
// "Technical Director at Acme" → "Technical Director", "Acme".
const TITLE_SEPARATOR = /(?<![\p{L}\p{N}])(?:and|at)(?![\p{L}\p{N}])|[&/|,()[\]@;]/iu;

// The separate titles of a lead's job title, compared as titleWords.
export function splitTitle(leadTitle) {
  return String(leadTitle ?? "")
    .split(TITLE_SEPARATOR)
    .map(titleWords)
    .filter(Boolean);
}

// The job title is the lead's whole title or one of its separate titles,
// in any letter case: "CTO" matches "CTO & Co-founder", "Director" doesn't
// match "Director Of Operations". The whole title counts too, for job
// titles holding a separator ("Head of R&D").
export function titleMatches(leadTitle, jobTitle) {
  const job = titleWords(jobTitle);
  if (!job) return false;
  return titleWords(leadTitle) === job || splitTitle(leadTitle).includes(job);
}

// A lead that can be opened: not locked (out of network, shown with a "View
// profile" button and no details on its page) and with a link to its page.
export function canOpenLead(lead) {
  return !lead.locked && !!lead.href;
}

// Leads are tried one at a time, and only a lead that ends up saved counts
// as found. `tried`: [{ index, column, entryIndex, saved }], the leads tried
// so far for this results page.

// Found (saved) leads per column: { [column]: { wanted, found } }.
export function countFound(tried, leadsCount) {
  return Object.fromEntries(
    COLUMNS.map((column) => [
      column,
      {
        wanted: leadsCount?.[column] ?? 0,
        found: tried.filter((item) => item.column === column && item.saved).length,
      },
    ])
  );
}

// The next lead to try: Management first, then Technical; in a column its
// entries from the highest priority down, while the column has fewer found
// leads than its `leadsCount` and the entry fewer than its own count; the
// first lead in page order whose title matches one of the entry's titles.
// A lead is tried once (saved or not), one that can't be opened
// (canOpenLead) never. Returns { column, entryIndex, entry (its name), lead },
// or null when there's nothing more to try.
export function nextPick(leads, plans, leadsCount, tried = []) {
  const triedIndexes = new Set(tried.map((item) => item.index));
  const totals = countFound(tried, leadsCount);

  for (const column of COLUMNS) {
    if (totals[column].found >= totals[column].wanted) continue;
    for (const [entryIndex, entry] of (plans?.[column] ?? []).entries()) {
      const fromEntry = tried.filter(
        (item) => item.column === column && item.entryIndex === entryIndex && item.saved
      ).length;
      if (fromEntry >= entry.count) continue;
      const lead = leads.find(
        (candidate) =>
          !triedIndexes.has(candidate.index) &&
          canOpenLead(candidate) &&
          entry.titles.some((title) => titleMatches(candidate.title, title))
      );
      if (lead) return { column, entryIndex, entry: entry.name, lead };
    }
  }
  return null;
}

// Whether another results page could still give a lead: some column has
// fewer found leads than its `leadsCount`, with an entry that has fewer than
// its own count.
export function wantsMoreLeads(plans, leadsCount, tried = []) {
  const totals = countFound(tried, leadsCount);
  return COLUMNS.some(
    (column) =>
      totals[column].found < totals[column].wanted &&
      (plans?.[column] ?? []).some(
        (entry, entryIndex) =>
          tried.filter((item) => item.column === column && item.entryIndex === entryIndex && item.saved).length <
          entry.count
      )
  );
}
