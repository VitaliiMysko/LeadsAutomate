import { idsForThisBrowser } from "../src/utils/extension-ids.js";

const IDS = ["negmangnhbhanhajjpcjgecieghmdldm", "lead-generator@future-processing.com", "abcdefghijklmnopabcdefghijklmnop"];

describe("idsForThisBrowser", () => {
  test("keeps Chrome ids, in order, in Chrome", () => {
    expect(idsForThisBrowser("ofbkinmakmfacepccjcbmjgecdppolki", IDS)).toEqual([
      "negmangnhbhanhajjpcjgecieghmdldm",
      "abcdefghijklmnopabcdefghijklmnop",
    ]);
  });

  test("keeps add-on ids in Firefox", () => {
    expect(idsForThisBrowser("leads-automate@future-processing.com", IDS)).toEqual([
      "lead-generator@future-processing.com",
    ]);
  });

  test("Firefox's internal UUID-style ids aren't taken for Chrome ids", () => {
    expect(idsForThisBrowser("{0f1e2d3c-aaaa-bbbb-cccc-000000000000}", IDS)).toEqual([
      "lead-generator@future-processing.com",
    ]);
  });
});
