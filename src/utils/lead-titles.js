import { toCsv } from "./csv.js";
import { titleWords, titleMatches } from "./lead-picker.js";

// The job titles of the leads on the results pages read while the companies
// file is processed, for reviewing the board's columns. Titles that differ
// only in letter case, punctuation and spaces are one title (as lead
// selection compares them), shown as first seen:
//   { startedAt, companies, leads, titles: [{ key, title, count }] }
// `companies` counts the lead selections recorded, `leads` the titled leads.

export const LEAD_TITLES_COLUMNS = ["job_title", "count", "column"];

export function newLeadTitles(startedAt = Date.now()) {
  return { startedAt, companies: 0, leads: 0, titles: [] };
}

// Adds the titles of one results page's leads ({ title, locked }); a locked
// lead (out of network) and one without a title are left out.
export function addLeadTitles(record, leads) {
  const titles = record.titles.map((item) => ({ ...item }));
  const byKey = new Map(titles.map((item) => [item.key, item]));
  let added = 0;
  for (const lead of leads) {
    if (lead.locked) continue;
    const title = String(lead.title ?? "").replace(/\s+/g, " ").trim();
    const key = titleWords(title);
    if (!key) continue;
    added++;
    const item = byKey.get(key);
    if (item) item.count++;
    else {
      const created = { key, title, count: 1 };
      byKey.set(key, created);
      titles.push(created);
    }
  }
  return { ...record, leads: record.leads + added, titles };
}

// The name of the first column (in priority order) with an item that takes
// a lead with this title (lead-picker.js, titleMatches), else "".
// `columns`: the board's plan (priority-board.js, getBoardPlan).
export function columnForTitle(title, columns) {
  const column = columns.find((candidate) =>
    candidate.entries.some((entry) => entry.titles.some((jobTitle) => titleMatches(title, jobTitle)))
  );
  return column?.name ?? "";
}

// The titles, most frequent first (equal counts by title), with the column
// that takes each one: [{ title, count, column }].
export function leadTitleRows(record, columns = []) {
  return [...record.titles]
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .map(({ title, count }) => ({ title, count, column: columnForTitle(title, columns) }));
}

export function leadTitlesCsv(record, columns = []) {
  return toCsv([
    LEAD_TITLES_COLUMNS,
    ...leadTitleRows(record, columns).map(({ title, count, column }) => [title, count, column]),
  ]);
}

// Keeps only a stored record of the expected shape, else null.
export function restoreLeadTitles(stored) {
  if (!stored || typeof stored !== "object" || !Array.isArray(stored.titles)) return null;
  const titles = stored.titles
    .filter((item) => typeof item?.title === "string" && item.title)
    .map(({ title, count }) => ({ key: titleWords(title), title, count: Math.max(Number(count) || 0, 1) }))
    .filter((item) => item.key);
  return {
    startedAt: Number(stored.startedAt) || 0,
    companies: Math.max(Number(stored.companies) || 0, 0),
    leads: Math.max(Number(stored.leads) || 0, 0),
    titles,
  };
}
