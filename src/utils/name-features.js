import { normalizeName } from "./text-utils.js";
import { stripLegalForm } from "./company-match.js";

// How a dropdown option's name relates to the typed name, recorded per
// option for analysing which signals pick the right company.

function tokens(value) {
  return new Set(stripLegalForm(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

// Jaccard overlap of the words (legal forms left out), 0..1.
export function tokenOverlap(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size && !right.size) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

function levenshtein(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// 1 - edit distance / longer length, on the normalized names, 0..1.
export function editSimilarity(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  const longest = Math.max(left.length, right.length);
  return longest ? 1 - levenshtein(left, right) / longest : 1;
}

const round = (value) => Math.round(value * 1000) / 1000;

export function nameFeatures(typed, option) {
  const typedKey = normalizeName(typed);
  const optionKey = normalizeName(option);
  return {
    exact: String(option).replace(/\s+/g, " ").trim() === String(typed).replace(/\s+/g, " ").trim(),
    exactIgnoreCase: optionKey === typedKey,
    legalForm: stripLegalForm(option) === stripLegalForm(typed),
    startsWith: optionKey.startsWith(typedKey),
    contains: optionKey.includes(typedKey),
    tokenOverlap: round(tokenOverlap(typed, option)),
    editSimilarity: round(editSimilarity(typed, option)),
  };
}
