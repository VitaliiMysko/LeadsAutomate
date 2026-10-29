import { normalizeName } from "./text-utils.js";
import { parseCsv } from "./csv.js";
import { companyPagePath } from "./company-page.js";

// The columns that tell which company a row is, strongest first: the
// LinkedIn id; the company's LinkedIn page URL, the id itself when the URL
// carries the number, else read from the page when the company is searched
// (company-page.js); the name, typed in the Current company filter.
const ID_COLUMN = "company_id";
const LINKEDIN_COLUMN = "linkedin";
const NAME_COLUMN = "company_name";
const KEY_COLUMNS = [ID_COLUMN, LINKEDIN_COLUMN, NAME_COLUMN];
const LOGO_COLUMN = "logo";

// "https://www.linkedin.com/company/acme-ltd/" → "acme-ltd"; "" when the
// value isn't a LinkedIn page URL.
function pageName(linkedin) {
  return companyPagePath(linkedin)?.split("/")[1] ?? "";
}

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
// has one, else by LinkedIn page, else by name (case-insensitive).
function dedupe(companies) {
  const seen = new Set();
  return companies.filter(({ name, companyId, linkedin }) => {
    const page = companyPagePath(linkedin);
    const key = companyId ? `id:${companyId}` : page ? `page:${page}` : normalizeName(name);
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

// Parses a CSV with a header row holding at least one of the `company_id`,
// `linkedin` and `company_name` columns, and an optional `logo` column (the
// path of a logo image on the user's computer). Returns [{ name, companyId,
// rawCompanyId, logoPath, linkedin, nameFromPage }] (null where empty), or
// null when the file has none of the three. `companyId` is the id read by
// parseCompanyId from company_id, else from linkedin, and `rawCompanyId`
// the company_id cell as written, so ids that couldn't be read can be
// reported. A row without a name is named by its id, else by the name part
// of its LinkedIn page URL, with `nameFromPage` set: the company's name on
// LinkedIn replaces it once its page is read.
export function parseCompaniesCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return null;
  const columns = header.map((cell) => cell.trim().toLowerCase());
  if (!KEY_COLUMNS.some((column) => columns.includes(column))) return null;
  const cell = (cells, column) => {
    const index = columns.indexOf(column);
    return (index === -1 ? "" : (cells[index] ?? "").trim()) || null;
  };

  return dedupe(
    rows.map((cells) => {
      const rawCompanyId = cell(cells, ID_COLUMN);
      const linkedin = cell(cells, LINKEDIN_COLUMN);
      const companyId = parseCompanyId(rawCompanyId) ?? parseCompanyId(linkedin);
      const name = cleanName(cell(cells, NAME_COLUMN)) || companyId;
      return {
        name: name || pageName(linkedin),
        companyId,
        rawCompanyId,
        logoPath: cell(cells, LOGO_COLUMN),
        linkedin,
        nameFromPage: !name,
      };
    })
  );
}

// The CSV header's columns as parseCompaniesCsv reads them: `mapped`, the
// file's column for each column the extension reads ({ field, column }, in
// the extension's order), `missing`, the fields the file hasn't, and
// `ignored`, the file's other columns, as written. Null for an empty file.
export function companiesCsvColumns(text) {
  const [header] = parseCsv(text);
  if (!header) return null;
  const columns = header.map((cell) => cell.trim().toLowerCase());
  const fields = [...KEY_COLUMNS, LOGO_COLUMN];
  const used = new Set();
  const mapped = [];
  const missing = [];
  for (const field of fields) {
    const index = columns.indexOf(field);
    if (index === -1) {
      missing.push(field);
    } else {
      used.add(index);
      mapped.push({ field, column: header[index].trim() });
    }
  }
  const ignored = header.map((cell) => cell.trim()).filter((cell, index) => cell && !used.has(index));
  return { mapped, missing, ignored };
}

// The messages telling how a CSV's columns are read, one sentence per line,
// from companiesCsvColumns: `found`, for the user, names only the columns
// found; `lines`, for the log, also the file's spelling of each, the columns
// not found and the ignored ones. `readAsList` is set when the file has
// none of company_id, linkedin and company_name, so it's read as a plain
// list of names.
export function columnMappingLines({ mapped, missing, ignored }) {
  const quote = (column) => `"${column}"`;
  const readAsList = !mapped.some(({ field }) => KEY_COLUMNS.includes(field));
  const listNote = `There is no ${ID_COLUMN}, ${LINKEDIN_COLUMN} or ${NAME_COLUMN} column, so the file is read as a list of names separated by commas and line breaks.`;
  const found = [`Columns found: ${mapped.length ? mapped.map(({ field }) => field).join(", ") : "none"}.`];
  if (readAsList) found.push(listNote);
  const lines = [
    mapped.length
      ? `Column mapping found: ${mapped.map(({ field, column }) => `${quote(column)} → ${field}`).join(", ")}.`
      : "Column mapping found: none.",
  ];
  if (missing.length) lines.push(`Not in the file: ${missing.join(", ")}.`);
  if (ignored.length) lines.push(`Ignored columns: ${ignored.map(quote).join(", ")}.`);
  if (readAsList) lines.push(listNote);
  return { found, lines, readAsList };
}

// Either format: a CSV with a `company_id` / `linkedin` / `company_name` header, else
// the plain list. Returns [{ name, logoPath, ... }].
export function parseCompaniesFile(text) {
  return parseCompaniesCsv(text) ?? parseCompaniesText(text).map((name) => ({ name, logoPath: null }));
}

// "C:\\logos\\acme.png" or "/logos/acme.png" → "acme.png", lowercased for
// matching against the files of a chosen folder.
export function logoFileKey(path) {
  return String(path ?? "").split(/[\\/]/).pop().trim().toLowerCase();
}
