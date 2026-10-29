import { normalizeName } from "./text-utils.js";

// Pure operations on the job-title priority board:
// { management: [entry, ...], technical: [entry, ...], manual: [title, ...] }.
// A column entry is either a single title, { title, count }, or a group of
// titles close in meaning (synonyms, other languages), { id, name, titles,
// count }. `count` is how many leads to take from that title, or from the
// group's titles together. Each column is ordered from the highest priority
// (index 0) to the lowest; the counts of a column may add up to more than
// the column's own lead count. `manual` lists the titles the user typed in
// rather than took from the Sales Navigator filter.

export const COLUMNS = ["management", "technical"];
export const POOL = "pool";

const DEFAULT_LIMITS = { min: 0, max: 100, default: 1 };

export function createEmptyBoard() {
  return { management: [], technical: [], manual: [] };
}

export function isGroup(entry) {
  return Array.isArray(entry?.titles);
}

export function entryTitles(entry) {
  return isGroup(entry) ? entry.titles : [entry.title];
}

// Every title of a column, groups flattened, in priority order.
export function columnTitles(board, column) {
  return board[column].flatMap(entryTitles);
}

export function clampCount(value, limits = DEFAULT_LIMITS) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return limits.default;
  return Math.min(Math.max(number, limits.min), limits.max);
}

function nextGroupId(board) {
  const used = COLUMNS.flatMap((column) => board[column])
    .filter(isGroup)
    .map((group) => Number.parseInt(String(group.id).replace(/^g/, ""), 10))
    .filter(Number.isFinite);
  return `g${Math.max(0, ...used) + 1}`;
}

function cloneBoard(board) {
  const copy = { manual: [...board.manual] };
  for (const column of COLUMNS) {
    copy[column] = board[column].map((entry) => (isGroup(entry) ? { ...entry, titles: [...entry.titles] } : { ...entry }));
  }
  return copy;
}

// Accepts the stored board, including the older format where a column was a
// plain list of titles. Duplicate titles, empty groups and unknown keys are
// dropped; counts are clamped to `limits`.
export function sanitizeBoard(board, limits = DEFAULT_LIMITS) {
  const clean = createEmptyBoard();
  const seen = new Set();
  const takeTitle = (title) => {
    if (typeof title !== "string" || seen.has(title)) return false;
    seen.add(title);
    return true;
  };
  const groupIds = new Set();
  const pendingIds = [];

  for (const column of COLUMNS) {
    for (const entry of Array.isArray(board?.[column]) ? board[column] : []) {
      if (typeof entry === "string") {
        if (takeTitle(entry)) clean[column].push({ title: entry, count: limits.default });
      } else if (isGroup(entry)) {
        const titles = entry.titles.filter(takeTitle);
        if (!titles.length) continue;
        const group = {
          id: typeof entry.id === "string" && !groupIds.has(entry.id) ? entry.id : null,
          name: typeof entry.name === "string" ? entry.name.trim() : "",
          titles,
          count: clampCount(entry.count, limits),
        };
        if (group.id) groupIds.add(group.id);
        else pendingIds.push(group);
        clean[column].push(group);
      } else if (entry && takeTitle(entry.title)) {
        clean[column].push({ title: entry.title, count: clampCount(entry.count, limits) });
      }
    }
  }
  for (const group of pendingIds) group.id = nextGroupId(clean);

  const manual = Array.isArray(board?.manual) ? board.manual : [];
  clean.manual = [...seen].filter((title) => manual.includes(title));
  return clean;
}

export function findColumn(board, title) {
  return COLUMNS.find((column) => columnTitles(board, column).includes(title)) ?? null;
}

// { column, index, group } of the group with `groupId`, or null.
export function findGroup(board, groupId) {
  for (const column of COLUMNS) {
    const index = board[column].findIndex((entry) => isGroup(entry) && entry.id === groupId);
    if (index !== -1) return { column, index, group: board[column][index] };
  }
  return null;
}

export function isManualTitle(board, title) {
  return board.manual.includes(title);
}

// Job titles from the current search filter not yet placed in a column.
export function getPool(board, filterTitles) {
  return filterTitles.filter((title) => !findColumn(board, title));
}

function clampIndex(index, length) {
  return Number.isInteger(index) ? Math.min(Math.max(index, 0), length) : length;
}

// Copy of the board without `title`. `count` is the title's own count when
// it was a single entry; a group left empty is removed, and `removedGroup`
// tells where it was.
function detachTitle(board, title) {
  const next = cloneBoard(board);
  let count;
  let removedGroup = null;
  for (const column of COLUMNS) {
    next[column] = next[column].filter((entry, index) => {
      if (!isGroup(entry)) {
        if (entry.title !== title) return true;
        count = entry.count;
        return false;
      }
      entry.titles = entry.titles.filter((item) => item !== title);
      if (entry.titles.length) return true;
      removedGroup = { column, index };
      return false;
    });
  }
  return { next, count, removedGroup };
}

