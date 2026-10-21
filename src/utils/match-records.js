// Records of how a typed company name was matched to a Sales Navigator
// dropdown option, kept in the extension for analysing and tuning the
// automatic choice.

export const MATCH_KINDS = { AUTO: "auto", MANUAL: "manual" };

// How a record came about: chosen by the rules, picked by hand because the
// rules couldn't choose, or picked by hand in labeling mode (the rules'
// choice is only predicted, never applied).
export const MATCH_MODES = { AUTO: "auto", FALLBACK: "fallback", LABELING: "labeling" };

export const MATCH_RECORDS_LIMIT = 5000;

// Bumped when the record format changes; stored records of another version
// are dropped. 2: `companyId`. 3: per-option features, the rules'
// prediction, the chosen option's position, CSV data, leads count.
export const MATCH_RECORDS_VERSION = 3;

// LinkedIn's numeric company id from its URN ("urn:li:organization:2781504"
// → "2781504"); other ids are returned as they are, missing ones as null.
export function companyIdFromUrn(urn) {
  if (urn === null || urn === undefined || urn === "") return null;
  const match = String(urn).match(/^urn:li:(?:organization|company|fs_salesCompany):(\d+)$/);
  return match ? match[1] : String(urn);
}

// Position of the chosen company among the option labels, -1 if it wasn't
// one of them (e.g. the user typed something else before picking).
export function chosenIndexIn(labels, chosen) {
  return labels.indexOf(chosen);
}

// Builds a record. `options` are per-option objects ({ index, label, ... });
// `prediction` is what the rules chose or would choose ({ index, label,
// rule, reason, logo }). `predictionCorrect` compares it with the chosen
// option, so it's only set when a person made the choice.
export function createMatchRecord(
  { mode, typed, chosen, companyId, options = [], prediction = null, csv = null, leads = null, pickMs = null },
  date = new Date()
) {
  const labels = options.map((option) => option.label);
  const chosenIndex = chosen ? chosenIndexIn(labels, chosen) : -1;
  const pickedByHand = mode !== MATCH_MODES.AUTO;
  return {
    time: date.toISOString(),
    mode,
    typed,
    chosen,
    companyId: companyId ?? null,
    chosenIndex,
    chosenInList: chosenIndex !== -1,
    prediction,
    predictionCorrect: pickedByHand && prediction ? prediction.index === chosenIndex : null,
    pickMs: pickedByHand ? pickMs : null,
    leads,
    csv,
    options,
  };
}

// Appends, dropping the oldest records beyond `limit`.
export function appendCapped(list, item, limit = MATCH_RECORDS_LIMIT) {
  const next = [...list, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
