import { createMatchRecord, appendCapped, companyIdFromUrn } from "../src/utils/match-records.js";

const date = new Date("2026-10-21T10:00:00.000Z");

describe("createMatchRecord", () => {
  test("auto record keeps the company id and rule, omits the reason", () => {
    expect(
      createMatchRecord(
        { typed: "Acme", chosen: "Acme GmbH", companyId: "2781504", rule: "legal-form", options: ["Acme GmbH", "X"] },
        date
      )
    ).toEqual({
      time: "2026-10-21T10:00:00.000Z",
      typed: "Acme",
      chosen: "Acme GmbH",
      companyId: "2781504",
      rule: "legal-form",
      options: ["Acme GmbH", "X"],
    });
  });

  test("manual record keeps why the automatic choice failed", () => {
    const record = createMatchRecord({ typed: "Acme", chosen: "Acme Labs", reason: "none matches", options: [] }, date);
    expect(record).not.toHaveProperty("rule");
    expect(record.reason).toBe("none matches");
  });

  test("company id is null when unknown", () => {
    expect(createMatchRecord({ typed: "A", chosen: "A", options: [] }, date).companyId).toBeNull();
  });
});

describe("companyIdFromUrn", () => {
  test.each([
    ["urn:li:organization:2781504", "2781504"],
    ["urn:li:company:200346", "200346"],
    ["98943645", "98943645"],
    [null, null],
    ["", null],
  ])("%p → %p", (urn, expected) => {
    expect(companyIdFromUrn(urn)).toBe(expected);
  });
});

describe("appendCapped", () => {
  test("drops the oldest records beyond the limit", () => {
    expect(appendCapped([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
    expect(appendCapped([1], 2, 3)).toEqual([1, 2]);
  });
});