// Moves a title to `target` ("management", "technical" or "pool") as a single
// entry at `index` (end of the column when omitted), keeping its count if it
// was a single entry already. `index` counts the column's entries without
// the moved title, as the drop position on screen does. Returns a new board.
// A manual title sent back to the pool is dropped, since the filter doesn't
// hold it.
export function moveTitle(board, title, target, index, limits = DEFAULT_LIMITS) {
  const { next, count, removedGroup } = detachTitle(board, title);
  if (target === POOL) {
    next.manual = next.manual.filter((item) => item !== title);
    return next;
  }
  if (!COLUMNS.includes(target)) throw new Error(`Unknown column: ${target}`);

  let at = index;
  if (Number.isInteger(at) && removedGroup?.column === target && removedGroup.index < at) at -= 1;
  const column = next[target];
  column.splice(clampIndex(at, column.length), 0, { title, count: count ?? limits.default });
  return next;
}

// Moves a title into the group `groupId` at `index` (its end when omitted).
// Returns the board unchanged if that group is gone.
export function moveTitleToGroup(board, title, groupId, index) {
  const { next } = detachTitle(board, title);
  const found = findGroup(next, groupId);
  if (!found) return board;
  found.group.titles.splice(clampIndex(index, found.group.titles.length), 0, title);
  return next;
}

// Moves a whole group to `target` at `index`. Sent to the pool, its titles go
// back to the Job list (manual ones are dropped).
export function moveGroup(board, groupId, target, index) {
  const found = findGroup(board, groupId);
  if (!found) return board;
  const next = cloneBoard(board);
  const [group] = next[found.column].splice(found.index, 1);
  if (target === POOL) {
    next.manual = next.manual.filter((title) => !group.titles.includes(title));
    return next;
  }
  if (!COLUMNS.includes(target)) throw new Error(`Unknown column: ${target}`);
  next[target].splice(clampIndex(index, next[target].length), 0, group);
  return next;
}

// Joins the entry at `index` with the one above it. A single title above
// becomes a group that keeps its count; a group above takes in the titles.
export function groupWithAbove(board, column, index) {
  if (!COLUMNS.includes(column)) throw new Error(`Unknown column: ${column}`);
  if (index < 1 || index >= board[column].length) return board;
  const next = cloneBoard(board);
  const entries = next[column];
  const [current] = entries.splice(index, 1);
  const above = entries[index - 1];
  if (isGroup(above)) {
    above.titles.push(...entryTitles(current));
  } else {
    entries[index - 1] = {
      id: nextGroupId(board),
      name: "",
      titles: [above.title, ...entryTitles(current)],
      count: above.count,
    };
  }
  return next;
}

// Splits a group into single titles in its place, each with the default count.
export function ungroup(board, groupId, limits = DEFAULT_LIMITS) {
  const found = findGroup(board, groupId);
  if (!found) return board;
  const next = cloneBoard(board);
  const singles = found.group.titles.map((title) => ({ title, count: limits.default }));
  next[found.column].splice(found.index, 1, ...singles);
  return next;
}

export function setEntryCount(board, column, index, value, limits = DEFAULT_LIMITS) {
  if (!board[column]?.[index]) return board;
  const next = cloneBoard(board);
  next[column][index].count = clampCount(value, limits);
  return next;
}

export function renameGroup(board, groupId, name) {
  const found = findGroup(board, groupId);
  if (!found) return board;
  const next = cloneBoard(board);
  next[found.column][found.index].name = String(name ?? "").replace(/\s+/g, " ").trim();
  return next;
}

// Adds a typed-in title to the end of `column`. A title already on the board
// or in the filter (compared case- and whitespace-insensitively) keeps its
// existing spelling: it's moved to `column` if it's elsewhere.
// Returns { board, title, outcome }, outcome being
// "added" | "placed" (taken from the filter) | "moved" | "exists" | "empty".
export function addTitle(board, rawTitle, column, filterTitles = [], limits = DEFAULT_LIMITS) {
  const typed = String(rawTitle ?? "").replace(/\s+/g, " ").trim();
  if (!typed) return { board, title: "", outcome: "empty" };
  if (!COLUMNS.includes(column)) throw new Error(`Unknown column: ${column}`);

  const key = normalizeName(typed);
  const sameTitle = (title) => normalizeName(title) === key;

  const placed = COLUMNS.flatMap((name) => columnTitles(board, name)).find(sameTitle);
  if (placed) {
    if (columnTitles(board, column).includes(placed)) return { board, title: placed, outcome: "exists" };
    return { board: moveTitle(board, placed, column, undefined, limits), title: placed, outcome: "moved" };
  }

  const fromFilter = filterTitles.find(sameTitle);
  if (fromFilter) {
    return { board: moveTitle(board, fromFilter, column, undefined, limits), title: fromFilter, outcome: "placed" };
  }

  const next = moveTitle(board, typed, column, undefined, limits);
  next.manual.push(typed);
  return { board: next, title: typed, outcome: "added" };
}

// What the search should look for in a column, by priority:
// [{ name, titles, count }], one item per entry. A single title's name is
// the title itself; a group's is its name, or its titles joined by " / ".
export function getColumnPlan(board, column) {
  return board[column].map((entry) => ({
    name: isGroup(entry) ? entry.name || entry.titles.join(" / ") : entry.title,
    titles: [...entryTitles(entry)],
    count: entry.count,
  }));
}
