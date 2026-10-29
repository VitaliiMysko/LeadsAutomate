import { createMatchRecord, appendCapped, companyIdFromUrn, MATCH_MODES } from "../src/utils/match-records.js";

const date = new Date("2026-10-21T10:00:00.000Z");
const options = [
  { index: 0, label: "Ecreo" },
  { index: 1, label: "eCreo" },
];

describe("createMatchRecord", () => {
  test("labeling record: chosen position and whether the prediction was right", () => {
    const record = createMatchRecord(
      {
        mode: MATCH_MODES.LABELING,
        typed: "eCreo",
        chosen: "eCreo",
        companyId: "2389174",
        options,
        prediction: { index: 0, label: "Ecreo", rule: "exact" },
        csv: { companyId: "2389174", linkedin: null, hasLogo: true },
        leads: 4,
        pickMs: 5200,
      },
      date
    );
    expect(record).toEqual({
      time: "2026-10-21T10:00:00.000Z",
      mode: "labeling",
      name: "eCreo",
      typed: "eCreo",
      attempts: [],
      chosen: "eCreo",
      companyId: "2389174",
      chosenIndex: 1,
      chosenInList: true,
      prediction: { index: 0, label: "Ecreo", rule: "exact" },
      predictionCorrect: false,
      pickMs: 5200,
      leads: 4,
      csv: { companyId: "2389174", linkedin: null, hasLogo: true },
      options,
    });
  });

  test("a company that wasn't among the options", () => {
    const record = createMatchRecord({ mode: MATCH_MODES.FALLBACK, typed: "X", chosen: "Other Co", options, prediction: { index: -1 } }, date);
    expect(record.chosenIndex).toBe(-1);
    expect(record.chosenInList).toBe(false);
    expect(record.predictionCorrect).toBe(true); // both "none of the options"
  });

  test("found under a shorter name: the file's name and the earlier attempts", () => {
    const attempts = [{ typed: "Ecreo ApS", options: 0, reason: "the dropdown list is empty" }];
    const record = createMatchRecord(
      { mode: MATCH_MODES.AUTO, name: "Ecreo ApS", typed: "Ecreo", attempts, chosen: "Ecreo", options, prediction: { index: 0 } },
      date
    );
    expect(record).toMatchObject({ name: "Ecreo ApS", typed: "Ecreo", attempts, chosenIndex: 0 });
  });

  test("auto record: no ground truth, no pick time", () => {
    const record = createMatchRecord(
      { mode: MATCH_MODES.AUTO, typed: "Ecreo", chosen: "Ecreo", options, prediction: { index: 0 }, pickMs: 10 },
      date
    );
    expect(record.predictionCorrect).toBeNull();
    expect(record.pickMs).toBeNull();
    expect(record.chosenIndex).toBe(0);
    expect(record.companyId).toBeNull();
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
