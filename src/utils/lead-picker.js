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

// Walks each column's entries from the highest priority down and takes the
// leads whose title matches one of the entry's titles, in page order: up to
// the entry's count, and until the column has its `leadsCount`. Management
// is filled first; a lead is taken once, and one that can't be opened
// (canOpenLead) never. Returns
// { picks: [{ column, entry, lead }] in click order, columns: { [column]:
// { wanted, found } } }.
export function pickLeads(leads, plans, leadsCount) {
  const taken = new Set();
  const picks = [];
  const columns = {};

  for (const column of COLUMNS) {
    const wanted = leadsCount?.[column] ?? 0;
    let found = 0;
    for (const entry of plans?.[column] ?? []) {
      if (found >= wanted) break;
      let fromEntry = 0;
      for (const lead of leads) {
        if (found >= wanted || fromEntry >= entry.count) break;
        if (taken.has(lead.index) || !canOpenLead(lead) || !entry.titles.some((title) => titleMatches(lead.title, title))) continue;
        taken.add(lead.index);
        picks.push({ column, entry: entry.name, lead });
        fromEntry++;
        found++;
      }
    }
    columns[column] = { wanted, found };
  }
  return { picks, columns };
}
