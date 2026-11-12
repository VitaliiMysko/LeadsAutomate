import {
  scheduleRecheck,
  removeRecheck,
  findRecheck,
  dueRecheck,
  nextRecheckAt,
  recheckCountdown,
  parseRechecks,
} from "../src/utils/recheck-queue.js";

const MIN5 = 5 * 60 * 1000;

describe("scheduleRecheck / removeRecheck / findRecheck", () => {
  test("adds the company due after the delay", () => {
    expect(scheduleRecheck([], "Acme", 1000, MIN5)).toEqual([
      { name: "Acme", dueAt: 1000 + MIN5 },
    ]);
    expect(scheduleRecheck([], "Acme", 0, 10)).toEqual([{ name: "Acme", dueAt: 10 }]);
  });

  test("replaces the entry of the same company (same name ignoring case)", () => {
    const list = scheduleRecheck([], "Acme", 0, 10);
    expect(scheduleRecheck(list, "ACME", 100, 10)).toEqual([{ name: "ACME", dueAt: 110 }]);
  });

  test("each company keeps its own time", () => {
    let list = scheduleRecheck([], "A", 0, MIN5);
    list = scheduleRecheck(list, "B", 60000, MIN5);
    expect(list.map((item) => item.dueAt)).toEqual([MIN5, 60000 + MIN5]);
  });

  test("removes and finds by name", () => {
    const list = scheduleRecheck(scheduleRecheck([], "A", 0, 1), "B", 0, 1);
    expect(removeRecheck(list, "a").map((item) => item.name)).toEqual(["B"]);
    expect(findRecheck(list, "b")?.name).toBe("B");
    expect(findRecheck(list, "C")).toBeNull();
  });
});

describe("dueRecheck / nextRecheckAt", () => {
  const list = [
    { name: "Late", dueAt: 300 },
    { name: "Early", dueAt: 100 },
    { name: "Mid", dueAt: 200 },
  ];

  test("none is due before its time", () => {
    expect(dueRecheck(list, 99)).toBeNull();
    expect(dueRecheck([], 1e15)).toBeNull();
  });

  test("the one due first among the due ones", () => {
    expect(dueRecheck(list, 100).name).toBe("Early");
    expect(dueRecheck(list, 250).name).toBe("Early");
    expect(dueRecheck(list.slice(0, 1).concat(list[2]), 250).name).toBe("Mid");
  });

  test("the earliest time, or null", () => {
    expect(nextRecheckAt(list)).toBe(100);
    expect(nextRecheckAt([])).toBeNull();
  });
});

describe("recheckCountdown", () => {
  test("minutes and seconds left, rounded up", () => {
    expect(recheckCountdown(MIN5, 0)).toBe("5:00");
    expect(recheckCountdown(65500, 0)).toBe("1:06");
    expect(recheckCountdown(1, 0)).toBe("0:01");
  });

  test("due once the time is reached", () => {
    expect(recheckCountdown(100, 100)).toBe("due");
    expect(recheckCountdown(100, 500)).toBe("due");
  });
});

describe("parseRechecks", () => {
  test("keeps well-formed entries only", () => {
    expect(
      parseRechecks([
        { name: "A", dueAt: 5 },
        { name: "B", dueAt: 6 },
        { name: "C", dueAt: "x" },
        { dueAt: 1 },
        null,
      ])
    ).toEqual([
      { name: "A", dueAt: 5 },
      { name: "B", dueAt: 6 },
    ]);
    expect(parseRechecks(undefined)).toEqual([]);
  });
});
