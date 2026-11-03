import {
  POOL,
  createEmptyBoard,
  sanitizeBoard,
  getColumn,
  getPool,
  moveTitle,
  moveTitleToGroup,
  moveGroup,
  groupWithAbove,
  ungroup,
  setEntryCount,
  renameGroup,
  addColumn,
  removeColumn,
  renameColumn,
  moveColumn,
  setColumnCount,
  setCompanyLimit,
  getCompanyLimit,
  addTitle,
  isManualTitle,
  isGroup,
  columnTitles,
  getBoardPlan,
  hasJobTitles,
  boardToFile,
  boardFromFile,
} from "../../utils/priority-board.js";
import { LEADS_COUNT, COMPANY_LIMIT, STORAGE_KEYS } from "../../constants/config.js";
import { loadValue, saveValue } from "../store/storage.js";
import { log } from "./log.js";
import { status } from "./status.js";

// "Job list" (titles from the Sales Navigator "Current job title" filter)
// and the user's priority columns, filled by drag and drop. A column holds
// single titles and groups of titles, each with its own lead count; the
// columns can be added, removed, renamed and reordered. Leads per company
// caps the leads of one company over all the columns.
let board = createEmptyBoard(LEADS_COUNT, COMPANY_LIMIT);
let filterTitles = [];
let filterTitlesKnown = false;
let elements = null;
// Column id → { root, name, count, list, addInput, left, right, remove },
// kept across renders so typed text and focus survive them.
const columnViews = new Map();
// { title } or { group } while something is dragged.
let dragged = null;
let dropIndicator = null;
// Number of column colors in styles.css ([data-color]).
export const COLUMN_COLORS = 4;

function persistBoard() {
  saveValue(STORAGE_KEYS.board, board);
}

function applyBoard(next) {
  board = next;
  persistBoard();
  render();
}

function entriesOf(columnId) {
  return getColumn(board, columnId)?.entries ?? [];
}

function columnIndex(columnId) {
  return board.columns.findIndex((column) => column.id === columnId);
}

function columnName(columnId) {
  return getColumn(board, columnId)?.name ?? columnId;
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
  input.value = entriesOf(column)[index].count;
  input.title = label;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => {
    board = setEntryCount(board, column, index, input.value, LEADS_COUNT);
    input.value = entriesOf(column)[index].count;
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
        index === entriesOf(column).length - 1
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

  const groupIndex = entriesOf(column).indexOf(group);
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
    name.value = entriesOf(column)[index].name;
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
        index === entriesOf(column).length - 1
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

function initAddForm(form, input, column) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = addTitle(board, input.value, column, filterTitles, LEADS_COUNT);
    if (result.outcome === "empty") return;
    if (result.outcome === "exists") {
      log.warn(`"${result.title}" is already in ${columnName(column)}`);
      input.select();
      return;
    }
    applyBoard(result.board);
    // Added at the end of the column, maybe below the visible part of the panel.
    columnViews.get(column).list.lastElementChild?.scrollIntoView({ block: "nearest" });
    input.value = "";
    log.info(ADD_OUTCOME_MESSAGES[result.outcome](result.title, columnName(column)));
  });
}

// --- columns ---------------------------------------------------------------

