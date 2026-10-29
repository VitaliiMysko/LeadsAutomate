import {
  COLUMNS,
  POOL,
  createEmptyBoard,
  sanitizeBoard,
  getPool,
  moveTitle,
  moveTitleToGroup,
  moveGroup,
  groupWithAbove,
  ungroup,
  setEntryCount,
  renameGroup,
  addTitle,
  isManualTitle,
  isGroup,
  columnTitles,
  clampCount,
  getColumnPlan,
  hasJobTitles,
} from "../../utils/priority-board.js";
import { LEADS_COUNT, STORAGE_KEYS } from "../../constants/config.js";
import { loadValue, saveValue } from "../store/storage.js";
import { log } from "./log.js";

// "Job list" (titles from the Sales Navigator "Current job title" filter)
// and the Management / Technical priority columns, filled by drag and drop.
// A column holds single titles and groups of titles, each with its own
// lead count.
let board = createEmptyBoard();
let leadsCount = { management: LEADS_COUNT.default, technical: LEADS_COUNT.default };
let filterTitles = [];
let filterTitlesKnown = false;
let elements = null;
// { title } or { group } while something is dragged.
let dragged = null;
let dropIndicator = null;

function persistBoard() {
  saveValue(STORAGE_KEYS.board, board);
}

function applyBoard(next) {
  board = next;
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

function createActions(...buttons) {
  const actions = document.createElement("span");
  actions.className = "rank-item__actions";
  actions.append(...buttons);
  return actions;
}

function createRank(index) {
  const rank = document.createElement("span");
  rank.className = "rank-item__rank";
  rank.textContent = index + 1;
  return rank;
}

// Lead count of one entry. Saved without re-rendering, so the spin buttons
// keep working while clicked repeatedly.
function createCountInput(column, index, label) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "entry-count";
  input.min = LEADS_COUNT.min;
  input.max = LEADS_COUNT.max;
  input.value = board[column][index].count;
  input.title = label;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => {
    board = setEntryCount(board, column, index, input.value, LEADS_COUNT);
    input.value = board[column][index].count;
    persistBoard();
  });
  return input;
}

// Title text with the manual badge or the stale mark; shared by single
// titles and the titles inside a group.
function decorateTitle(item, title) {
  const isManual = isManualTitle(board, title);
  if (isManual) {
    item.classList.add("rank-item--manual");
    item.title = "Added manually";
  } else if (filterTitlesKnown && !filterTitles.includes(title)) {
    item.classList.add("rank-item--stale");
    item.title = "Not in the current Sales Navigator \"Current job title\" filter";
  }

  const text = document.createElement("span");
  text.className = "rank-item__text";
  text.textContent = title;
  item.append(text);
  if (isManual) {
    const badge = document.createElement("span");
    badge.className = "rank-item__badge";
    badge.textContent = "manual";
    item.append(badge);
  }
  return isManual;
}

function createSingleItem(column, entry, index) {
  const { title } = entry;
  const item = document.createElement("li");
  item.className = "rank-item";
  item.draggable = true;
  item.dataset.title = title;

  item.append(createRank(index));
  const isManual = decorateTitle(item, title);
  item.append(
    createCountInput(column, index, `Leads to take with the title "${title}"`),
    createActions(
      createIconButton("Move up", "↑", () => applyBoard(moveTitle(board, title, column, index - 1)), index === 0),
      createIconButton(
        "Move down",
        "↓",
        () => applyBoard(moveTitle(board, title, column, index + 1)),
        index === board[column].length - 1
      ),
      createIconButton("Group with the item above", "⤴", () => applyBoard(groupWithAbove(board, column, index)), index === 0),
      createIconButton(isManual ? "Remove" : "Back to Job list", "×", () => applyBoard(moveTitle(board, title, POOL)))
    )
  );
  return item;
}

function createGroupTitle(column, group, title, position) {
  const item = document.createElement("li");
  item.className = "rank-item rank-item--sub";
  item.draggable = true;
  item.dataset.title = title;
  decorateTitle(item, title);

  const groupIndex = board[column].indexOf(group);
  item.append(
    createActions(
      createIconButton("Move up in the group", "↑", () => applyBoard(moveTitleToGroup(board, title, group.id, position - 1)), position === 0),
      createIconButton(
        "Move down in the group",
        "↓",
        () => applyBoard(moveTitleToGroup(board, title, group.id, position + 1)),
        position === group.titles.length - 1
      ),
      createIconButton("Take out of the group", "×", () => applyBoard(moveTitle(board, title, column, groupIndex + 1)))
    )
  );
  return item;
}

