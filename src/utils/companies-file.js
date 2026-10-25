import { normalizeName } from "./text-utils.js";
import { parseCsv } from "./csv.js";

const NAME_COLUMN = "company_name";
const ID_COLUMN = "company_id";
const LOGO_COLUMN = "logo";
// Kept with each company for the match records (signals for later analysis).
const EXTRA_COLUMNS = ["website", "country"];

function cleanName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// LinkedIn's numeric company id from what a companies file may hold: the
// number, a company URN, or a LinkedIn / Sales Navigator company page URL
// ("https://www.linkedin.com/company/2781504/", ".../sales/company/2781504").
// Null for anything else, e.g. a page URL by name (/company/acme), which
// doesn't carry the number.
export function parseCompanyId(value) {
  const text = String(value ?? "").trim();
  const match =
    text.match(/^(\d+)$/) ||
    text.match(/^urn:li:(?:organization|company|fs_salesCompany):(\d+)$/) ||
    text.match(/^(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/(?:sales\/)?company\/(\d+)(?:[/?#]|$)/i);
  return match ? match[1] : null;
}

// Keeps the first entry of each company, in order: by company id when it
// has one, else by name (case-insensitive).
function dedupe(companies) {
  const seen = new Set();
  return companies.filter(({ name, companyId }) => {
    const key = companyId ? `id:${companyId}` : normalizeName(name);
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Parses the companies text file: names separated by commas. Line breaks are
// accepted as separators too, so a one-name-per-line file also works.
// Surrounding quotes and extra whitespace are dropped, empty entries skipped,
// and repeated names (case-insensitive) kept only once, in first-seen order.
export function parseCompaniesText(text) {
  return dedupe(
    String(text ?? "")
      .replace(/^\uFEFF/, "")
      .split(/[,\r\n]+/)
      .map((part) => ({ name: cleanName(part) }))
  ).map(({ name }) => name);
}

// Parses a CSV with a header row holding a `company_name` and / or a
// `company_id` column, an optional `logo` column (the path of a logo image
// on the user's computer) and optional `website` / `country` columns.
// Returns [{ name, companyId, rawCompanyId, logoPath, website, country }]
// (null where empty), or null when the file has neither column.
// `companyId` is the id read by parseCompanyId and `rawCompanyId` the cell
// as written, so ids that couldn't be read can be reported. A row with an
// id but no name is named by its id.
export function parseCompaniesCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return null;
  const columns = header.map((cell) => cell.trim().toLowerCase());
  if (!columns.includes(NAME_COLUMN) && !columns.includes(ID_COLUMN)) return null;
  const cell = (cells, column) => {
    const index = columns.indexOf(column);
    return (index === -1 ? "" : (cells[index] ?? "").trim()) || null;
  };

  return dedupe(
    rows.map((cells) => {
      const rawCompanyId = cell(cells, ID_COLUMN);
      const companyId = parseCompanyId(rawCompanyId);
      return {
        name: cleanName(cell(cells, NAME_COLUMN)) || companyId || "",
        companyId,
        rawCompanyId,
        logoPath: cell(cells, LOGO_COLUMN),
        ...Object.fromEntries(EXTRA_COLUMNS.map((column) => [column, cell(cells, column)])),
      };
    })
  );
}

// Either format: a CSV with a `company_name` / `company_id` header, else
// the plain list. Returns [{ name, logoPath, ... }].
export function parseCompaniesFile(text) {
  return parseCompaniesCsv(text) ?? parseCompaniesText(text).map((name) => ({ name, logoPath: null }));
}

// "C:\\logos\\acme.png" or "/logos/acme.png" → "acme.png", lowercased for
// matching against the files of a chosen folder.
export function logoFileKey(path) {
  return String(path ?? "").split(/[\\/]/).pop().trim().toLowerCase();
}