// The column's DOM: its head (name, lead count, ← → × buttons), the ranked
// list and the Add job title form. Built once per column.
function createColumnView(column) {
  const root = document.createElement("div");
  root.className = "column";
  root.dataset.column = column;

  const head = document.createElement("div");
  head.className = "column__head";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "column__name";
  name.addEventListener("change", () => {
    const before = columnName(column);
    board = renameColumn(board, column, name.value);
    name.value = columnName(column);
    if (name.value === before) return;
    log.info(`Column "${before}" renamed to "${name.value}"`);
    applyBoard(board);
  });
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") name.blur();
  });

  // Saved without re-rendering, so the spin buttons keep working.
  const countField = document.createElement("label");
  countField.className = "count-field";
  const countLabel = document.createElement("span");
  countLabel.textContent = "Leads";
  const count = document.createElement("input");
  count.type = "number";
  count.inputMode = "numeric";
  count.min = LEADS_COUNT.min;
  count.max = LEADS_COUNT.max;
  count.addEventListener("change", () => {
    board = setColumnCount(board, column, count.value, LEADS_COUNT);
    count.value = getColumn(board, column).count;
    persistBoard();
  });
  countField.append(countLabel, count);

  // Moved buttons lose focus with the column's move; given back for the
  // keyboard.
  const shift = (step, button) => {
    applyBoard(moveColumn(board, column, columnIndex(column) + step));
    if (!button.disabled) button.focus();
  };
  const left = createIconButton("Move column left (higher priority)", "←", () => shift(-1, left));
  const right = createIconButton("Move column right (lower priority)", "→", () => shift(1, right));
  const remove = createIconButton("Remove column", "×", () => handleRemoveColumn(column, remove));
  remove.addEventListener("blur", () => disarm(remove));
  remove.addEventListener("mouseleave", () => disarm(remove));
  const actions = document.createElement("span");
  actions.className = "column__actions";
  actions.append(left, right, remove);

  head.append(name, countField, actions);

  const list = document.createElement("ol");
  list.className = "rank-list drop-zone";
  initDropZone(list, column);

  const form = document.createElement("form");
  form.className = "add-title";
  form.autocomplete = "off";
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.placeholder = "Add job title";
  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.className = "add-title__btn";
  addButton.title = "Add";
  addButton.setAttribute("aria-label", "Add");
  addButton.textContent = "+";
  form.append(addInput, addButton);
  initAddForm(form, addInput, column);

  root.append(head, list, form);
  const view = { root, name, count, countField, list, addInput, left, right, remove };
  columnViews.set(column, view);
  return view;
}

function disarm(button) {
  if (!button.classList.contains("icon-btn--armed")) return;
  button.classList.remove("icon-btn--armed");
  button.textContent = "×";
}

// A column holding titles is removed on a second click, so a slip of the
// mouse doesn't send its titles back to the Job list.
function handleRemoveColumn(column, button) {
  const name = columnName(column);
  const titles = columnTitles(board, column).length;
  if (titles && !button.classList.contains("icon-btn--armed")) {
    button.classList.add("icon-btn--armed");
    button.textContent = "Remove?";
    return;
  }
  applyBoard(removeColumn(board, column));
  const back = titles === 1 ? "its title went" : `its ${titles} titles went`;
  log.info(`Column "${name}" removed${titles ? `; ${back} back to the Job list` : ""}`);
}

function handleAddColumn() {
  const { board: next, id } = addColumn(board, "", LEADS_COUNT);
  applyBoard(next);
  log.info(`Column "${columnName(id)}" added`);
  const { name } = columnViews.get(id);
  name.scrollIntoView({ block: "nearest" });
  name.focus();
  name.select();
}

function renderColumn(column, position) {
  const view = columnViews.get(column.id) ?? createColumnView(column.id);
  view.root.dataset.color = position % COLUMN_COLORS;
  if (document.activeElement !== view.name) view.name.value = column.name;
  if (document.activeElement !== view.count) view.count.value = column.count;
  view.name.setAttribute("aria-label", `Name of the column "${column.name}"`);
  view.countField.title = `How many ${column.name} leads to take per search`;
  view.list.setAttribute("aria-label", `${column.name} job titles by priority`);
  view.addInput.setAttribute("aria-label", `Add a ${column.name} job title`);
  view.left.disabled = position === 0;
  view.right.disabled = position === board.columns.length - 1;
  view.remove.disabled = board.columns.length < 2;
  view.remove.title = view.remove.disabled ? "The last column can't be removed" : "Remove column (its titles go back to the Job list)";

  const items = column.entries.map((entry, index) =>
    isGroup(entry) ? createGroupItem(column.id, entry, index) : createSingleItem(column.id, entry, index)
  );
  if (!items.length) {
    const placeholder = document.createElement("li");
    placeholder.className = "rank-list__placeholder";
    placeholder.textContent = "Drag job titles here or type one below";
    items.push(placeholder);
  }
  view.list.replaceChildren(...items);
  return view.root;
}

