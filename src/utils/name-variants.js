import { TRAILING_LEGAL_FORMS } from "./company-match.js";
import { normalizeName } from "./text-utils.js";

// Shorter names to type when Sales Navigator has no option with the name
// from the companies file. In labelled choices (match records), about one
// company in five had to be retyped by hand, mostly as the name without:
//
// 1. a legal form: "LAIT ApS" → "LAIT", "MCB A/S" → "MCB";
// 2. a country or region: "Knowit Denmark" → "Knowit", "True Digital (US)";
// 3. a tagline after " - ", " | ", ", ", " (" or ": ":
//    "Codiance - Coded Brilliance" → "Codiance";
// 4. a trailing "Group": "IDHL Group" → "IDHL".
//
// The steps add up, in this order, and each yields a variant when it changes
// the name: "itm8 Sverige AB" → "itm8 Sverige", "itm8". The typed case is
// kept, since the rules prefer an exact-case match.

// Countries, regions and their codes, as written after a company name.
// Only codes that aren't common legal forms or words ("AS", "SE", "NO" are
// left out).
const REGIONS = [
  "united kingdom", "united states", "new zealand", "south africa",
  "uk", "us", "usa", "dk", "nl", "de", "au", "nz", "ch",
  "denmark", "danmark", "sweden", "sverige", "norway", "norge", "finland", "suomi",
  "germany", "deutschland", "netherlands", "nederland", "belgium", "austria", "österreich",
  "switzerland", "schweiz", "poland", "polska", "france", "spain", "españa", "italy", "italia",
  "ireland", "australia", "canada", "malaysia", "singapore", "india",
  "europe", "emea", "nordic", "nordics", "apac",
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const REGION_SUFFIX = new RegExp(`\\s+\\(?(?:${REGIONS.map(escape).join("|")})\\)?$`, "iu");
const TAGLINE = /^(.+?)(?:\s+[-–—|]\s+|,\s+|\s+\(|:\s+)/u;
const GROUP_SUFFIX = /\s+group$/iu;

const collapseSpaces = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const trimEnd = (value) => value.replace(/[\s,;:–—-]+$/u, "");

function withoutLegalForm(name) {
  let current = name;
  let changed = true;
  while (changed) {
    changed = false;
    const lower = current.toLowerCase();
    if (lower.length !== current.length) break; // case mapping changed the length
    for (const form of TRAILING_LEGAL_FORMS) {
      if (lower.endsWith(` ${form}`)) {
        current = trimEnd(current.slice(0, -form.length));
        changed = true;
        break;
      }
    }
  }
  return current;
}

const withoutRegion = (name) => name.replace(REGION_SUFFIX, "");
const withoutTagline = (name) => name.match(TAGLINE)?.[1] ?? name;
const withoutGroup = (name) => name.replace(GROUP_SUFFIX, "");

const STEPS = [withoutLegalForm, withoutRegion, withoutTagline, withoutGroup];

// The shorter names, most complete first; none equal to the name or each
// other (ignoring case), none shorter than 2 characters.
export function shorterNameVariants(name) {
  const seen = new Set([normalizeName(name)]);
  const variants = [];
  let current = collapseSpaces(name);
  for (const step of STEPS) {
    current = withoutLegalForm(trimEnd(step(current)).trim());
    const key = normalizeName(current);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    variants.push(current);
  }
  return variants;
}
