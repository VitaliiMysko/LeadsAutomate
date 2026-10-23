import { shorterNameVariants } from "../src/utils/name-variants.js";

describe("shorterNameVariants", () => {
  test.each([
    ["LAIT ApS", ["LAIT"]],
    ["MCB A/S", ["MCB"]],
    ["Infocaster B.V.", ["Infocaster"]],
    ["Bitlab Digital Sdn Bhd", ["Bitlab Digital"]],
    ["Acme, Inc.", ["Acme"]],
    ["Knowit Denmark", ["Knowit"]],
    ["AKQA DK", ["AKQA"]],
    ["True Digital (US)", ["True Digital"]],
    ["Cantarus US", ["Cantarus"]],
    ["Codiance - Coded Brilliance", ["Codiance"]],
    ["ilionx, experts in eenvoud", ["ilionx"]],
    ["Conclusion Experience (1)", ["Conclusion Experience"]],
    ["IDHL Group", ["IDHL"]],
  ])("%s → %j", (name, expected) => {
    expect(shorterNameVariants(name)).toEqual(expected);
  });

  test("steps add up, most complete first", () => {
    expect(shorterNameVariants("itm8 Sverige AB")).toEqual(["itm8 Sverige", "itm8"]);
    expect(shorterNameVariants("Acme Group UK Ltd")).toEqual(["Acme Group UK", "Acme Group", "Acme"]);
  });

  test("the typed case is kept", () => {
    expect(shorterNameVariants("NoA Ignite Denmark")).toEqual(["NoA Ignite"]);
  });

  test("nothing to shorten", () => {
    expect(shorterNameVariants("Acme")).toEqual([]);
    expect(shorterNameVariants("Cyber-Solutions")).toEqual([]);
    expect(shorterNameVariants("Bluegrass Digital")).toEqual([]);
  });

  test("a leading 'The' and the words of a name are left alone", () => {
    expect(shorterNameVariants("The Cambridge Agency Group")).toEqual(["The Cambridge Agency"]);
    expect(shorterNameVariants("Group")).toEqual([]);
    expect(shorterNameVariants("US")).toEqual([]);
  });
});
