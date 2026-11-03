import { localDateKey, foundToday, addFound, dailyLimitReached } from "../src/utils/daily-limit.js";

describe("localDateKey", () => {
  test("formats the local day with zero padding", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDateKey(new Date(2026, 10, 2, 0, 0))).toBe("2026-11-02");
  });
});

describe("foundToday / addFound", () => {
  test("counts only the current day", () => {
    expect(foundToday({ date: "2026-11-02", saved: 7 }, "2026-11-02")).toBe(7);
    expect(foundToday({ date: "2026-11-01", saved: 7 }, "2026-11-02")).toBe(0);
    expect(foundToday(null, "2026-11-02")).toBe(0);
    expect(foundToday({ date: "2026-11-02", saved: "x" }, "2026-11-02")).toBe(0);
  });

  test("adds to today's count and starts over on a new day", () => {
    expect(addFound({ date: "2026-11-02", saved: 3 }, "2026-11-02")).toEqual({ date: "2026-11-02", saved: 4 });
    expect(addFound({ date: "2026-11-01", saved: 30 }, "2026-11-02")).toEqual({ date: "2026-11-02", saved: 1 });
    expect(addFound(null, "2026-11-02", 0)).toEqual({ date: "2026-11-02", saved: 0 });
  });
});

describe("dailyLimitReached", () => {
  const today = "2026-11-02";

  test("reached at the limit, only when it's on", () => {
    expect(dailyLimitReached({ date: today, saved: 50 }, { enabled: true, value: 50 }, today)).toBe(true);
    expect(dailyLimitReached({ date: today, saved: 49 }, { enabled: true, value: 50 }, today)).toBe(false);
    expect(dailyLimitReached({ date: today, saved: 99 }, { enabled: false, value: 50 }, today)).toBe(false);
  });

  test("a count from another day doesn't reach it", () => {
    expect(dailyLimitReached({ date: "2026-11-01", saved: 99 }, { enabled: true, value: 50 }, today)).toBe(false);
  });
});
