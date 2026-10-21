import { normalizeName } from "./text-utils.js";
import { parseCsv } from "./csv.js";

const NAME_COLUMN = "company_name";
const LOGO_COLUMN = "logo";

function cleanName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Keeps the first entry of each name (case-insensitive), in order.
function dedupe(companies) {
  const seen = new Set();
  return companies.filter(({ name }) => {
    const key = normalizeName(name);
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

// Parses a CSV with a header row holding a `company_name` column and an
// optional `logo` column (the path of a logo image on the user's computer).
// Returns [{ name, logoPath }] (logoPath null when empty), or null when the
// file has no `company_name` column.
export function parseCompaniesCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return null;
  const columns = header.map((cell) => cell.trim().toLowerCase());
  const nameIndex = columns.indexOf(NAME_COLUMN);
  if (nameIndex === -1) return null;
  const logoIndex = columns.indexOf(LOGO_COLUMN);

  return dedupe(
    rows.map((cells) => ({
      name: cleanName(cells[nameIndex]),
      logoPath: (logoIndex === -1 ? "" : (cells[logoIndex] ?? "").trim()) || null,
    }))
  );
}

// Either format: a CSV with a `company_name` header, else the plain list.
// Returns [{ name, logoPath }].
export function parseCompaniesFile(text) {
  return parseCompaniesCsv(text) ?? parseCompaniesText(text).map((name) => ({ name, logoPath: null }));
}

// "C:\\logos\\acme.png" or "/logos/acme.png" → "acme.png", lowercased for
// matching against the files of a chosen folder.
export function logoFileKey(path) {
  return String(path ?? "").split(/[\\/]/).pop().trim().toLowerCase();
}
