import { formatDuration } from "../../utils/text-utils.js";

// The small status area: one line saying what's happening now, with a live
// elapsed timer while an operation runs and its total time once it ends.
let rootElement = null;
let textElement = null;
let timeElement = null;
let startedAt = null;
let ticker = null;

function setState(state, text, timeText = "") {
  rootElement.className = `status status--${state}`;
  textElement.textContent = text;
  timeElement.textContent = timeText;
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function finish(state, text) {
  stopTicker();
  const elapsed = startedAt ? formatDuration(Date.now() - startedAt) : "";
  startedAt = null;
  setState(state, text, elapsed);
}

export const status = {
  // Starts (or, while already running, just relabels) a timed operation.
  running(text) {
    if (!startedAt) startedAt = Date.now();
    setState("running", text, formatDuration(Date.now() - startedAt));
    if (!ticker) {
      ticker = setInterval(() => {
        timeElement.textContent = formatDuration(Date.now() - startedAt);
      }, 500);
    }
  },
  success: (text) => finish("success", text),
  error: (text) => finish("error", text),
  warn: (text) => finish("warn", text),
  idle: (text) => finish("idle", text),
  // Updates the message without ending a running operation.
  note(state, text) {
    if (startedAt) {
      textElement.textContent = text;
    } else {
      setState(state, text);
    }
  },
};

export function initStatus(element) {
  rootElement = element;
  textElement = element.querySelector(".status__text");
  timeElement = element.querySelector(".status__time");
  setState("idle", "Ready");
}
