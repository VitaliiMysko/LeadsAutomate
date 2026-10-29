import {
  createEmptyBoard,
  sanitizeBoard,
  getPool,
  moveTitle,
  moveTitleToGroup,
  moveGroup,
  groupWithAbove,
  ungroup,
  setEntryCount,
  renameGroup,
  findColumn,
  findGroup,
  columnTitles,
  isManualTitle,
  addTitle,
  clampCount,
  getColumnPlan,
  hasJobTitles,
  boardToFile,
  boardFromFile,
  POOL,
} from "../src/utils/priority-board.js";

const single = (title, count = 1) => ({ title, count });

const board = {
  management: [single("CEO"), single("CTO", 2)],
  technical: [single("Architect")],
  manual: [],
};

// Management: CEO, [Founder, Gründer] (3 leads), CTO
const grouped = {
  management: [single("CEO"), { id: "g1", name: "Founders", titles: ["Founder", "Gründer"], count: 3 }, single("CTO")],
  technical: [{ id: "g2", name: "", titles: ["QA"], count: 1 }],
  manual: ["Gründer"],
};

describe("getPool", () => {
  test("lists filter titles not placed in any column, in filter order", () => {
    expect(getPool(board, ["Developer", "CTO", "Architect", "QA"])).toEqual(["Developer", "QA"]);
  });

  test("titles inside groups count as placed", () => {
    expect(getPool(grouped, ["Founder", "QA", "Developer"])).toEqual(["Developer"]);
  });
});

describe("moveTitle", () => {
  test("adds a pool title at the given index with the default count", () => {
    expect(moveTitle(board, "VP", "management", 1).management).toEqual([single("CEO"), single("VP"), single("CTO", 2)]);
  });

  test("appends when no index is given and clamps out-of-range indexes", () => {
    expect(columnTitles(moveTitle(board, "VP", "technical"), "technical")).toEqual(["Architect", "VP"]);
    expect(columnTitles(moveTitle(board, "VP", "technical", 99), "technical")).toEqual(["Architect", "VP"]);
    expect(columnTitles(moveTitle(board, "VP", "technical", -3), "technical")).toEqual(["VP", "Architect"]);
  });

  test("reorders within a column and keeps the title's count", () => {
    expect(moveTitle(board, "CTO", "management", 0).management).toEqual([single("CTO", 2), single("CEO")]);
  });

  test("moves between columns", () => {
    const next = moveTitle(board, "CTO", "technical", 0);
    expect(next).toEqual({ management: [single("CEO")], technical: [single("CTO", 2), single("Architect")], manual: [] });
  });

  test("returns a title to the pool", () => {
    expect(moveTitle(board, "CEO", POOL)).toEqual({
      management: [single("CTO", 2)],
      technical: [single("Architect")],
      manual: [],
    });
  });

  test("takes a title out of a group as a single title with the default count", () => {
    const next = moveTitle(grouped, "Founder", "management", 3);
    expect(next.management[1].titles).toEqual(["Gründer"]);
    expect(next.management[3]).toEqual(single("Founder"));
  });

  test("removes a group left empty and shifts the drop index past it", () => {
    // Technical shows [QA group]; dropping its only title below it (index 1).
    const next = moveTitle(grouped, "QA", "technical", 1);
    expect(next.technical).toEqual([single("QA")]);
  });

  test("does not mutate the input board", () => {
    const before = JSON.parse(JSON.stringify(grouped));
    moveTitle(grouped, "Founder", "technical", 0);
    moveTitle(grouped, "CEO", POOL);
    expect(grouped).toEqual(before);
  });

  test("rejects unknown columns", () => {
    expect(() => moveTitle(board, "CEO", "sales")).toThrow();
  });
});

