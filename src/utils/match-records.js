// Records of how a typed company name was matched to a Sales Navigator
// dropdown option, kept in the extension to tune the automatic choice later.

export const MATCH_KINDS = { AUTO: "auto", MANUAL: "manual" };

export const MATCH_RECORDS_LIMIT = 5000;

export function createMatchRecord({ typed, chosen, options, rule, reason, logo }, date = new Date()) {
  const record = { time: date.toISOString(), typed, chosen };
  if (rule) record.rule = rule;
  if (reason) record.reason = reason;
  // Logo check outcome: { verdict, distance, ... } (logo-match.js).
  if (logo) record.logo = logo;
  record.options = [...options];
  return record;
}

// Appends, dropping the oldest records beyond `limit`.
export function appendCapped(list, item, limit = MATCH_RECORDS_LIMIT) {
  const next = [...list, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
