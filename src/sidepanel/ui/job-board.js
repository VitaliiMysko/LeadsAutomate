import {
  COLUMNS,
  POOL,
  createEmptyBoard,
  sanitizeBoard,
  getPool,
  moveTitle,
} from "../../utils/priority-board.js";
import { LEADS_COUNT, STORAGE_KEYS } from "../../constants/config.js";
import { loadValue, saveValue } from "../store/storage.js";

// "Job list" (titles from the Sales Navigator "Current job title" filter)
// and the Management / Technical priority columns, filled by drag and drop.
let board = createEmptyBoard();
let leadsCount = { management: LEADS_COUNT.default, technical: LEADS_COUNT.default };
let filterTitles = [];
let filterTitlesKnown = false;
let elements = null;
let draggedTitle = null;
let dropIndicator = null;

function persistBoard() {
  saveValue(STORAGE_KEYS.board, board);
}

function applyMove(title, target, index) {
  board = moveTitle(board, title, target, index);
  persistBoard();
  render();
}

function createChip(title) {
  const chip = document.createElement("div");
  chip.className = "chip";
  chip.draggable = true;
  chip.dataset.title = title;
  chip.textContent = title;
  chip.title = title;
  return chip;
}

function createIconButton(label, symbol, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-btn";
  button.textContent = symbol;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function createRankItem(column, title, index) {
  const columnTitles = board[column];
  const item = document.createElement("li");
  item.className = "rank-item";
  item.draggable = true;
  item.dataset.title = title;

  const isStale = filterTitlesKnown && !filterTitles.includes(title);
  if (isStale) {
    item.classList.add("rank-item--stale");
    item.title = "Not in the current Sales Navigator \"Current job title\" filter";
  }

  const rank = document.createElement("span");
  rank.className = "rank-item__rank";
  rank.textContent = index + 1;

  const text = document.createElement("span");
  text.className = "rank-item__text";
  text.textContent = title;

  const actions = document.createElement("span");
  actions.className = "rank-item__actions";
  actions.append(
    createIconButton("Move up", "↑", () => applyMove(title, column, index - 1), index === 0),
    createIconButton("Move down", "↓", () => applyMove(title, column, index + 1), index === columnTitles.length - 1),
    createIconButton("Back to Job list", "×", () => applyMove(title, POOL))
  );

  item.append(rank, text, actions);
  return item;
}

function render() {
  const pool = getPool(board, filterTitles);
  elements.pool.replaceChildren(...pool.map(createChip));
  elements.poolCount.textContent = filterTitlesKnown ? `${pool.length} / ${filterTitles.length}` : "";
  elements.poolEmpty.hidden = pool.length > 0;
  if (!pool.length && filterTitlesKnown && filterTitles.length) {
    elements.poolEmpty.textContent = "All job titles are placed in the columns";
  }

  for (const column of COLUMNS) {
    const list = elements.columns[column];
    const items = board[column].map((title, index) => createRankItem(column, title, index));
    if (!items.length) {
      const placeholder = document.createElement("li");
      placeholder.className = "rank-list__placeholder";
      placeholder.textContent = "Drag job titles here";
      items.push(placeholder);
    }
    list.replaceChildren(...items);
  }
}

// --- drag and drop ---------------------------------------------------------

function getDropIndex(list, clientY) {
  const items = [...list.querySelectorAll(".rank-item")].filter((item) => item.dataset.title !== draggedTitle);
  const index = items.findIndex((item) => {
    const rect = item.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return { index: index === -1 ? items.length : index, before: items[index] ?? null };
}

function clearDropFeedback() {
  dropIndicator?.remove();
  document.querySelectorAll(".drop-zone--over").forEach((zone) => zone.classList.remove("drop-zone--over"));
}

function initDropZone(zone, target) {
  zone.addEventListener("dragover", (event) => {
    if (!draggedTitle) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    zone.classList.add("drop-zone--over");
    if (target === POOL) return;

    const { before } = getDropIndex(zone, event.clientY);
    if (!dropIndicator) {
      dropIndicator = document.createElement("li");
      dropIndicator.className = "drop-indicator";
    }
    zone.insertBefore(dropIndicator, before);
  });

  zone.addEventListener("dragleave", (event) => {
    if (zone.contains(event.relatedTarget)) return;
    zone.classList.remove("drop-zone--over");
    if (dropIndicator?.parentElement === zone) dropIndicator.remove();
  });

  zone.addEventListener("drop", (event) => {
    if (!draggedTitle) return;
    event.preventDefault();
    const index = target === POOL ? undefined : getDropIndex(zone, event.clientY).index;
    const title = draggedTitle;
    clearDropFeedback();
    applyMove(title, target, index);
  });
}

function initDragSources(container) {
  container.addEventListener("dragstart", (event) => {
    const source = event.target.closest("[data-title]");
    if (!source) return;
    draggedTitle = source.dataset.title;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedTitle);
    requestAnimationFrame(() => source.classList.add("dragging"));
  });

  container.addEventListener("dragend", (event) => {
    event.target.closest?.("[data-title]")?.classList.remove("dragging");
    draggedTitle = null;
    clearDropFeedback();
  });
}

// --- leads count -----------------------------------------------------------

function clampCount(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return LEADS_COUNT.default;
  return Math.min(Math.max(number, LEADS_COUNT.min), LEADS_COUNT.max);
}

function initCountInputs() {
  for (const column of COLUMNS) {
    const input = elements.countInputs[column];
    input.min = LEADS_COUNT.min;
    input.max = LEADS_COUNT.max;
    input.value = leadsCount[column];
    input.addEventListener("change", () => {
      leadsCount = { ...leadsCount, [column]: clampCount(input.value) };
      input.value = leadsCount[column];
      saveValue(STORAGE_KEYS.leadsCount, leadsCount);
    });
  }
}

// --- public API ------------------------------------------------------------

export async function initJobBoard(boardElements) {
  elements = boardElements;
  board = sanitizeBoard(await loadValue(STORAGE_KEYS.board, createEmptyBoard()));
  const storedCount = await loadValue(STORAGE_KEYS.leadsCount, {});
  leadsCount = {
    management: clampCount(storedCount.management ?? LEADS_COUNT.default),
    technical: clampCount(storedCount.technical ?? LEADS_COUNT.default),
  };

  initCountInputs();
  initDragSources(elements.root);
  initDropZone(elements.pool, POOL);
  for (const column of COLUMNS) initDropZone(elements.columns[column], column);
  render();
}

// `titles` is null when they couldn't be read; `message` then explains why.
export function setFilterTitles(titles, message = "") {
  filterTitlesKnown = Array.isArray(titles);
  filterTitles = filterTitlesKnown ? titles : [];
  elements.poolEmpty.textContent = message;
  render();
}

// Snapshot for the search logic (priorities and wanted lead counts).
export function getJobPriorities() {
  return {
    management: [...board.management],
    technical: [...board.technical],
    leadsCount: { ...leadsCount },
  };
}