describe("groups", () => {
  test("groupWithAbove turns a single title above into a group that keeps its count", () => {
    const next = groupWithAbove(board, "management", 1);
    expect(next.management).toEqual([{ id: "g1", name: "", titles: ["CEO", "CTO"], count: 1 }]);
  });

  test("groupWithAbove adds the titles to a group above, and joins two groups", () => {
    expect(groupWithAbove(grouped, "management", 2).management[1].titles).toEqual(["Founder", "Gründer", "CTO"]);
    const twoGroups = moveGroup(grouped, "g2", "management", 2);
    expect(groupWithAbove(twoGroups, "management", 2).management[1]).toEqual({
      id: "g1",
      name: "Founders",
      titles: ["Founder", "Gründer", "QA"],
      count: 3,
    });
  });

  test("groupWithAbove ignores the first entry and gives new groups unused ids", () => {
    expect(groupWithAbove(board, "management", 0)).toBe(board);
    expect(groupWithAbove(grouped, "management", 1).management[0].id).toBe("g3");
  });

  test("moveTitleToGroup inserts or reorders inside a group", () => {
    expect(findGroup(moveTitleToGroup(grouped, "CEO", "g1", 0), "g1").group.titles).toEqual(["CEO", "Founder", "Gründer"]);
    expect(moveTitleToGroup(grouped, "CEO", "g1", 0).management).toHaveLength(2);
    expect(findGroup(moveTitleToGroup(grouped, "Gründer", "g1", 0), "g1").group.titles).toEqual(["Gründer", "Founder"]);
    expect(findGroup(moveTitleToGroup(grouped, "Architect", "g2"), "g2").group.titles).toEqual(["QA", "Architect"]);
  });

  test("moveTitleToGroup leaves the board unchanged when the group disappears", () => {
    expect(moveTitleToGroup(grouped, "QA", "g2", 0)).toBe(grouped);
  });

  test("moveGroup moves a whole group between columns", () => {
    const next = moveGroup(grouped, "g1", "technical", 0);
    expect(columnTitles(next, "management")).toEqual(["CEO", "CTO"]);
    expect(next.technical[0]).toEqual(grouped.management[1]);
  });

  test("moveGroup to the pool returns its titles and drops the manual ones", () => {
    const next = moveGroup(grouped, "g1", POOL);
    expect(columnTitles(next, "management")).toEqual(["CEO", "CTO"]);
    expect(next.manual).toEqual([]);
    expect(getPool(next, ["Founder", "CEO"])).toEqual(["Founder"]);
  });

  test("ungroup splits a group into single titles in its place", () => {
    expect(ungroup(grouped, "g1").management).toEqual([single("CEO"), single("Founder"), single("Gründer"), single("CTO")]);
  });

  test("setEntryCount clamps the count of a title or group", () => {
    expect(setEntryCount(grouped, "management", 1, "7").management[1].count).toBe(7);
    expect(setEntryCount(grouped, "management", 0, "500").management[0].count).toBe(9);
    expect(setEntryCount(grouped, "management", 0, "abc").management[0].count).toBe(1);
    expect(setEntryCount(grouped, "management", 9, 3)).toBe(grouped);
  });

  test("renameGroup trims the name", () => {
    expect(findGroup(renameGroup(grouped, "g2", "  Quality   assurance "), "g2").group.name).toBe("Quality assurance");
  });
});

describe("sanitizeBoard", () => {
  test("converts the old format (plain title lists) to single titles with the default count", () => {
    expect(sanitizeBoard({ management: ["CEO", "CTO"], technical: ["QA"], manual: ["QA"] })).toEqual({
      management: [single("CEO"), single("CTO")],
      technical: [single("QA")],
      manual: ["QA"],
    });
  });

  test("drops non-strings, duplicates, empty groups and unknown keys", () => {
    const raw = {
      management: ["CEO", 5, single("CEO"), { id: "g1", titles: ["CEO", 3], count: 2 }],
      technical: [{ title: "QA", count: 4 }],
      other: ["x"],
    };
    expect(sanitizeBoard(raw)).toEqual({ management: [single("CEO")], technical: [single("QA", 4)], manual: [] });
    expect(sanitizeBoard(null)).toEqual(createEmptyBoard());
  });

  test("keeps groups, clamps counts and gives missing or repeated ids new ones", () => {
    const raw = {
      management: [{ id: "g1", name: 7, titles: ["Founder"], count: 300 }],
      technical: [
        { id: "g1", name: " QA ", titles: ["QA"], count: "2" },
        { titles: ["Tester"] },
      ],
    };
    expect(sanitizeBoard(raw)).toEqual({
      management: [{ id: "g1", name: "", titles: ["Founder"], count: 9 }],
      technical: [
        { id: "g2", name: "QA", titles: ["QA"], count: 2 },
        { id: "g3", name: "", titles: ["Tester"], count: 1 },
      ],
      manual: [],
    });
  });

  test("keeps only manual titles that are still in a column", () => {
    expect(
      sanitizeBoard({ management: ["CEO"], technical: [{ id: "g1", titles: ["Hand-made"], count: 1 }], manual: ["Hand-made", "Gone", 7] })
        .manual
    ).toEqual(["Hand-made"]);
  });
});

