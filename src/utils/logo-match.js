import { MATCH_RULES } from "./company-match.js";

// Checks a name-based company choice (company-match.js) against logos:
// the logo from the companies CSV vs. each dropdown option's logo, given as
// logo distances (image-hash.js logoDistance), null where an option has no
// usable logo. Only applies when there's something to compare.
//
// - The chosen option's logo matches: the choice is confirmed.
// - Unclear distance: the choice stands, flagged unsure.
// - Clearly different logo:
//   - a choice by exact name stands, flagged (a company's LinkedIn logo
//     can differ from the file's, so it doesn't outweigh an exact name);
//   - a weaker choice (only option, legal form) gives way to the option
//     whose logo matches, if exactly one does; otherwise nothing is chosen
//     (left for a manual choice).
// - Nothing chosen by name: an option is chosen if its logo alone matches.

export const LOGO_RULE = "logo";
export const LOGO_RULE_DESCRIPTION = "the only option whose logo matches the file's logo";

const EXACT_NAME_RULES = new Set([MATCH_RULES.EXACT, MATCH_RULES.EXACT_IGNORE_CASE]);

export const LOGO_VERDICTS = {
  CONFIRMED: "confirmed",
  UNSURE: "unsure",
  DIFFERENT_KEPT: "different-kept",
  OVERRIDDEN: "overridden",
  CHOSEN_BY_LOGO: "chosen-by-logo",
};

const present = (distance) => distance !== null && distance !== undefined;

// The one option whose logo matches: the closest within the match distance,
// clearly ahead of the next. -1 if none.
export function uniqueLogoMatch(distances, { matchMaxDistance, margin }) {
  const ranked = distances
    .map((distance, index) => ({ distance, index }))
    .filter(({ distance }) => present(distance))
    .sort((a, b) => a.distance - b.distance);
  const [best, second] = ranked;
  if (!best || best.distance > matchMaxDistance) return -1;
  if (second && second.distance - best.distance < margin) return -1;
  return best.index;
}

export function applyLogoCheck(nameChoice, distances, thresholds) {
  if (!distances.some(present)) return nameChoice;

  const logoIndex = uniqueLogoMatch(distances, thresholds);

  if (nameChoice.index === -1) {
    if (logoIndex === -1) return nameChoice;
    return {
      index: logoIndex,
      rule: LOGO_RULE,
      description: LOGO_RULE_DESCRIPTION,
      logo: { verdict: LOGO_VERDICTS.CHOSEN_BY_LOGO, distance: distances[logoIndex] },
    };
  }

  const distance = distances[nameChoice.index];
  if (!present(distance)) return nameChoice; // that option shows no logo

  if (distance <= thresholds.matchMaxDistance) {
    return { ...nameChoice, logo: { verdict: LOGO_VERDICTS.CONFIRMED, distance } };
  }
  if (distance < thresholds.mismatchMinDistance) {
    return { ...nameChoice, logo: { verdict: LOGO_VERDICTS.UNSURE, distance } };
  }
  if (EXACT_NAME_RULES.has(nameChoice.rule)) {
    return { ...nameChoice, logo: { verdict: LOGO_VERDICTS.DIFFERENT_KEPT, distance } };
  }
  if (logoIndex !== -1 && logoIndex !== nameChoice.index) {
    return {
      index: logoIndex,
      rule: LOGO_RULE,
      description: `${LOGO_RULE_DESCRIPTION} (option #${nameChoice.index + 1}, ${nameChoice.description}, has a different logo)`,
      logo: { verdict: LOGO_VERDICTS.OVERRIDDEN, distance: distances[logoIndex], rejectedDistance: distance },
    };
  }
  return {
    index: -1,
    reason: `option #${nameChoice.index + 1} (${nameChoice.description}) has a different logo than the file's`,
    logo: { rejectedDistance: distance },
  };
}
