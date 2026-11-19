import { toCsv } from "./csv.js";
import { parseCompanyId } from "./companies-file.js";
import { pageOf, urlWithPage } from "./restli-query.js";
import { COMPANIES_PER_PAGE } from "../constants/config.js";

// The companies export: the companies of a Sales Navigator company search,
// page by page, written as a CSV file. Its state is kept after every page,
// so an export cut short (an error, LinkedIn's request limit, Stop)
// continues where it ended:
//   { searchUrl, searchKey, target, page, companies: [{ id, name }],
//     skipped: [{ id, name }], last: { id, name, page, index } | null, done,
//     stopped: { reason, at } | null }
// `page` is the results page to read next, `last` the last company taken.
// `skipped` holds the companies left out for having no employees on
// LinkedIn; they don't count toward the target.

export const COMPANY_EXPORT_COLUMNS = ["company_id", "company_name"];

// What tells one search from another: its path and `query` (the filters and
// keywords), not the page or the session id.
export function searchKeyOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname.replace(/\/$/, "")}?${parsed.searchParams.get("query") ?? ""}`;
  } catch {
    return null;
  }
}

// A new export of `target` companies of the search shown at `url`, from
// the results page it shows.
export function newCompanyExport(url, target) {
  return {
    searchUrl: urlWithPage(url, 1),
    searchKey: searchKeyOf(url),
    target,
    page: pageOf(url),
    companies: [],
    skipped: [],
    last: null,
    done: false,
    stopped: null,
  };
}

// The number of employees in a result row's employee count text (the text
// next to the industry, "0 employees", "1,234 employees", "10K+ employees"
// in any language): its first number, separators aside, or null when the
// text holds none. Only 0 matters to the export, so "10K+" reads as 10.
export function employeeCountOf(text) {
  const match = String(text ?? "").match(/\d+(?:[.,   ]\d{3})*/);
  return match ? Number.parseInt(match[0].replace(/\D/g, ""), 10) : null;
}

// The companies of one results page ({ index, name, href, employees } in
// page order, `href` the link to the company's Sales Navigator page, empty
// when the row didn't render; `employees` the employee count text) taken
// into the export: in order, skipping companies already in it, up to its
// target. A company with 0 employees goes to `skipped` instead; one whose
// count can't be read is taken. Stops at the first row without a company
// id, so `last` is always the last company read in order; `unread` is that
// row's index, else null. Returns { state, added, skipped, unread },
// `skipped` the companies left out from this page.
export function takeCompanies(state, rows, page) {
  const previouslySkipped = state.skipped ?? [];
  const seen = new Set([...state.companies, ...previouslySkipped].map((company) => company.id));
  const added = [];
  const skipped = [];
  let last = state.last;
  let unread = null;
  for (const row of rows) {
    if (state.companies.length + added.length >= state.target) break;
    const id = parseCompanyId(row.href);
    if (!id) {
      unread = row.index;
      break;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
    if (employeeCountOf(row.employees) === 0) {
      skipped.push({ id, name });
      continue;
    }
    added.push({ id, name });
    last = { id, name, page, index: row.index };
  }
  return {
    state: { ...state, companies: [...state.companies, ...added], skipped: [...previouslySkipped, ...skipped], last },
    added,
    skipped,
    unread,
  };
}

// The position of row `index` of results page `page` in the whole search
// (#26 is the first company of page 2).
export const resultNumber = (page, index) => (page - 1) * COMPANIES_PER_PAGE + index + 1;

export const exportComplete = (state) => state.companies.length >= state.target;

// Whether `state` is an export that can be continued.
export const canContinueExport = (state) => !!state && !state.done && !exportComplete(state);

// The CSV file of the exported companies; reads back as a companies file.
export function companiesCsv(companies) {
  return toCsv([COMPANY_EXPORT_COLUMNS, ...companies.map(({ id, name }) => [id, name])]);
}

// Keeps only a stored state of the expected shape, else null.
export function restoreCompanyExport(stored) {
  if (!stored || typeof stored !== "object" || typeof stored.searchUrl !== "string") return null;
  const companiesOf = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((company) => typeof company?.id === "string" && company.id)
      .map(({ id, name }) => ({ id, name: String(name ?? "") }));
  const companies = companiesOf(stored.companies);
  const last = stored.last && typeof stored.last.id === "string" ? stored.last : null;
  return {
    searchUrl: stored.searchUrl,
    searchKey: typeof stored.searchKey === "string" ? stored.searchKey : searchKeyOf(stored.searchUrl),
    target: Math.max(Number(stored.target) || 1, 1),
    page: Math.max(Number(stored.page) || 1, 1),
    companies,
    skipped: companiesOf(stored.skipped),
    last,
    done: stored.done === true,
    stopped: stored.stopped && typeof stored.stopped.reason === "string" ? stored.stopped : null,
  };
}
