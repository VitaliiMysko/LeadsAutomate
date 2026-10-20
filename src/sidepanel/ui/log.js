import { LOG_LIMIT } from "../../constants/config.js";

const LEVELS = ["debug", "info", "success", "warn", "error"];
const LEVEL_LABELS = { debug: "DEBUG", info: "INFO", success: "OK", warn: "WARN", error: "ERROR" };

const entries = [];
let logElement = null;
let levelFilter = "all";

function timeStamp(date) {
  return date.toLocaleTimeString([], { hour12: false }) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

function isShown(entry) {
  if (levelFilter === "all") return true;
  // "warn" also shows errors: everything at or above the chosen level.
  return LEVELS.indexOf(entry.level) >= LEVELS.indexOf(levelFilter);
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

function append(level, text, source = "panel") {
  const entry = { level, text: String(text), source, date: new Date() };
  entries.push(entry);
  if (entries.length > LOG_LIMIT) {
    const [removed] = entries.splice(0, 1);
    if (logElement?.firstChild && isShown(removed)) logElement.firstChild.remove();
  }
  if (!logElement || !isShown(entry)) return;

  const stick = isScrolledToBottom();
  logElement.appendChild(createRow(entry));
  if (stick) logElement.scrollTop = logElement.scrollHeight;
}

function render() {
  logElement.replaceChildren(...entries.filter(isShown).map(createRow));
  logElement.scrollTop = logElement.scrollHeight;
}

export const log = Object.fromEntries(LEVELS.map((level) => [level, (text) => append(level, text)]));

export function initLog({ element, filterSelect, copyButton, clearButton }) {
  logElement = element;

  filterSelect.addEventListener("change", () => {
    levelFilter = filterSelect.value;
    render();
  });

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
    render();
  });

  // Lines forwarded by the content script on the Sales Navigator page.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "la:log") return;
    append(LEVELS.includes(message.level) ? message.level : "info", message.text, "page");
  });
}
