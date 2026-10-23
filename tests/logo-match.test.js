import { applyLogoCheck, uniqueLogoMatch, LOGO_RULE, LOGO_VERDICTS } from "../src/utils/logo-match.js";
import { MATCH_RULES } from "../src/utils/company-match.js";

const thresholds = { matchMaxDistance: 10, margin: 6 };
const byName = { index: 0, rule: MATCH_RULES.FIRST_OPTION, description: "the first option, with the same name" };
const noChoice = { index: -1, reason: "none of the 3 options has the same name" };

describe("uniqueLogoMatch", () => {
  test("the only option within the match distance", () => {
    expect(uniqueLogoMatch([30, 5, null], thresholds)).toBe(1);
  });

  test("closest wins only with a clear margin", () => {
    expect(uniqueLogoMatch([4, 12], thresholds)).toBe(0);
    expect(uniqueLogoMatch([4, 8], thresholds)).toBe(-1);
  });

  test("none close enough", () => {
    expect(uniqueLogoMatch([14, 30], thresholds)).toBe(-1);
    expect(uniqueLogoMatch([null, null], thresholds)).toBe(-1);
  });
});

describe("applyLogoCheck", () => {
  test("no usable logos: the name choice is untouched", () => {
    expect(applyLogoCheck(byName, [null, null], thresholds)).toBe(byName);
    expect(applyLogoCheck(noChoice, [], thresholds)).toBe(noChoice);
  });

  test("a unique logo match on the chosen option confirms it", () => {
    expect(applyLogoCheck(byName, [7, 25], thresholds)).toEqual({
      ...byName,
      logo: { verdict: LOGO_VERDICTS.CONFIRMED, distance: 7 },
    });
  });

  test("a unique logo match elsewhere doesn't override the name choice", () => {
    expect(applyLogoCheck(byName, [28, 4], thresholds)).toEqual({
      ...byName,
      logo: { verdict: LOGO_VERDICTS.NOT_CONFIRMED, distance: 28 },
    });
  });

  test("no name choice: a unique logo match chooses", () => {
    expect(applyLogoCheck(noChoice, [26, 3, 24], thresholds)).toMatchObject({
      index: 1,
      rule: LOGO_RULE,
      logo: { verdict: LOGO_VERDICTS.CHOSEN_BY_LOGO, distance: 3 },
    });
  });

  test("an option that doesn't resemble the name is never chosen by logo", () => {
    expect(applyLogoCheck(noChoice, [26, 3, 24], thresholds, [true, false, true])).toBe(noChoice);
  });

  test("a different logo never rejects the name choice", () => {
    expect(applyLogoCheck(byName, [28], thresholds)).toEqual({
      ...byName,
      logo: { verdict: LOGO_VERDICTS.NOT_CONFIRMED, distance: 28 },
    });
  });

  test("a close but not unique logo on the chosen option still confirms it", () => {
    expect(applyLogoCheck(byName, [4, 6], thresholds).logo).toEqual({ verdict: LOGO_VERDICTS.CONFIRMED, distance: 4 });
  });

  test("chosen option shows no logo: untouched", () => {
    expect(applyLogoCheck(byName, [null, 20], thresholds)).toBe(byName);
  });

  test("no name choice and no unique logo match: stays unresolved", () => {
    expect(applyLogoCheck(noChoice, [4, 6], thresholds)).toBe(noChoice);
  });
});
