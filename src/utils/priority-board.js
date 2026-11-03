import { normalizeName } from "./text-utils.js";

// Pure operations on the job-title priority board:
// { columns: [{ id, name, count, entries: [entry, ...] }, ...], manual: [title, ...] }.
// The columns are the user's, in priority order (the first one is tried
// first); `count` is how many leads a column takes per search. A column
// entry is either a single title, { title, count }, or a group of titles
// close in meaning (synonyms, other languages), { id, name, titles, count }.
// An entry's `count` is how many leads to take from that title, or from the
// group's titles together. Each column's entries are ordered from the
// highest priority (index 0) to the lowest; their counts may add up to more
// than the column's own count. `manual` lists the titles the user typed in
// rather than took from the Sales Navigator filter. Columns are addressed by
// their `id`. `companyLimit`, { enabled, value }, caps the leads found for one
// company across all the columns, when enabled.

export const POOL = "pool";

const DEFAULT_LIMITS = { min: 0, max: 9, default: 1 };
const DEFAULT_COMPANY_LIMITS = { min: 1, max: 99, default: 5 };

// The columns of a new board, and of the boards saved before the columns
// could be changed: those had fixed `management` and `technical` keys, and
// kept the columns' lead counts apart, as `leadsCount`.
const LEGACY_COLUMNS = [
  { key: "management", name: "Management" },
  { key: "technical", name: "Technical" },
];

export function createEmptyBoard(limits = DEFAULT_LIMITS, companyLimits = DEFAULT_COMPANY_LIMITS) {
  return {
    columns: LEGACY_COLUMNS.map(({ name }, index) => ({ id: `c${index + 1}`, name, count: limits.default, entries: [] })),
    manual: [],
    companyLimit: { enabled: false, value: companyLimits.default },
  };
}

export function isGroup(entry) {
  return Array.isArray(entry?.titles);
}

export function entryTitles(entry) {
  return isGroup(entry) ? entry.titles : [entry.title];
}

export function getColumn(board, columnId) {
  return board.columns.find((column) => column.id === columnId) ?? null;
}

// Every title of a column, groups flattened, in priority order.
export function columnTitles(board, columnId) {
  return getColumn(board, columnId)?.entries.flatMap(entryTitles) ?? [];
}

export function clampCount(value, limits = DEFAULT_LIMITS) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return limits.default;
  return Math.min(Math.max(number, limits.min), limits.max);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// The next unused id with `prefix`: "g3" when "g1" and "g2" are taken.
function nextId(prefix, ids) {
  const used = ids
    .filter((id) => typeof id === "string" && id.startsWith(prefix))
    .map((id) => Number.parseInt(id.slice(prefix.length), 10))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

function nextGroupId(board) {
  const ids = board.columns.flatMap((column) => column.entries).filter(isGroup).map((group) => group.id);
  return nextId("g", ids);
}

function nextColumnId(board) {
  return nextId("c", board.columns.map((column) => column.id));
}

function cloneBoard(board) {
  return {
    columns: board.columns.map((column) => ({
      ...column,
      entries: column.entries.map((entry) => (isGroup(entry) ? { ...entry, titles: [...entry.titles] } : { ...entry })),
    })),
    manual: [...board.manual],
    companyLimit: { ...board.companyLimit },
  };
}

function requireColumn(board, columnId) {
  const column = getColumn(board, columnId);
  if (!column) throw new Error(`Unknown column: ${columnId}`);
  return column;
}

// The stored columns; the older format's fixed Management and Technical
// columns are read as two of them.
function rawColumns(board, limits) {
  if (Array.isArray(board?.columns)) return board.columns;
  return LEGACY_COLUMNS.map(({ key, name }) => ({
    name,
    count: board?.leadsCount?.[key] ?? limits.default,
    entries: board?.[key],
  }));
}

// Accepts the stored board, including the older formats: fixed Management
// and Technical columns (their lead counts in `leadsCount`), and columns
// that were plain lists of titles. Duplicate titles, empty groups and
// unknown keys are dropped; counts are clamped to `limits`; a column
// without a name is named by its position. A board without columns gets the
// new board's ones; one without a company limit has it off.
export function sanitizeBoard(board, limits = DEFAULT_LIMITS, companyLimits = DEFAULT_COMPANY_LIMITS) {
  const clean = {
    columns: [],
    manual: [],
    companyLimit: {
      enabled: board?.companyLimit?.enabled === true,
      value: clampCount(board?.companyLimit?.value ?? companyLimits.default, companyLimits),
    },
  };
  const seen = new Set();
  const takeTitle = (title) => {
    if (typeof title !== "string" || seen.has(title)) return false;
    seen.add(title);
    return true;
  };
  const groupIds = new Set();
  const pendingGroups = [];
  const columnIds = new Set();
  const pendingColumns = [];

  for (const raw of rawColumns(board, limits)) {
    if (!raw || typeof raw !== "object") continue;
    const column = {
      id: typeof raw.id === "string" && raw.id && !columnIds.has(raw.id) ? raw.id : null,
      name: cleanText(typeof raw.name === "string" ? raw.name : "") || `Column ${clean.columns.length + 1}`,
      count: clampCount(raw.count, limits),
      entries: [],
    };
    if (column.id) columnIds.add(column.id);
    else pendingColumns.push(column);
    clean.columns.push(column);

    for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
      if (typeof entry === "string") {
        if (takeTitle(entry)) column.entries.push({ title: entry, count: limits.default });
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
        else pendingGroups.push(group);
        column.entries.push(group);
      } else if (entry && takeTitle(entry.title)) {
        column.entries.push({ title: entry.title, count: clampCount(entry.count, limits) });
      }
    }
  }
  if (!clean.columns.length) clean.columns = createEmptyBoard(limits).columns;
  for (const group of pendingGroups) group.id = nextGroupId(clean);
  for (const column of pendingColumns) column.id = nextColumnId(clean);

  const manual = Array.isArray(board?.manual) ? board.manual : [];
  clean.manual = [...seen].filter((title) => manual.includes(title));
  return clean;
}