function createGroupItem(column, group, index) {
  const item = document.createElement("li");
  item.className = "rank-group";
  item.draggable = true;
  item.dataset.group = group.id;

  const head = document.createElement("div");
  head.className = "rank-group__head";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "rank-group__name";
  name.placeholder = `Group of ${group.titles.length}`;
  name.value = group.name;
  name.setAttribute("aria-label", "Group name");
  name.addEventListener("change", () => {
    board = renameGroup(board, group.id, name.value);
    name.value = board[column][index].name;
    persistBoard();
  });

  head.append(
    createRank(index),
    name,
    createCountInput(column, index, "Leads to take with any of the group's titles"),
    createActions(
      createIconButton("Move up", "↑", () => applyBoard(moveGroup(board, group.id, column, index - 1)), index === 0),
      createIconButton(
        "Move down",
        "↓",
        () => applyBoard(moveGroup(board, group.id, column, index + 1)),
        index === board[column].length - 1
      ),
      createIconButton("Group with the item above", "⤴", () => applyBoard(groupWithAbove(board, column, index)), index === 0),
      createIconButton("Ungroup", "✂", () => applyBoard(ungroup(board, group.id, LEADS_COUNT)))
    )
  );

  const list = document.createElement("ul");
  list.className = "rank-group__list";
  list.dataset.groupList = group.id;
  list.append(...group.titles.map((title, position) => createGroupTitle(column, group, title, position)));

  item.append(head, list);
  return item;
}

// --- manual entry ----------------------------------------------------------

const ADD_OUTCOME_MESSAGES = {
  added: (title, column) => `Added "${title}" to ${column}`,
  placed: (title, column) => `"${title}" taken from the Job list into ${column}`,
  moved: (title, column) => `"${title}" moved to ${column}`,
};

function initAddForms() {
  for (const column of COLUMNS) {
    const form = elements.addForms[column];
    const input = form.querySelector("input");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = addTitle(board, input.value, column, filterTitles, LEADS_COUNT);
      if (result.outcome === "empty") return;
      if (result.outcome === "exists") {
        log.warn(`"${result.title}" is already in ${column}`);
        input.select();
        return;
      }
      applyBoard(result.board);
      // Added at the end of the column, maybe below the visible part of the panel.
      const list = elements.columns[column];
      list.lastElementChild?.scrollIntoView({ block: "nearest" });
      input.value = "";
      log.info(ADD_OUTCOME_MESSAGES[result.outcome](result.title, column));
    });
  }
}

function render() {
  const pool = getPool(board, filterTitles);
  elements.pool.replaceChildren(...pool.map(createChip));
  elements.poolCount.textContent = filterTitlesKnown ? `${pool.length} / ${filterTitles.length}` : "";
  elements.poolEmpty.hidden = pool.length > 0;
  if (!pool.length && filterTitlesKnown && filterTitles.length) {
    elements.poolEmpty.textContent = "All job titles are placed in the columns";
  }
  // Shown in the section header, so the counts stay visible when it's collapsed.
  elements.sectionSummary.textContent =
    (filterTitlesKnown ? `${filterTitles.length} in filter · ` : "") +
    `Management ${columnTitles(board, "management").length} · Technical ${columnTitles(board, "technical").length}`;

  for (const column of COLUMNS) {
    const list = elements.columns[column];
    const items = board[column].map((entry, index) =>
      isGroup(entry) ? createGroupItem(column, entry, index) : createSingleItem(column, entry, index)
    );
    if (!items.length) {
      const placeholder = document.createElement("li");
      placeholder.className = "rank-list__placeholder";
      placeholder.textContent = "Drag job titles here or type one below";
      items.push(placeholder);
    }
    list.replaceChildren(...items);
  }
}

// --- drag and drop ---------------------------------------------------------

function isDraggedElement(element) {
  return dragged.title ? element.dataset.title === dragged.title : element.dataset.group === dragged.group;
}