describe("addTitle", () => {
  const filterTitles = ["Chief Technology Officer", "Developer"];

  test("adds a new typed title at the end of the column and marks it manual", () => {
    const { board: next, title, outcome } = addTitle(board, "  Head   of  QA ", "technical", filterTitles);
    expect(outcome).toBe("added");
    expect(title).toBe("Head of QA");
    expect(next.technical).toEqual([single("Architect"), single("Head of QA")]);
    expect(isManualTitle(next, "Head of QA")).toBe(true);
  });

  test("takes a filter title with the filter's spelling, not as manual", () => {
    const { board: next, title, outcome } = addTitle(board, "chief technology officer", "management", filterTitles);
    expect(outcome).toBe("placed");
    expect(title).toBe("Chief Technology Officer");
    expect(columnTitles(next, "management")).toEqual(["CEO", "CTO", "Chief Technology Officer"]);
    expect(next.manual).toEqual([]);
  });

  test("moves a title already in the other column, also out of a group", () => {
    const { board: next, outcome } = addTitle(board, "architect", "management", filterTitles);
    expect(outcome).toBe("moved");
    expect(next).toEqual({ management: [single("CEO"), single("CTO", 2), single("Architect")], technical: [], manual: [] });

    const fromGroup = addTitle(grouped, "qa", "management");
    expect(fromGroup.outcome).toBe("moved");
    expect(fromGroup.board.technical).toEqual([]);
  });

  test("leaves the board unchanged for a title already in the column (also in a group) or empty input", () => {
    expect(addTitle(board, "cto", "management").outcome).toBe("exists");
    expect(addTitle(board, "cto", "management").board).toBe(board);
    expect(addTitle(grouped, "GRÜNDER", "management").outcome).toBe("exists");
    expect(addTitle(board, "   ", "management").outcome).toBe("empty");
  });

  test("a manual title moved between columns stays manual; sent to the pool it's dropped", () => {
    const { board: withManual } = addTitle(board, "Head of QA", "technical");
    const moved = moveTitle(withManual, "Head of QA", "management", 0);
    expect(moved.management[0]).toEqual(single("Head of QA"));
    expect(isManualTitle(moved, "Head of QA")).toBe(true);

    const removed = moveTitle(moved, "Head of QA", POOL);
    expect(findColumn(removed, "Head of QA")).toBeNull();
    expect(removed.manual).toEqual([]);
    expect(getPool(removed, filterTitles)).not.toContain("Head of QA");
  });

  test("rejects unknown columns", () => {
    expect(() => addTitle(board, "QA", "sales")).toThrow();
  });
});

describe("findColumn / clampCount / getColumnPlan", () => {
  test("finds a title's column, also inside a group", () => {
    expect(findColumn(board, "Architect")).toBe("technical");
    expect(findColumn(grouped, "Gründer")).toBe("management");
    expect(findColumn(board, "QA")).toBeNull();
  });

  test("clamps to the limits and falls back to the default", () => {
    const limits = { min: 0, max: 10, default: 1 };
    expect(clampCount("4", limits)).toBe(4);
    expect(clampCount(-2, limits)).toBe(0);
    expect(clampCount(99, limits)).toBe(10);
    expect(clampCount("", limits)).toBe(1);
  });

  test("lists the entries by priority with their titles and counts", () => {
    const withUnnamed = groupWithAbove(grouped, "management", 1);
    expect(getColumnPlan(grouped, "management")).toEqual([
      { name: "CEO", titles: ["CEO"], count: 1 },
      { name: "Founders", titles: ["Founder", "Gründer"], count: 3 },
      { name: "CTO", titles: ["CTO"], count: 1 },
    ]);
    expect(getColumnPlan(withUnnamed, "management")[0]).toEqual({
      name: "CEO / Founder / Gründer",
      titles: ["CEO", "Founder", "Gründer"],
      count: 1,
    });
  });
});

describe("hasJobTitles", () => {
  test("is false only when both columns are empty", () => {
    expect(hasJobTitles(createEmptyBoard())).toBe(false);
    expect(hasJobTitles({ management: [], technical: [single("QA")], manual: [] })).toBe(true);
    expect(hasJobTitles({ management: [{ id: "g1", name: "", titles: ["CEO"], count: 1 }], technical: [], manual: [] })).toBe(true);
  });
});

describe("boardToFile / boardFromFile", () => {
  const limits = { min: 0, max: 9, default: 1 };

  test("a saved board loads back the same, with the columns' lead counts", () => {
    const text = JSON.stringify(boardToFile(grouped, { management: 3, technical: 0 }));
    expect(boardFromFile(text, limits)).toEqual({ board: grouped, leadsCount: { management: 3, technical: 0 } });
  });

  test("cleans the loaded board and counts", () => {
    const file = {
      format: "leads-automate-job-titles",
      version: 1,
      leadsCount: { management: 50 },
      management: ["CEO", { titles: ["Founder", "CEO"], count: 20 }],
      manual: ["Founder", "Gone"],
    };
    expect(boardFromFile(JSON.stringify(file), limits)).toEqual({
      board: {
        management: [single("CEO"), { id: "g1", name: "", titles: ["Founder"], count: 9 }],
        technical: [],
        manual: ["Founder"],
      },
      leadsCount: { management: 9, technical: 1 },
    });
  });

  test("rejects other files", () => {
    expect(() => boardFromFile("CEO, CTO")).toThrow("not a JSON file");
    expect(() => boardFromFile(JSON.stringify({ auto: [], manual: [] }))).toThrow("not a job titles file");
    expect(() => boardFromFile(JSON.stringify({ format: "leads-automate-job-titles", version: 2 }))).toThrow(
      "unsupported file version 2"
    );
  });
});