// The id of the column holding `title`, or null.
export function findColumn(board, title) {
  return board.columns.find((column) => column.entries.some((entry) => entryTitles(entry).includes(title)))?.id ?? null;
}

// { column (its id), index, group } of the group with `groupId`, or null.
export function findGroup(board, groupId) {
  for (const column of board.columns) {
    const index = column.entries.findIndex((entry) => isGroup(entry) && entry.id === groupId);
    if (index !== -1) return { column: column.id, index, group: column.entries[index] };
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
  for (const column of next.columns) {
    column.entries = column.entries.filter((entry, index) => {
      if (!isGroup(entry)) {
        if (entry.title !== title) return true;
        count = entry.count;
        return false;
      }
      entry.titles = entry.titles.filter((item) => item !== title);
      if (entry.titles.length) return true;
      removedGroup = { column: column.id, index };
      return false;
    });
  }
  return { next, count, removedGroup };
}

// Moves a title to `target` (a column id or POOL) as a single entry at
// `index` (end of the column when omitted), keeping its count if it was a
// single entry already. `index` counts the column's entries without the
// moved title, as the drop position on screen does. Returns a new board.
// A manual title sent back to the pool is dropped, since the filter doesn't
// hold it.
export function moveTitle(board, title, target, index, limits = DEFAULT_LIMITS) {
  const { next, count, removedGroup } = detachTitle(board, title);
  if (target === POOL) {
    next.manual = next.manual.filter((item) => item !== title);
    return next;
  }
  const { entries } = requireColumn(next, target);

  let at = index;
  if (Number.isInteger(at) && removedGroup?.column === target && removedGroup.index < at) at -= 1;
  entries.splice(clampIndex(at, entries.length), 0, { title, count: count ?? limits.default });
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
  const [group] = getColumn(next, found.column).entries.splice(found.index, 1);
  if (target === POOL) {
    next.manual = next.manual.filter((title) => !group.titles.includes(title));
    return next;
  }
  const { entries } = requireColumn(next, target);
  entries.splice(clampIndex(index, entries.length), 0, group);
  return next;
}

// Joins the entry at `index` with the one above it. A single title above
// becomes a group that keeps its count; a group above takes in the titles.
export function groupWithAbove(board, columnId, index) {
  if (index < 1 || index >= requireColumn(board, columnId).entries.length) return board;
  const next = cloneBoard(board);
  const { entries } = getColumn(next, columnId);
  const [entry] = entries.splice(index, 1);
  const above = entries[index - 1];
  if (isGroup(above)) {
    above.titles.push(...entryTitles(entry));
  } else {
    entries[index - 1] = {
      id: nextGroupId(board),
      name: "",
      titles: [above.title, ...entryTitles(entry)],
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
  getColumn(next, found.column).entries.splice(found.index, 1, ...singles);
  return next;
}

export function setEntryCount(board, columnId, index, value, limits = DEFAULT_LIMITS) {
  if (!getColumn(board, columnId)?.entries[index]) return board;
  const next = cloneBoard(board);
  getColumn(next, columnId).entries[index].count = clampCount(value, limits);
  return next;
}

export function renameGroup(board, groupId, name) {
  const found = findGroup(board, groupId);
  if (!found) return board;
  const next = cloneBoard(board);
  getColumn(next, found.column).entries[found.index].name = cleanText(name);
  return next;
}

// --- columns ---------------------------------------------------------------

// Adds an empty column at the end (the lowest priority), named `name` or
// "Column N". Returns { board, id }.
export function addColumn(board, name, limits = DEFAULT_LIMITS) {
  const next = cloneBoard(board);
  const id = nextColumnId(board);
  next.columns.push({ id, name: cleanText(name) || `Column ${board.columns.length + 1}`, count: limits.default, entries: [] });
  return { board: next, id };
}

// Removes a column; its titles go back to the Job list (manual ones are
// dropped). The last column is kept: the board always has one.
export function removeColumn(board, columnId) {
  if (!getColumn(board, columnId) || board.columns.length < 2) return board;
  const titles = columnTitles(board, columnId);
  const next = cloneBoard(board);
  next.columns = next.columns.filter((column) => column.id !== columnId);
  next.manual = next.manual.filter((title) => !titles.includes(title));
  return next;
}

// A column's name can't be empty: an empty one leaves the board unchanged.
export function renameColumn(board, columnId, name) {
  const clean = cleanText(name);
  if (!clean || !getColumn(board, columnId)) return board;
  const next = cloneBoard(board);
  getColumn(next, columnId).name = clean;
  return next;
}

// Moves a column to position `index` among the columns (clamped).
export function moveColumn(board, columnId, index) {
  const from = board.columns.findIndex((column) => column.id === columnId);
  if (from === -1) return board;
  const next = cloneBoard(board);
  const [column] = next.columns.splice(from, 1);
  next.columns.splice(clampIndex(index, next.columns.length), 0, column);
  return next;
}

// How many leads the column takes per search.
export function setColumnCount(board, columnId, value, limits = DEFAULT_LIMITS) {
  if (!getColumn(board, columnId)) return board;
  const next = cloneBoard(board);
  getColumn(next, columnId).count = clampCount(value, limits);
  return next;
}

// --- company limit ---------------------------------------------------------

// Turns the company limit on or off and sets its value (clamped).
export function setCompanyLimit(board, { enabled, value }, companyLimits = DEFAULT_COMPANY_LIMITS) {
  const next = cloneBoard(board);
  next.companyLimit = { enabled: enabled === true, value: clampCount(value, companyLimits) };
  return next;
}

// How many leads one company may give in all, or null when there's no limit.
export function getCompanyLimit(board) {
  return board.companyLimit.enabled ? board.companyLimit.value : null;
}

// Adds a typed-in title to the end of the column. A title already on the
// board or in the filter (compared case- and whitespace-insensitively) keeps
// its existing spelling: it's moved to the column if it's elsewhere.
// Returns { board, title, outcome }, outcome being
// "added" | "placed" (taken from the filter) | "moved" | "exists" | "empty".
export function addTitle(board, rawTitle, columnId, filterTitles = [], limits = DEFAULT_LIMITS) {
  const typed = cleanText(rawTitle);
  if (!typed) return { board, title: "", outcome: "empty" };
  requireColumn(board, columnId);

  const key = normalizeName(typed);
  const sameTitle = (title) => normalizeName(title) === key;

  const placed = board.columns.flatMap((column) => columnTitles(board, column.id)).find(sameTitle);
  if (placed) {
    if (columnTitles(board, columnId).includes(placed)) return { board, title: placed, outcome: "exists" };
    return { board: moveTitle(board, placed, columnId, undefined, limits), title: placed, outcome: "moved" };
  }

  const fromFilter = filterTitles.find(sameTitle);
  if (fromFilter) {
    return { board: moveTitle(board, fromFilter, columnId, undefined, limits), title: fromFilter, outcome: "placed" };
  }

  const next = moveTitle(board, typed, columnId, undefined, limits);
  next.manual.push(typed);
  return { board: next, title: typed, outcome: "added" };
}

// What the search should look for in a column, by priority:
// [{ name, titles, count }], one item per entry. A single title's name is
// the title itself; a group's is its name, or its titles joined by " / ".
export function getColumnPlan(board, columnId) {
  return (getColumn(board, columnId)?.entries ?? []).map((entry) => ({
    name: isGroup(entry) ? entry.name || entry.titles.join(" / ") : entry.title,
    titles: [...entryTitles(entry)],
    count: entry.count,
  }));
}

// What the search should look for, column by column in priority order:
// [{ id, name, count, entries: getColumnPlan }].
export function getBoardPlan(board) {
  return board.columns.map(({ id, name, count }) => ({ id, name, count, entries: getColumnPlan(board, id) }));
}

// A search needs at least one title or group in some column.
export function hasJobTitles(board) {
  return board.columns.some((column) => column.entries.length > 0);
}

// --- board file ------------------------------------------------------------
// The columns (names, lead counts, titles, groups, counts), the manual marks
// and the company limit, as saved to a JSON file and loaded back. Version 1
// files hold the fixed Management and Technical columns.

export const BOARD_FILE_FORMAT = "leads-automate-job-titles";
export const BOARD_FILE_VERSION = 2;

export function boardToFile(board) {
  return {
    format: BOARD_FILE_FORMAT,
    version: BOARD_FILE_VERSION,
    columns: board.columns,
    manual: board.manual,
    companyLimit: board.companyLimit,
  };
}

// Returns the board from a saved file's text; throws an Error saying what's
// wrong when it isn't such a file.
export function boardFromFile(text, limits = DEFAULT_LIMITS, companyLimits = DEFAULT_COMPANY_LIMITS) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("not a JSON file");
  }
  if (data?.format !== BOARD_FILE_FORMAT) throw new Error("not a job titles file");
  if (!Number.isInteger(data.version) || data.version > BOARD_FILE_VERSION) {
    throw new Error(`unsupported file version ${data.version}`);
  }
  if (data.version >= 2 && !Array.isArray(data.columns)) throw new Error("the file has no columns");
  return sanitizeBoard(data, limits, companyLimits);
}
