// Comparison key for names typed by the user vs. shown by LinkedIn:
// case-, accent-spacing- and whitespace-insensitive.
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function isSameName(a, b) {
  return normalizeName(a) === normalizeName(b);
}

// "1m 05s", "12.4s", "850ms"
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function randomBetween(min, max) {
  return Math.round(min + Math.random() * (max - min));
}
