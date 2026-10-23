// Combines a name-based company choice (company-match.js) with logos: the
// logo from the companies CSV vs. each dropdown option's logo, given as logo
// distances (image-hash.js logoDistance), null where an option has no usable
// logo. Only applies when there's something to compare.
//
// In labelled choices (match records), a logo helped only where the name
// rules couldn't choose: there, the one option whose logo clearly matched
// was right every time (7 of 7), while overriding a name choice was right
// once in 4 (same-name duplicates often share a logo). A distant logo meant
// nothing: the file's logo differed from the LinkedIn one for about two
// thirds of the right companies. So:
//
// - Name rules chose: the choice stands; the logo only confirms it or is
//   noted as not confirming it.
// - Name rules couldn't choose: the one option whose logo clearly matches is
//   chosen, unless its name doesn't resemble the typed one at all
//   (`eligible[i]` false; LinkedIn's suggestions when it finds nothing).

export const LOGO_RULE = "logo";
export const LOGO_RULE_DESCRIPTION = "the only option whose logo matches the file's logo";

export const LOGO_VERDICTS = {
  CONFIRMED: "confirmed",
  NOT_CONFIRMED: "not-confirmed",
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

export function applyLogoCheck(nameChoice, distances, thresholds, eligible = []) {
  if (!distances.some(present)) return nameChoice;

  if (nameChoice.index === -1) {
    const logoIndex = uniqueLogoMatch(distances, thresholds);
    if (logoIndex === -1 || eligible[logoIndex] === false) return nameChoice;
    return {
      index: logoIndex,
      rule: LOGO_RULE,
      description: LOGO_RULE_DESCRIPTION,
      logo: { verdict: LOGO_VERDICTS.CHOSEN_BY_LOGO, distance: distances[logoIndex] },
    };
  }

  const distance = distances[nameChoice.index];
  if (!present(distance)) return nameChoice; // that option shows no logo
  const verdict = distance <= thresholds.matchMaxDistance ? LOGO_VERDICTS.CONFIRMED : LOGO_VERDICTS.NOT_CONFIRMED;
  return { ...nameChoice, logo: { verdict, distance } };
}
