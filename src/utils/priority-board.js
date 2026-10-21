import { normalizeName } from "./text-utils.js";

// Pure operations on the job-title priority board:
// { management: [title, ...], technical: [title, ...], manual: [title, ...] }.
// Each column is ordered from the highest priority (index 0) to the lowest;
// `manual` lists the column titles the user typed in rather than took from
// the Sales Navigator filter.

export const COLUMNS = ["management", "technical"];
export const POOL = "pool";

export function createEmptyBoard() {
  return { management: [], technical: [], manual: [] };
}

export function sanitizeBoard(board) {
  const clean = createEmptyBoard();
  const seen = new Set();
  for (const column of COLUMNS) {
    for (const title of Array.isArray(board?.[column]) ? board[column] : []) {
      if (typeof title !== "string" || seen.has(title)) continue;
      seen.add(title);
      clean[column].push(title);
    }
  }
  const manual = Array.isArray(board?.manual) ? board.manual : [];
  clean.manual = [...seen].filter((title) => manual.includes(title));
  return clean;
}

export function findColumn(board, title) {
  return COLUMNS.find((column) => board[column].includes(title)) ?? null;
}

export function isManualTitle(board, title) {
  return board.manual.includes(title);
}

// Job titles from the current search filter not yet placed in a column.
export function getPool(board, filterTitles) {
  return filterTitles.filter((title) => !findColumn(board, title));
}

// Moves a title to `target` ("management", "technical" or "pool") at `index`
// (end of the column when omitted). Returns a new board. A manual title sent
// back to the pool is dropped, since the filter doesn't hold it.
export function moveTitle(board, title, target, index) {
  const next = {
    management: board.management.filter((item) => item !== title),
    technical: board.technical.filter((item) => item !== title),
    manual: target === POOL ? board.manual.filter((item) => item !== title) : [...board.manual],
  };
  if (target === POOL) return next;
  if (!COLUMNS.includes(target)) throw new Error(`Unknown column: ${target}`);

  const column = next[target];
  const at = Number.isInteger(index) ? Math.min(Math.max(index, 0), column.length) : column.length;
  column.splice(at, 0, title);
  return next;
}

// Adds a typed-in title to the end of `column`. A title already on the board
// or in the filter (compared case- and whitespace-insensitively) keeps its
// existing spelling: it's moved to `column` if it's elsewhere.
// Returns { board, title, outcome }, outcome being
// "added" | "placed" (taken from the filter) | "moved" | "exists" | "empty".
export function addTitle(board, rawTitle, column, filterTitles = []) {
  const typed = String(rawTitle ?? "").replace(/\s+/g, " ").trim();
  if (!typed) return { board, title: "", outcome: "empty" };
  if (!COLUMNS.includes(column)) throw new Error(`Unknown column: ${column}`);

  const key = normalizeName(typed);
  const sameTitle = (title) => normalizeName(title) === key;

  const placed = [...board.management, ...board.technical].find(sameTitle);
  if (placed) {
    if (board[column].includes(placed)) return { board, title: placed, outcome: "exists" };
    return { board: moveTitle(board, placed, column), title: placed, outcome: "moved" };
  }

  const fromFilter = filterTitles.find(sameTitle);
  if (fromFilter) return { board: moveTitle(board, fromFilter, column), title: fromFilter, outcome: "placed" };

  const next = moveTitle(board, typed, column);
  next.manual.push(typed);
  return { board: next, title: typed, outcome: "added" };
}

// Weight of each title in a column: the first gets the column's length,
// each next one less, the last 1.
export function getPriorityWeights(column) {
  return column.map((title, index) => ({ title, weight: column.length - index }));
}
