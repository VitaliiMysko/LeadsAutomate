import { isSameName } from "./text-utils.js";

// Companies whose lead selection stopped because Lead generator couldn't
// verify the emails yet ("There are unknown emails"), each searched once
// more when its own delay runs out: [{ name, dueAt }], `dueAt` a
// time in ms. Every function returns a new list.

// Adds the company (or replaces its entry) with its recheck due `delayMs`
// after `now`.
export function scheduleRecheck(list, name, now, delayMs) {
  return [...removeRecheck(list, name), { name, dueAt: now + delayMs }];
}

export function removeRecheck(list, name) {
  return list.filter((item) => !isSameName(item.name, name));
}

export function findRecheck(list, name) {
  return list.find((item) => isSameName(item.name, name)) ?? null;
}

// The entry due first among those due at `now`, or null.
export function dueRecheck(list, now) {
  return list.filter((item) => item.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)[0] ?? null;
}

// When the next recheck is due, or null for an empty list.
export function nextRecheckAt(list) {
  return list.length ? Math.min(...list.map((item) => item.dueAt)) : null;
}

// "4:05" until `dueAt`, "due" once it's reached.
export function recheckCountdown(dueAt, now) {
  const left = Math.ceil((dueAt - now) / 1000);
  if (left <= 0) return "due";
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

// The stored list, without malformed entries.
export function parseRechecks(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => typeof item?.name === "string" && Number.isFinite(item.dueAt))
    .map(({ name, dueAt }) => ({ name, dueAt }));
}
