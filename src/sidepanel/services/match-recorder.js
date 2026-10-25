import { STORAGE_KEYS } from "../../constants/config.js";
import { MATCH_KINDS, MATCH_RECORDS_VERSION, createMatchRecord, appendCapped } from "../../utils/match-records.js";
import { loadValue, saveValue } from "../store/storage.js";

// Keeps the auto / manual company-match records in chrome.storage.local, as
// { version, auto: [...], manual: [...] }. They're internal data for tuning
// the automatic choice, never written to disk.

function emptyRecords() {
  return {
    version: MATCH_RECORDS_VERSION,
    ...Object.fromEntries(Object.values(MATCH_KINDS).map((kind) => [kind, []])),
  };
}

// Records of an older format (another version) count as none.
export async function loadMatchRecords() {
  const stored = await loadValue(STORAGE_KEYS.matchRecords, {});
  const records = emptyRecords();
  if (stored?.version !== MATCH_RECORDS_VERSION) return records;
  for (const kind of Object.values(MATCH_KINDS)) {
    if (Array.isArray(stored[kind])) records[kind] = stored[kind];
  }
  return records;
}

// Drops stored records of an older format. Returns how many were dropped.
export async function clearOutdatedMatchRecords() {
  const stored = await loadValue(STORAGE_KEYS.matchRecords, null);
  if (!stored || stored.version === MATCH_RECORDS_VERSION) return 0;
  const dropped = Object.values(MATCH_KINDS).reduce(
    (sum, kind) => sum + (Array.isArray(stored[kind]) ? stored[kind].length : 0),
    0
  );
  await saveValue(STORAGE_KEYS.matchRecords, emptyRecords());
  return dropped;
}

// Writes are serialized so two quick records can't overwrite each other.
let writeChain = Promise.resolve();
const listeners = new Set();

export function subscribeMatchRecords(listener) {
  listeners.add(listener);
}

export async function matchRecordCounts() {
  const records = await loadMatchRecords();
  return Object.fromEntries(Object.values(MATCH_KINDS).map((kind) => [kind, records[kind].length]));
}

export function recordMatch(kind, fields) {
  const run = writeChain.then(async () => {
    const records = await loadMatchRecords();
    records[kind] = appendCapped(records[kind], createMatchRecord(fields));
    await saveValue(STORAGE_KEYS.matchRecords, records);
    return records[kind].length;
  });
  writeChain = run.catch(() => {});
  run.then(() => listeners.forEach((listener) => listener())).catch(() => {});
  return run;
}

// Deletes every record, on the user's request (to start a fresh labelled
// set). Returns how many of each kind were deleted.
export function clearMatchRecords() {
  const run = writeChain.then(async () => {
    const records = await loadMatchRecords();
    await saveValue(STORAGE_KEYS.matchRecords, emptyRecords());
    return Object.fromEntries(Object.values(MATCH_KINDS).map((kind) => [kind, records[kind].length]));
  });
  writeChain = run.catch(() => {});
  run.then(() => listeners.forEach((listener) => listener())).catch(() => {});
  return run;
}

// Saves all records as a JSON file through the browser's download, on the
// user's request (the extension never writes files on its own).
export async function downloadMatchRecords() {
  const records = await loadMatchRecords();
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `company-match-records-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Object.fromEntries(Object.values(MATCH_KINDS).map((kind) => [kind, records[kind].length]));
}