// Position among the list's own items (a column's entries or a group's
// titles), the dragged one left out.
function getDropIndex(list, clientY) {
  const items = [...list.children].filter(
    (element) => element.matches(".rank-item, .rank-group") && !isDraggedElement(element)
  );
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

function markDropZone(zone) {
  document.querySelectorAll(".drop-zone--over").forEach((other) => other !== zone && other.classList.remove("drop-zone--over"));
  zone.classList.add("drop-zone--over");
}

// A title dropped on a group's titles joins the group; anything else dropped
// on a column becomes one of its entries.
function getColumnDropTarget(columnList, event) {
  const groupList = dragged.title ? event.target.closest?.("[data-group-list]") : null;
  return groupList && columnList.contains(groupList) ? groupList : columnList;
}

function dropOn(target, list, index) {
  const groupId = list.dataset.groupList;
  if (groupId) return moveTitleToGroup(board, dragged.title, groupId, index);
  if (dragged.group) return moveGroup(board, dragged.group, target, index);
  return moveTitle(board, dragged.title, target, index, LEADS_COUNT);
}

function initDropZone(zone, target) {
  zone.addEventListener("dragover", (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (target === POOL) {
      markDropZone(zone);
      return;
    }

    const list = getColumnDropTarget(zone, event);
    markDropZone(list);
    const { before } = getDropIndex(list, event.clientY);
    if (!dropIndicator) {
      dropIndicator = document.createElement("li");
      dropIndicator.className = "drop-indicator";
    }
    if (dropIndicator.parentElement !== list || dropIndicator.nextSibling !== before) list.insertBefore(dropIndicator, before);
  });

  zone.addEventListener("dragleave", (event) => {
    if (zone.contains(event.relatedTarget)) return;
    clearDropFeedback();
  });

  zone.addEventListener("drop", (event) => {
    if (!dragged) return;
    event.preventDefault();
    let next;
    if (target === POOL) {
      next = dragged.group ? moveGroup(board, dragged.group, POOL) : moveTitle(board, dragged.title, POOL);
    } else {
      const list = getColumnDropTarget(zone, event);
      dropIndicator?.remove();
      next = dropOn(target, list, getDropIndex(list, event.clientY).index);
    }
    clearDropFeedback();
    applyBoard(next);
  });
}

function initDragSources(container) {
  container.addEventListener("dragstart", (event) => {
    const source = event.target.closest?.("[data-title], [data-group]");
    if (!source) return;
    dragged = source.dataset.title ? { title: source.dataset.title } : { group: source.dataset.group };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragged.title ?? source.querySelector(".rank-group__name")?.value ?? "");
    requestAnimationFrame(() => source.classList.add("dragging"));
  });

  container.addEventListener("dragend", (event) => {
    event.target.closest?.("[data-title], [data-group]")?.classList.remove("dragging");
    dragged = null;
    clearDropFeedback();
  });

  // Inputs inside a draggable item: selecting their text with the mouse
  // would drag the item instead.
  container.addEventListener("pointerdown", (event) => {
    if (!event.target.matches("input")) return;
    const item = event.target.closest("[draggable='true']");
    if (!item) return;
    item.draggable = false;
    document.addEventListener("pointerup", () => (item.draggable = true), { once: true });
  });
}

// --- leads count -----------------------------------------------------------

function initCountInputs() {
  for (const column of COLUMNS) {
    const input = elements.countInputs[column];
    input.min = LEADS_COUNT.min;
    input.max = LEADS_COUNT.max;
    input.value = leadsCount[column];
    input.addEventListener("change", () => {
      leadsCount = { ...leadsCount, [column]: clampCount(input.value, LEADS_COUNT) };
      input.value = leadsCount[column];
      saveValue(STORAGE_KEYS.leadsCount, leadsCount);
    });
  }
}

// --- public API ------------------------------------------------------------

export async function initJobBoard(boardElements) {
  elements = boardElements;
  board = sanitizeBoard(await loadValue(STORAGE_KEYS.board, createEmptyBoard()), LEADS_COUNT);
  const storedCount = await loadValue(STORAGE_KEYS.leadsCount, {});
  leadsCount = {
    management: clampCount(storedCount.management ?? LEADS_COUNT.default, LEADS_COUNT),
    technical: clampCount(storedCount.technical ?? LEADS_COUNT.default, LEADS_COUNT),
  };

  // The section (Job list + columns) collapses on a header click; the
  // open / closed state is remembered.
  elements.section.open = await loadValue(STORAGE_KEYS.jobSectionOpen, true);
  elements.section.addEventListener("toggle", () => saveValue(STORAGE_KEYS.jobSectionOpen, elements.section.open));

  initCountInputs();
  initAddForms();
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

// Snapshot for the search logic: per column, the entries by priority
// ([{ name, titles, count }]) and the wanted lead count.
export function getJobPriorities() {
  return {
    management: getColumnPlan(board, "management"),
    technical: getColumnPlan(board, "technical"),
    leadsCount: { ...leadsCount },
  };
}

// False when both columns are empty; the Job titles section is then opened
// and shown, so the user sees where to add titles.
export function ensureJobTitles() {
  if (hasJobTitles(board)) return true;
  elements.section.open = true;
  elements.section.scrollIntoView({ behavior: "smooth", block: "start" });
  return false;
}
