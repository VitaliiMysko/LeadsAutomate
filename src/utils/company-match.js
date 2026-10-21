import { normalizeName } from "./text-utils.js";

// Picks a company from the Sales Navigator typeahead for a typed name.
// Rules, from the highest priority down; each applies only when it matches
// exactly one option:
export const MATCH_RULES = {
  EXACT: "exact",
  EXACT_IGNORE_CASE: "exact-ignore-case",
  SINGLE_OPTION: "single-option",
  LEGAL_FORM: "legal-form",
};

export const MATCH_RULE_DESCRIPTIONS = {
  [MATCH_RULES.EXACT]: "the only exact match (case-sensitive)",
  [MATCH_RULES.EXACT_IGNORE_CASE]: "the only exact match ignoring case",
  [MATCH_RULES.SINGLE_OPTION]: "the only option in the list",
  [MATCH_RULES.LEGAL_FORM]: "the only match ignoring the legal form (GmbH, LLC…)",
};

// Legal-form designations stripped from the end of a name (and, for the
// Ukrainian/Russian ones that are written first, from its start).
const TRAILING_LEGAL_FORMS = [
  "gmbh & co. kg", "gmbh & co kg", "gmbh", "ag", "kg", "ug", "se", "mbh",
  "llc", "l.l.c.", "ltd", "ltd.", "limited", "inc", "inc.", "incorporated",
  "corp", "corp.", "corporation", "co", "co.", "company", "plc", "llp", "lp", "l.p.",
  "pty ltd", "pty. ltd.", "pty", "sa", "s.a.", "sas", "s.a.s.", "sarl", "s.a.r.l.",
  "srl", "s.r.l.", "spa", "s.p.a.", "sl", "s.l.", "ltda", "sa de cv", "s.a. de c.v.",
  "bv", "b.v.", "nv", "n.v.", "oy", "oyj", "ab", "as", "a/s", "asa", "aps",
  "sp. z o.o.", "sp. z o. o.", "sp.z o.o.", "sp. j.", "s.r.o.", "a.s.", "kft", "zrt",
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

function onlyMatch(options, predicate) {
  const indexes = options.flatMap((option, index) => (predicate(option) ? [index] : []));
  return indexes.length === 1 ? indexes[0] : -1;
}

// Returns { index, rule, description } for the chosen option, or
// { index: -1, reason } when none can be chosen automatically.
export function chooseCompanyOption(typed, options) {
  if (!options.length) return { index: -1, reason: "the dropdown list is empty" };

  const exact = collapseSpaces(typed);
  const rules = [
    [MATCH_RULES.EXACT, (option) => collapseSpaces(option) === exact],
    [MATCH_RULES.EXACT_IGNORE_CASE, (option) => normalizeName(option) === normalizeName(typed)],
    [MATCH_RULES.SINGLE_OPTION, () => options.length === 1],
    [MATCH_RULES.LEGAL_FORM, (option) => stripLegalForm(option) === stripLegalForm(typed)],
  ];

  for (const [rule, predicate] of rules) {
    const index = onlyMatch(options, predicate);
    if (index !== -1) return { index, rule, description: MATCH_RULE_DESCRIPTIONS[rule] };
  }

  const ambiguous = options.filter((option) => stripLegalForm(option) === stripLegalForm(typed)).length;
  return {
    index: -1,
    reason: ambiguous > 1
      ? `${ambiguous} options match equally well`
      : `none of the ${options.length} options matches`,
  };
}
