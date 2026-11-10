import { localLeadGeneratorIds, withLocalIds } from "../src/utils/local-settings.js";

describe("localLeadGeneratorIds", () => {
  test("takes the listed ids, trimmed", () => {
    expect(localLeadGeneratorIds({ leadGeneratorIds: [" abcdefghijklmnopabcdefghijklmnop "] })).toEqual([
      "abcdefghijklmnopabcdefghijklmnop",
    ]);
  });

  test("skips empty and non-string entries", () => {
    expect(localLeadGeneratorIds({ leadGeneratorIds: ["", "  ", 5, null, "a@b.com"] })).toEqual(["a@b.com"]);
  });

  test("gives [] without settings or the list", () => {
    expect(localLeadGeneratorIds(null)).toEqual([]);
    expect(localLeadGeneratorIds({})).toEqual([]);
    expect(localLeadGeneratorIds({ leadGeneratorIds: "abcdefghijklmnopabcdefghijklmnop" })).toEqual([]);
  });
});

describe("withLocalIds", () => {
  test("puts the local ids first, without repeats", () => {
    expect(withLocalIds(["store", "firefox"], ["local", "store"])).toEqual(["local", "store", "firefox"]);
  });

  test("keeps the known ids when there are no local ones", () => {
    expect(withLocalIds(["store", "firefox"], [])).toEqual(["store", "firefox"]);
  });
});
