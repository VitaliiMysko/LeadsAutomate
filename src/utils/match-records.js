// Records of how a typed company name was matched to a Sales Navigator
// dropdown option, kept in the extension to tune the automatic choice later.

export const MATCH_KINDS = { AUTO: "auto", MANUAL: "manual" };

export const MATCH_RECORDS_LIMIT = 5000;

// Bumped when the record format changes; stored records of another version
// are dropped. 2: records carry the chosen company's `companyId`.
export const MATCH_RECORDS_VERSION = 2;

// LinkedIn's numeric company id from its URN ("urn:li:organization:2781504"
// → "2781504"); other ids are returned as they are, missing ones as null.
export function companyIdFromUrn(urn) {
  if (urn === null || urn === undefined || urn === "") return null;
  const match = String(urn).match(/^urn:li:(?:organization|company|fs_salesCompany):(\d+)$/);
  return match ? match[1] : String(urn);
}

export function createMatchRecord({ typed, chosen, companyId, options, rule, reason, logo }, date = new Date()) {
  const record = { time: date.toISOString(), typed, chosen, companyId: companyId ?? null };
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
