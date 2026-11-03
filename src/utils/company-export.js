import { toCsv } from "./csv.js";
import { parseCompanyId } from "./companies-file.js";
import { pageOf, urlWithPage } from "./restli-query.js";
import { COMPANIES_PER_PAGE } from "../constants/config.js";

// The companies export: the companies of a Sales Navigator company search,
// page by page, written as a CSV file. Its state is kept after every page,
// so an export cut short (an error, LinkedIn's request limit, Stop)
// continues where it ended:
//   { searchUrl, searchKey, target, page, companies: [{ id, name }],
//     last: { id, name, page, index } | null, done, stopped: { reason, at } | null }
// `page` is the results page to read next, `last` the last company taken.

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
    last: null,
    done: false,
    stopped: null,
  };
}

// The companies of one results page ({ index, name, href } in page order,
// `href` the link to the company's Sales Navigator page, empty when the row
// didn't render) taken into the export: in order, skipping companies already
// in it, up to its target. Stops at the first row without a company id, so
// `last` is always the last company read in order; `unread` is that row's
// index, else null. Returns { state, added, unread }.
export function takeCompanies(state, rows, page) {
  const seen = new Set(state.companies.map((company) => company.id));
  const added = [];
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
    added.push({ id, name });
    last = { id, name, page, index: row.index };
  }
  return { state: { ...state, companies: [...state.companies, ...added], last }, added, unread };
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
  const companies = (Array.isArray(stored.companies) ? stored.companies : [])
    .filter((company) => typeof company?.id === "string" && company.id)
    .map(({ id, name }) => ({ id, name: String(name ?? "") }));
  const last = stored.last && typeof stored.last.id === "string" ? stored.last : null;
  return {
    searchUrl: stored.searchUrl,
    searchKey: typeof stored.searchKey === "string" ? stored.searchKey : searchKeyOf(stored.searchUrl),
    target: Math.max(Number(stored.target) || 1, 1),
    page: Math.max(Number(stored.page) || 1, 1),
    companies,
    last,
    done: stored.done === true,
    stopped: stored.stopped && typeof stored.stopped.reason === "string" ? stored.stopped : null,
  };
}
