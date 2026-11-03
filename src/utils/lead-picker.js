import { normalizeName } from "./text-utils.js";

// Chooses which leads of a search results page to take, by the job-title
// priorities of the board's columns (priority-board.js, getBoardPlan).
// Leads: [{ index, name, title, ... }] in page order.

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
// as found. `columns`: the board's plan (priority-board.js, getBoardPlan),
// [{ id, name, count, entries: [{ name, titles, count }] }] in priority
// order. `tried`: [{ index, column (its id), entryIndex, saved }], the leads
// tried so far for this results page. `companyLimit`: how many leads the
// company may give in all columns together, null for no limit
// (priority-board.js, getCompanyLimit).

function savedFromEntry(tried, columnId, entryIndex) {
  return tried.filter((item) => item.column === columnId && item.entryIndex === entryIndex && item.saved).length;
}

// Found (saved) leads per column: { [column id]: { name, wanted, found } }.
export function countFound(tried, columns) {
  return Object.fromEntries(
    columns.map(({ id, name, count }) => [
      id,
      {
        name,
        wanted: count,
        found: tried.filter((item) => item.column === id && item.saved).length,
      },
    ])
  );
}

// How far the company is toward the leads it was asked for: `found` of
// `wanted` in all (the columns' counts together, at most `companyLimit`),
// and per column, in their order: [{ id, name, found, wanted }].
export function leadProgress(columns, tried, companyLimit = null) {
  const totals = countFound(tried, columns);
  const columnsWanted = columns.reduce((sum, column) => sum + column.count, 0);
  return {
    found: tried.filter((item) => item.saved).length,
    wanted: companyLimit == null ? columnsWanted : Math.min(columnsWanted, companyLimit),
    columns: columns.map(({ id }) => ({ id, ...totals[id] })),
  };
}

// Whether the company has given its `companyLimit` of found leads.
export function companyLimitReached(tried, companyLimit) {
  return companyLimit != null && tried.filter((item) => item.saved).length >= companyLimit;
}

// The next lead to try, none once companyLimitReached: the columns in their
// order; in a column its entries
// from the highest priority down, while the column has fewer found leads
// than its count and the entry fewer than its own count; the first lead in
// page order whose title matches one of the entry's titles. A lead is tried
// once (saved or not), one that can't be opened (canOpenLead) never.
// Returns { column (its id), columnName, entryIndex, entry (its name), lead },
// or null when there's nothing more to try.
export function nextPick(leads, columns, tried = [], companyLimit = null) {
  if (companyLimitReached(tried, companyLimit)) return null;
  const triedIndexes = new Set(tried.map((item) => item.index));
  const totals = countFound(tried, columns);

  for (const column of columns) {
    if (totals[column.id].found >= totals[column.id].wanted) continue;
    for (const [entryIndex, entry] of column.entries.entries()) {
      if (savedFromEntry(tried, column.id, entryIndex) >= entry.count) continue;
      const lead = leads.find(
        (candidate) =>
          !triedIndexes.has(candidate.index) &&
          canOpenLead(candidate) &&
          entry.titles.some((title) => titleMatches(candidate.title, title))
      );
      if (lead) return { column: column.id, columnName: column.name, entryIndex, entry: entry.name, lead };
    }
  }
  return null;
}

// Whether another results page could still give a lead: the company limit
// isn't reached, and some column has fewer found leads than its count, with
// an entry that has fewer than its own count.
export function wantsMoreLeads(columns, tried = [], companyLimit = null) {
  if (companyLimitReached(tried, companyLimit)) return false;
  const totals = countFound(tried, columns);
  return columns.some(
    (column) =>
      totals[column.id].found < totals[column.id].wanted &&
      column.entries.some((entry, entryIndex) => savedFromEntry(tried, column.id, entryIndex) < entry.count)
  );
}
