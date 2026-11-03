import { normalizeName } from "./text-utils.js";

// Picks a company from the Sales Navigator typeahead for a typed name. The
// rules and their order come from labelled choices, where
// LinkedIn's own order of the options was the strongest signal: an option
// with the typed name at the top of the list was right ~95% of the time,
// one further down only ~45%.
//
// Options "with the same name" have the same name key (nameKey): case,
// legal form, punctuation and spaces don't count, e.g. Acme ↔ ACME GmbH,
// Factory 73 Ltd ↔ Factory73.
//
// Rules, from the highest priority down:
export const MATCH_RULES = {
  // The first option has the same name.
  FIRST_OPTION: "first-option",
  // The first option differs from the typed name only in case, and a lower
  // one has it exactly as typed (case-sensitive). (When the first option
  // differs by a legal form or punctuation instead, it's still the one.)
  EXACT: "exact",
  // The only option in the list, with a name that resembles the typed one.
  SINGLE_OPTION: "single-option",
};

export const MATCH_RULE_DESCRIPTIONS = {
  [MATCH_RULES.FIRST_OPTION]: "the first option, with the same name",
  [MATCH_RULES.EXACT]: "the first exact match (case-sensitive) among the options with the same name",
  [MATCH_RULES.SINGLE_OPTION]: "the only option in the list",
};

// Legal-form designations stripped from the end of a name (and, for the
// Ukrainian/Russian ones that are written first, from its start).
export const TRAILING_LEGAL_FORMS = [
  "gmbh & co. kg", "gmbh & co kg", "gmbh", "ag", "kg", "ug", "se", "mbh",
  "llc", "l.l.c.", "ltd", "ltd.", "limited", "inc", "inc.", "incorporated",
  "corp", "corp.", "corporation", "co", "co.", "company", "plc", "llp", "lp", "l.p.",
  "pty ltd", "pty. ltd.", "pty", "sa", "s.a.", "sas", "s.a.s.", "sarl", "s.a.r.l.",
  "srl", "s.r.l.", "spa", "s.p.a.", "sl", "s.l.", "ltda", "sa de cv", "s.a. de c.v.",
  "bv", "b.v.", "nv", "n.v.", "oy", "oyj", "ab", "as", "a/s", "asa", "aps",
  "sp. z o.o.", "sp. z o. o.", "sp.z o.o.", "sp. j.", "s.r.o.", "a.s.", "kft", "zrt",
  "sdn bhd", "sdn. bhd.", "bhd", "pte ltd", "pte. ltd.", "pvt ltd", "pvt. ltd.", "private limited",
  "d.o.o.", "doo", "tov", "тов", "ооо", "пп", "пат", "прат", "ат", "зат", "ват",
].sort((a, b) => b.length - a.length);

const LEADING_LEGAL_FORMS = ["тов", "ооо", "пп", "пат", "прат", "ат", "зат", "ват", "tov"];

// Name without quotes, commas and legal-form designations, lowercased.
export function stripLegalForm(name) {
  let core = normalizeName(String(name ?? "").replace(/["'«»“”„]/g, " ").replace(/,/g, " "));
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of TRAILING_LEGAL_FORMS) {
      if (core.endsWith(` ${form}`)) {
        core = core.slice(0, -form.length - 1).trim();
        changed = true;
      }
    }
    for (const form of LEADING_LEGAL_FORMS) {
      if (core.startsWith(`${form} `)) {
        core = core.slice(form.length + 1).trim();
        changed = true;
      }
    }
  }
  return core;
}

const collapseSpaces = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Comparison key: the name without case, legal form, punctuation and spaces.
export function nameKey(name) {
  return stripLegalForm(name).replace(/[^\p{L}\p{N}]+/gu, "");
}

// Whether an option has the same name as the typed one (see above).
export function hasSameName(typed, option) {
  const key = nameKey(typed);
  return Boolean(key) && nameKey(option) === key;
}

const words = (name) => stripLegalForm(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Whether an option could be the typed company at all. The typeahead finds
// options by word prefix, so a real result has a word starting with the
// typed name's first word, or a name key that starts with the typed one (or
// the other way round). When LinkedIn finds nothing, it suggests unrelated
// popular companies instead, which must never be chosen, not even by logo.
export function resemblesName(typed, option) {
  const [firstWord] = words(typed);
  const typedKey = nameKey(typed);
  const optionKey = nameKey(option);
  if (!firstWord || !optionKey) return false;
  return (
    words(option).some((word) => word.startsWith(firstWord)) ||
    optionKey.startsWith(typedKey) ||
    typedKey.startsWith(optionKey)
  );
}

// Returns { index, rule, description } for the chosen option, or
// { index: -1, reason } when none can be chosen automatically.
export function chooseCompanyOption(typed, options) {
  if (!options.length) return { index: -1, reason: "the dropdown list is empty" };
  if (!options.some((option) => resemblesName(typed, option))) {
    return { index: -1, reason: `none of the ${options.length} options resembles the name (LinkedIn found nothing)` };
  }

  const sameName = options.flatMap((option, index) => (hasSameName(typed, option) ? [index] : []));

  if (sameName.length) {
    if (sameName[0] !== 0) {
      return { index: -1, reason: `the option with the same name (#${sameName[0] + 1}) isn't first in the list` };
    }
    const exact = sameName.find((index) => collapseSpaces(options[index]) === collapseSpaces(typed));
    if (exact !== undefined && exact !== 0 && normalizeName(options[0]) === normalizeName(typed)) {
      return { index: exact, rule: MATCH_RULES.EXACT, description: MATCH_RULE_DESCRIPTIONS[MATCH_RULES.EXACT] };
    }
    return { index: 0, rule: MATCH_RULES.FIRST_OPTION, description: MATCH_RULE_DESCRIPTIONS[MATCH_RULES.FIRST_OPTION] };
  }

  if (options.length === 1) {
    return { index: 0, rule: MATCH_RULES.SINGLE_OPTION, description: MATCH_RULE_DESCRIPTIONS[MATCH_RULES.SINGLE_OPTION] };
  }

  return { index: -1, reason: `none of the ${options.length} options has the same name` };
}