// Reuses each column's view; the board's children are replaced only when the
// columns changed, since moving an element takes the focus off it.
function renderColumns() {
  for (const [id, view] of columnViews) {
    if (getColumn(board, id)) continue;
    view.root.remove();
    columnViews.delete(id);
  }
  const roots = board.columns.map(renderColumn);
  const current = [...elements.board.children];
  if (current.length !== roots.length || roots.some((root, index) => current[index] !== root)) {
    elements.board.replaceChildren(...roots);
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
    board.columns.map((column) => `${column.name} ${columnTitles(board, column.id).length}`).join(" · ") +
    (getCompanyLimit(board) == null ? "" : ` · max ${getCompanyLimit(board)} per company`);
  renderCompanyLimit();
  renderColumns();
}

// --- leads per company -----------------------------------------------------

function renderCompanyLimit() {
  elements.companyLimitToggle.checked = board.companyLimit.enabled;
  elements.companyLimitInput.value = board.companyLimit.value;
  elements.companyLimitInput.disabled = !board.companyLimit.enabled;
}

function handleCompanyLimitChange() {
  board = setCompanyLimit(
    board,
    { enabled: elements.companyLimitToggle.checked, value: elements.companyLimitInput.value },
    COMPANY_LIMIT
  );
  applyBoard(board);
  const limit = getCompanyLimit(board);
  log.info(limit == null ? "Leads per company: no limit" : `Leads per company: at most ${limit}`);
}

function initCompanyLimit() {
  elements.companyLimitInput.min = COMPANY_LIMIT.min;
  elements.companyLimitInput.max = COMPANY_LIMIT.max;
  elements.companyLimitToggle.addEventListener("change", handleCompanyLimitChange);
  elements.companyLimitInput.addEventListener("change", handleCompanyLimitChange);
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

// --- board file ------------------------------------------------------------

function describeColumns() {
  const limit = getCompanyLimit(board);
  return [
    ...board.columns.map(
      (column) =>
        `${column.name} ${column.entries.length} items (${columnTitles(board, column.id).length} titles), ${column.count} leads`
    ),
    limit == null ? "no limit of leads per company" : `at most ${limit} leads per company`,
  ].join("; ");
}

function handleSaveFile() {
  const text = JSON.stringify(boardToFile(board), null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `job-titles-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log.info(`Job titles saved to a file: ${describeColumns()}`);
}

// Replaces all the columns (names, order, lead counts, titles) with the file's.
async function handleLoadFile() {
  const file = elements.fileInput.files?.[0];
  elements.fileInput.value = "";
  if (!file) return;
  try {
    board = boardFromFile(await file.text(), LEADS_COUNT, COMPANY_LIMIT);
  } catch (error) {
    log.error(`Could not load job titles from "${file.name}": ${error.message}`);
    status.error(`"${file.name}" is not a job titles file`);
    return;
  }
  persistBoard();
  render();
  log.info(`Job titles loaded from "${file.name}": ${describeColumns()}`);
  status.success(`Job titles loaded from "${file.name}"`);
}

// --- public API ------------------------------------------------------------

export async function initJobBoard(boardElements) {
  elements = boardElements;
  // A board saved before the columns could be changed kept the Management and
  // Technical lead counts apart; sanitizeBoard takes them into its columns.
  const stored = await loadValue(STORAGE_KEYS.board, null);
  const legacyCount = await loadValue(STORAGE_KEYS.leadsCount, {});
  board = sanitizeBoard(stored && { leadsCount: legacyCount, ...stored }, LEADS_COUNT, COMPANY_LIMIT);
  persistBoard();

  // The section (Job list + columns) collapses on a header click; the
  // open / closed state is remembered.
  elements.section.open = await loadValue(STORAGE_KEYS.jobSectionOpen, true);
  elements.section.addEventListener("toggle", () => saveValue(STORAGE_KEYS.jobSectionOpen, elements.section.open));

  initCompanyLimit();
  elements.addColumnButton.addEventListener("click", handleAddColumn);
  elements.saveButton.addEventListener("click", handleSaveFile);
  elements.fileInput.addEventListener("change", handleLoadFile);
  initDragSources(elements.root);
  initDropZone(elements.pool, POOL);
  render();
}

// `titles` is null when they couldn't be read; `message` then explains why.
export function setFilterTitles(titles, message = "") {
  filterTitlesKnown = Array.isArray(titles);
  filterTitles = filterTitlesKnown ? titles : [];
  elements.poolEmpty.textContent = message;
  render();
}

// Snapshot for the search logic: `columns`, in priority order, each with its
// entries by priority ([{ name, titles, count }]) and its wanted lead count
// (getBoardPlan); `companyLimit`, the leads one company may give in all, or
// null.
export function getJobPriorities() {
  return { columns: getBoardPlan(board), companyLimit: getCompanyLimit(board) };
}

// False when every column is empty; the Job titles section is then opened
// and shown, so the user sees where to add titles.
export function ensureJobTitles() {
  if (hasJobTitles(board)) return true;
  elements.section.open = true;
  elements.section.scrollIntoView({ behavior: "smooth", block: "start" });
  return false;
}
