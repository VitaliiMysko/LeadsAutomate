// Pure operations on the job-title priority board:
// { management: [title, ...], technical: [title, ...] }, each column ordered
// from the highest priority (index 0) to the lowest.

export const COLUMNS = ["management", "technical"];
export const POOL = "pool";

export function createEmptyBoard() {
  return { management: [], technical: [] };
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
  return clean;
}

export function findColumn(board, title) {
  return COLUMNS.find((column) => board[column].includes(title)) ?? null;
}

// Job titles from the current search filter not yet placed in a column.
export function getPool(board, filterTitles) {
  return filterTitles.filter((title) => !findColumn(board, title));
}

// Moves a title to `target` ("management", "technical" or "pool") at `index`
// (end of the column when omitted). Returns a new board.
export function moveTitle(board, title, target, index) {
  const next = {
    management: board.management.filter((item) => item !== title),
    technical: board.technical.filter((item) => item !== title),
  };
  if (target === POOL) return next;
  if (!COLUMNS.includes(target)) throw new Error(`Unknown column: ${target}`);

  const column = next[target];
  const at = Number.isInteger(index) ? Math.min(Math.max(index, 0), column.length) : column.length;
  column.splice(at, 0, title);
  return next;
}

// Weight of each title in a column: the first gets the column's length,
// each next one less, the last 1.
export function getPriorityWeights(column) {
  return column.map((title, index) => ({ title, weight: column.length - index }));
}
