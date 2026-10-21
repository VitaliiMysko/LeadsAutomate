import { createMatchRecord, appendCapped } from "../src/utils/match-records.js";

const date = new Date("2026-10-21T10:00:00.000Z");

describe("createMatchRecord", () => {
  test("auto record keeps the rule, omits the reason", () => {
    expect(createMatchRecord({ typed: "Acme", chosen: "Acme GmbH", rule: "legal-form", options: ["Acme GmbH", "X"] }, date)).toEqual({
      time: "2026-10-21T10:00:00.000Z",
      typed: "Acme",
      chosen: "Acme GmbH",
      rule: "legal-form",
      options: ["Acme GmbH", "X"],
    });
  });

  test("manual record keeps why the automatic choice failed", () => {
    const record = createMatchRecord({ typed: "Acme", chosen: "Acme Labs", reason: "none matches", options: [] }, date);
    expect(record).not.toHaveProperty("rule");
    expect(record.reason).toBe("none matches");
  });
});

describe("appendCapped", () => {
  test("drops the oldest records beyond the limit", () => {
    expect(appendCapped([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
    expect(appendCapped([1], 2, 3)).toEqual([1, 2]);
  });
});
