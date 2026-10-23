import { chooseCompanyOption, stripLegalForm, nameKey, resemblesName, MATCH_RULES } from "../src/utils/company-match.js";

describe("chooseCompanyOption: rule priority", () => {
  test("1. the first option, with the same name", () => {
    expect(chooseCompanyOption("Acme", ["Acme", "Acme Labs"])).toMatchObject({ index: 0, rule: MATCH_RULES.FIRST_OPTION });
  });

  test("1. same name ignoring case, legal form, punctuation and spaces", () => {
    expect(chooseCompanyOption("acme", ["ACME", "Acme Labs"])).toMatchObject({ index: 0, rule: MATCH_RULES.FIRST_OPTION });
    expect(chooseCompanyOption("Smilenet", ["Smilenet S.r.l.", "SmileNet"])).toMatchObject({ index: 0, rule: MATCH_RULES.FIRST_OPTION });
    expect(chooseCompanyOption("Factory 73 Ltd", ["Factory73", "Factory 73 Ltd"]).index).toBe(0);
    expect(chooseCompanyOption("Envnt", ["envnt.", "ENVNT"]).index).toBe(0);
  });

  test("1. several options with the same name: the first one", () => {
    expect(chooseCompanyOption("Acme", ["Acme", "Acme", "ACME"])).toMatchObject({ index: 0, rule: MATCH_RULES.FIRST_OPTION });
  });

  test("whitespace differences don't break a match", () => {
    expect(chooseCompanyOption("  Future   Processing ", ["Future Processing", "Future"]).index).toBe(0);
  });

  test("2. the first option differs only in case: the exact match below it", () => {
    expect(chooseCompanyOption("ZUPA", ["Zupa", "ZUPA", "Zupain"])).toMatchObject({ index: 1, rule: MATCH_RULES.EXACT });
  });

  test("the first option differs by a legal form: it stays the choice", () => {
    expect(chooseCompanyOption("Acme", ["Acme GmbH", "Acme"])).toMatchObject({ index: 0, rule: MATCH_RULES.FIRST_OPTION });
  });

  test("3. the only option, with a resembling name", () => {
    expect(chooseCompanyOption("Moriyama US", ["Moriyama - Umbraco Platinum Partner UK/US"])).toMatchObject({
      index: 0,
      rule: MATCH_RULES.SINGLE_OPTION,
    });
  });
});

describe("chooseCompanyOption: no automatic choice", () => {
  test("empty list", () => {
    expect(chooseCompanyOption("Acme", [])).toEqual({ index: -1, reason: "the dropdown list is empty" });
  });

  test("LinkedIn's unrelated suggestions", () => {
    const result = chooseCompanyOption("Sogeti", ["Stealth Startup", "Upwork", "Fiverr", "Accenture"]);
    expect(result.index).toBe(-1);
    expect(result.reason).toMatch(/resembles/);
    expect(chooseCompanyOption("Acme", ["Globex"]).index).toBe(-1);
  });

  test("the option with the same name isn't first", () => {
    expect(chooseCompanyOption("Calico", ["Calico AI", "Calico Energy", "Calico"])).toEqual({
      index: -1,
      reason: "the option with the same name (#3) isn't first in the list",
    });
  });

  test("nothing with the same name", () => {
    expect(chooseCompanyOption("Acme", ["Acme Labs", "Acmeson"])).toEqual({
      index: -1,
      reason: "none of the 2 options has the same name",
    });
  });
});

describe("nameKey / resemblesName", () => {
  test("nameKey drops case, legal form, punctuation and spaces", () => {
    expect(nameKey("Factory 73 Ltd")).toBe("factory73");
    expect(nameKey("envnt.")).toBe("envnt");
    expect(nameKey("Bitlab Digital Sdn Bhd")).toBe("bitlabdigital");
    expect(nameKey("Ørskov Gruppen")).toBe(nameKey("Ørskovgruppen"));
  });

  test("resemblesName: a word starting with the first typed word, or a key prefix", () => {
    expect(resemblesName("Granite Digital", "GRANITE - Global Digital Agency")).toBe(true);
    expect(resemblesName("Factory 73 Ltd", "Factory73")).toBe(true);
    expect(resemblesName("Ørskov Gruppen", "Ørskovgruppen")).toBe(true);
    expect(resemblesName("TSD", "Stealth AI Startup")).toBe(false);
    expect(resemblesName("Oxygen", "Deloitte")).toBe(false);
  });
});

describe("stripLegalForm", () => {
  test.each([
    ["Acme GmbH", "acme"],
    ["Acme GmbH & Co. KG", "acme"],
    ["Acme, Inc.", "acme"],
    ["Acme Sp. z o.o.", "acme"],
    ["Acme Pty Ltd", "acme"],
    ["Acme Sdn Bhd", "acme"],
    ["ТОВ «Акме»", "акме"],
    ["Acme Software", "acme software"],
    ["GmbH", "gmbh"],
  ])("%s → %s", (name, expected) => {
    expect(stripLegalForm(name)).toBe(expected);
  });
});
