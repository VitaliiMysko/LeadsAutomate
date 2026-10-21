import { LOG_LIMIT, STORAGE_KEYS } from "../../constants/config.js";
import { loadValue, saveValue } from "../store/storage.js";

const LEVELS = ["debug", "info", "success", "warn", "error"];
const LEVEL_LABELS = { debug: "DEBUG", info: "INFO", success: "OK", warn: "WARN", error: "ERROR" };

const entries = [];
const counts = Object.fromEntries(LEVELS.map((level) => [level, 0]));
let logElement = null;
let filterButtons = {};
let allButton = null;
let shownLevels = new Set(LEVELS);

function timeStamp(date) {
  return date.toLocaleTimeString([], { hour12: false }) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

function isShown(entry) {
  return shownLevels.has(entry.level);
}

function createRow(entry) {
  const row = document.createElement("div");
  row.className = `log-row log-row--${entry.level}`;

  const time = document.createElement("span");
  time.className = "log-row__time";
  time.textContent = timeStamp(entry.date);

  const level = document.createElement("span");
  level.className = "log-row__level";
  level.textContent = LEVEL_LABELS[entry.level];

  const text = document.createElement("span");
  text.className = "log-row__text";
  text.textContent = entry.source === "page" ? `[page] ${entry.text}` : entry.text;

  row.append(time, level, text);
  return row;
}

function isScrolledToBottom() {
  return logElement.scrollHeight - logElement.scrollTop - logElement.clientHeight < 24;
}

function updateFilterButtons() {
  for (const level of LEVELS) {
    const button = filterButtons[level];
    if (!button) continue;
    button.setAttribute("aria-pressed", String(shownLevels.has(level)));
    button.querySelector(".log-filter__count").textContent = counts[level];
  }
  allButton?.setAttribute("aria-pressed", String(shownLevels.size === LEVELS.length));
}

function append(level, text, source = "panel") {
  const entry = { level, text: String(text), source, date: new Date() };
  entries.push(entry);
  counts[level]++;
  if (entries.length > LOG_LIMIT) {
    const [removed] = entries.splice(0, 1);
    counts[removed.level]--;
    if (logElement?.firstChild && isShown(removed)) logElement.firstChild.remove();
  }
  updateFilterButtons();
  if (!logElement || !isShown(entry)) return;

  const stick = isScrolledToBottom();
  logElement.appendChild(createRow(entry));
  if (stick) logElement.scrollTop = logElement.scrollHeight;
}

function render() {
  logElement.replaceChildren(...entries.filter(isShown).map(createRow));
  logElement.scrollTop = logElement.scrollHeight;
  updateFilterButtons();
}

function setShownLevels(levels) {
  shownLevels = new Set(levels);
  saveValue(STORAGE_KEYS.logLevels, [...shownLevels]);
  render();
}

function createFilterButton(label, level) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `log-filter log-filter--${level ?? "all"}`;
  button.textContent = label;
  if (level) {
    button.title = "Click to show / hide. Double-click to show only this marker.";
    const count = document.createElement("span");
    count.className = "log-filter__count";
    button.append(count);
  } else {
    button.title = "Show all markers";
  }
  return button;
}

function initFilters(container) {
  allButton = createFilterButton("All");
  allButton.addEventListener("click", () => setShownLevels(LEVELS));
  container.append(allButton);

  for (const level of LEVELS) {
    const button = createFilterButton(LEVEL_LABELS[level], level);
    button.addEventListener("click", () => {
      const next = new Set(shownLevels);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      setShownLevels(next);
    });
    // A double-click also fires two clicks; this runs after them and wins.
    button.addEventListener("dblclick", () => setShownLevels([level]));
    filterButtons[level] = button;
    container.append(button);
  }
}

export const log = Object.fromEntries(LEVELS.map((level) => [level, (text) => append(level, text)]));

export async function initLog({ element, filtersContainer, copyButton, clearButton }) {
  logElement = element;
  initFilters(filtersContainer);

  const storedLevels = await loadValue(STORAGE_KEYS.logLevels, LEVELS);
  shownLevels = new Set((Array.isArray(storedLevels) ? storedLevels : LEVELS).filter((level) => LEVELS.includes(level)));
  render();

  copyButton.addEventListener("click", async () => {
    const text = entries
      .filter(isShown)
      .map((entry) => `${timeStamp(entry.date)} [${LEVEL_LABELS[entry.level]}] ${entry.source === "page" ? "[page] " : ""}${entry.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      log.info("Log copied to clipboard");
    } catch {
      log.error("Could not copy the log to clipboard");
    }
  });

  clearButton.addEventListener("click", () => {
    entries.length = 0;
    for (const level of LEVELS) counts[level] = 0;
    render();
  });

  // Lines forwarded by the content script on the Sales Navigator page.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "la:log") return;
    append(LEVELS.includes(message.level) ? message.level : "info", message.text, "page");
  });
}
