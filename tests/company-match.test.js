import { chooseCompanyOption, stripLegalForm, MATCH_RULES } from "../src/utils/company-match.js";

describe("chooseCompanyOption: rule priority", () => {
  test("1. the only case-sensitive exact match", () => {
    expect(chooseCompanyOption("Acme", ["ACME", "Acme", "Acme Labs"])).toMatchObject({
      index: 1,
      rule: MATCH_RULES.EXACT,
    });
  });

  test("whitespace differences don't break an exact match", () => {
    expect(chooseCompanyOption("  Future   Processing ", ["Future Processing", "Future"])).toMatchObject({
      index: 0,
      rule: MATCH_RULES.EXACT,
    });
  });

  test("2. the only exact match ignoring case", () => {
    expect(chooseCompanyOption("acme", ["ACME", "Acme Labs"])).toMatchObject({
      index: 0,
      rule: MATCH_RULES.EXACT_IGNORE_CASE,
    });
  });

  test("2 is skipped when several options differ only in case", () => {
    expect(chooseCompanyOption("acme", ["ACME", "Acme"]).index).toBe(-1);
  });

  test("3. the only option, even if the name differs", () => {
    expect(chooseCompanyOption("Acme", ["Acme Holdings International"])).toMatchObject({
      index: 0,
      rule: MATCH_RULES.SINGLE_OPTION,
    });
  });

  test("4. the only match with / without a legal form", () => {
    expect(chooseCompanyOption("Acme", ["Acme GmbH", "Acme Labs"])).toMatchObject({
      index: 0,
      rule: MATCH_RULES.LEGAL_FORM,
    });
    expect(chooseCompanyOption("Acme, Inc.", ["Acme", "Acme Labs"])).toMatchObject({
      index: 0,
      rule: MATCH_RULES.LEGAL_FORM,
    });
    expect(chooseCompanyOption("Acme LLC", ["ACME Ltd", "Acme Labs"])).toMatchObject({
      index: 0,
      rule: MATCH_RULES.LEGAL_FORM,
    });
  });

  test("an exact match wins over a legal-form match", () => {
    expect(chooseCompanyOption("Acme", ["Acme GmbH", "Acme"])).toMatchObject({ index: 1, rule: MATCH_RULES.EXACT });
  });
});

describe("chooseCompanyOption: no automatic choice", () => {
  test("empty list", () => {
    expect(chooseCompanyOption("Acme", [])).toEqual({ index: -1, reason: "the dropdown list is empty" });
  });

  test("several equally good legal-form matches", () => {
    expect(chooseCompanyOption("Acme", ["Acme GmbH", "Acme LLC", "Other"])).toEqual({
      index: -1,
      reason: "2 options match equally well",
    });
  });

  test("two identical exact matches are ambiguous", () => {
    expect(chooseCompanyOption("Acme", ["Acme", "Acme"]).index).toBe(-1);
  });

  test("nothing similar", () => {
    expect(chooseCompanyOption("Acme", ["Acme Labs", "Acmeson"])).toEqual({
      index: -1,
      reason: "none of the 2 options matches",
    });
  });
});

describe("stripLegalForm", () => {
  test.each([
    ["Acme GmbH", "acme"],
    ["Acme GmbH & Co. KG", "acme"],
    ["Acme, Inc.", "acme"],
    ["Acme Sp. z o.o.", "acme"],
    ["Acme Pty Ltd", "acme"],
    ["ТОВ «Акме»", "акме"],
    ["Acme Software", "acme software"],
    ["GmbH", "gmbh"],
  ])("%s → %s", (name, expected) => {
    expect(stripLegalForm(name)).toBe(expected);
  });
});
