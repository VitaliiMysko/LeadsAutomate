import { applyLogoCheck, uniqueLogoMatch, LOGO_RULE, LOGO_VERDICTS } from "../src/utils/logo-match.js";
import { MATCH_RULES } from "../src/utils/company-match.js";

const thresholds = { matchMaxDistance: 10, mismatchMinDistance: 20, margin: 6 };
const byExactName = { index: 0, rule: MATCH_RULES.EXACT, description: "the only exact match (case-sensitive)" };
const byOnlyOption = { index: 0, rule: MATCH_RULES.SINGLE_OPTION, description: "the only option in the list" };
const byLegalForm = { index: 0, rule: MATCH_RULES.LEGAL_FORM, description: "the only match ignoring the legal form" };
const noChoice = { index: -1, reason: "2 options match equally well" };

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
    expect(applyLogoCheck(byExactName, [null, null], thresholds)).toBe(byExactName);
    expect(applyLogoCheck(noChoice, [], thresholds)).toBe(noChoice);
  });

  test("chosen option shows no logo: untouched", () => {
    expect(applyLogoCheck(byOnlyOption, [null, 3], thresholds)).toBe(byOnlyOption);
  });

  test("matching logo confirms the choice", () => {
    expect(applyLogoCheck(byOnlyOption, [7, 25], thresholds)).toEqual({
      ...byOnlyOption,
      logo: { verdict: LOGO_VERDICTS.CONFIRMED, distance: 7 },
    });
  });

  test("unclear distance keeps the choice, flagged unsure", () => {
    expect(applyLogoCheck(byLegalForm, [15, 30], thresholds).logo).toEqual({ verdict: LOGO_VERDICTS.UNSURE, distance: 15 });
  });

  test("different logo never overturns an exact-name choice", () => {
    expect(applyLogoCheck(byExactName, [28, 2], thresholds)).toEqual({
      ...byExactName,
      logo: { verdict: LOGO_VERDICTS.DIFFERENT_KEPT, distance: 28 },
    });
  });

  test("different logo on a weaker choice: the option whose logo matches takes over", () => {
    const result = applyLogoCheck(byLegalForm, [28, 4], thresholds);
    expect(result).toMatchObject({ index: 1, rule: LOGO_RULE });
    expect(result.logo).toEqual({ verdict: LOGO_VERDICTS.OVERRIDDEN, distance: 4, rejectedDistance: 28 });
  });

  test("different logo on the only option, no other match: nothing chosen", () => {
    const result = applyLogoCheck(byOnlyOption, [28], thresholds);
    expect(result.index).toBe(-1);
    expect(result.reason).toMatch(/option #1 .* different logo/);
  });

  test("no name choice: a unique logo match chooses", () => {
    expect(applyLogoCheck(noChoice, [26, 3, 24], thresholds)).toMatchObject({
      index: 1,
      rule: LOGO_RULE,
      logo: { verdict: LOGO_VERDICTS.CHOSEN_BY_LOGO, distance: 3 },
    });
  });

  test("no name choice and no unique logo match: stays unresolved", () => {
    expect(applyLogoCheck(noChoice, [4, 6], thresholds)).toBe(noChoice);
  });
});
