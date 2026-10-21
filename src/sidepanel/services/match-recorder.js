import { STORAGE_KEYS } from "../../constants/config.js";
import { MATCH_KINDS, createMatchRecord, appendCapped } from "../../utils/match-records.js";
import { loadValue, saveValue } from "../store/storage.js";

// Keeps the auto / manual company-match records in chrome.storage.local.
// They're internal data for tuning the automatic choice, never written to disk.

function emptyRecords() {
  return Object.fromEntries(Object.values(MATCH_KINDS).map((kind) => [kind, []]));
}

export async function loadMatchRecords() {
  const stored = await loadValue(STORAGE_KEYS.matchRecords, {});
  const records = emptyRecords();
  for (const kind of Object.values(MATCH_KINDS)) {
    if (Array.isArray(stored[kind])) records[kind] = stored[kind];
  }
  return records;
}

// Writes are serialized so two quick records can't overwrite each other.
let writeChain = Promise.resolve();

export function recordMatch(kind, fields) {
  const run = writeChain.then(async () => {
    const records = await loadMatchRecords();
    records[kind] = appendCapped(records[kind], createMatchRecord(fields));
    await saveValue(STORAGE_KEYS.matchRecords, records);
    return records[kind].length;
  });
  writeChain = run.catch(() => {});
  return run;
}
