import { normalizeName } from "./text-utils.js";

// Parses the companies file: names separated by commas. Line breaks are
// accepted as separators too, so a one-name-per-line file also works.
// Surrounding quotes and extra whitespace are dropped, empty entries skipped,
// and repeated names (case-insensitive) kept only once, in first-seen order.
export function parseCompaniesText(text) {
  const seen = new Set();
  const companies = [];

  for (const part of String(text ?? "").replace(/^﻿/, "").split(/[,\r\n]+/)) {
    const name = part
      .trim()
      .replace(/^["'«“]+|["'»”]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;

    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push(name);
  }

  return companies;
}
