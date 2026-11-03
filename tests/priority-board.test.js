import {
  createEmptyBoard,
  sanitizeBoard,
  getColumn,
  getPool,
  moveTitle,
  moveTitleToGroup,
  moveGroup,
  groupWithAbove,
  ungroup,
  setEntryCount,
  renameGroup,
  addColumn,
  removeColumn,
  renameColumn,
  moveColumn,
  setColumnCount,
  setCompanyLimit,
  getCompanyLimit,
  findColumn,
  findGroup,
  columnTitles,
  isManualTitle,
  addTitle,
  clampCount,
  getColumnPlan,
  getBoardPlan,
  hasJobTitles,
  boardToFile,
  boardFromFile,
  POOL,
} from "../src/utils/priority-board.js";

const single = (title, count = 1) => ({ title, count });
const column = (id, name, entries, count = 1) => ({ id, name, count, entries });
const entriesOf = (board, id) => getColumn(board, id).entries;
const names = (board) => board.columns.map((item) => item.name);
const off = { enabled: false, value: 5 };

// Management (c1): CEO, CTO (2 leads); Technical (c2): Architect
const board = {
  columns: [column("c1", "Management", [single("CEO"), single("CTO", 2)]), column("c2", "Technical", [single("Architect")])],
  manual: [],
  companyLimit: off,
};

// Management: CEO, [Founder, Gründer] (3 leads), CTO; Technical: [QA]
const grouped = {
  columns: [
    column("c1", "Management", [single("CEO"), { id: "g1", name: "Founders", titles: ["Founder", "Gründer"], count: 3 }, single("CTO")]),
    column("c2", "Technical", [{ id: "g2", name: "", titles: ["QA"], count: 1 }]),
  ],
  manual: ["Gründer"],
  companyLimit: off,
};

describe("createEmptyBoard", () => {
  test("has empty Management and Technical columns", () => {
    expect(createEmptyBoard()).toEqual({
      columns: [column("c1", "Management", []), column("c2", "Technical", [])],
      manual: [],
      companyLimit: off,
    });
  });
});

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
    expect(entriesOf(moveTitle(board, "VP", "c1", 1), "c1")).toEqual([single("CEO"), single("VP"), single("CTO", 2)]);
  });

  test("appends when no index is given and clamps out-of-range indexes", () => {
    expect(columnTitles(moveTitle(board, "VP", "c2"), "c2")).toEqual(["Architect", "VP"]);
    expect(columnTitles(moveTitle(board, "VP", "c2", 99), "c2")).toEqual(["Architect", "VP"]);
    expect(columnTitles(moveTitle(board, "VP", "c2", -3), "c2")).toEqual(["VP", "Architect"]);
  });

  test("reorders within a column and keeps the title's count", () => {
    expect(entriesOf(moveTitle(board, "CTO", "c1", 0), "c1")).toEqual([single("CTO", 2), single("CEO")]);
  });

  test("moves between columns", () => {
    const next = moveTitle(board, "CTO", "c2", 0);
    expect(next).toEqual({
      columns: [column("c1", "Management", [single("CEO")]), column("c2", "Technical", [single("CTO", 2), single("Architect")])],
      manual: [],
      companyLimit: off,
    });
  });

  test("returns a title to the pool", () => {
    const next = moveTitle(board, "CEO", POOL);
    expect(entriesOf(next, "c1")).toEqual([single("CTO", 2)]);
    expect(entriesOf(next, "c2")).toEqual([single("Architect")]);
  });

  test("takes a title out of a group as a single title with the default count", () => {
    const next = moveTitle(grouped, "Founder", "c1", 3);
    expect(entriesOf(next, "c1")[1].titles).toEqual(["Gründer"]);
    expect(entriesOf(next, "c1")[3]).toEqual(single("Founder"));
  });

  test("removes a group left empty and shifts the drop index past it", () => {
    // Technical shows [QA group]; dropping its only title below it (index 1).
    expect(entriesOf(moveTitle(grouped, "QA", "c2", 1), "c2")).toEqual([single("QA")]);
  });

  test("does not mutate the input board", () => {
    const before = JSON.parse(JSON.stringify(grouped));
    moveTitle(grouped, "Founder", "c2", 0);
    moveTitle(grouped, "CEO", POOL);
    expect(grouped).toEqual(before);
  });

  test("rejects unknown columns", () => {
    expect(() => moveTitle(board, "CEO", "sales")).toThrow();
  });
});

describe("groups", () => {
  test("groupWithAbove turns a single title above into a group that keeps its count", () => {
    expect(entriesOf(groupWithAbove(board, "c1", 1), "c1")).toEqual([{ id: "g1", name: "", titles: ["CEO", "CTO"], count: 1 }]);
  });

  test("groupWithAbove adds the titles to a group above, and joins two groups", () => {
    expect(entriesOf(groupWithAbove(grouped, "c1", 2), "c1")[1].titles).toEqual(["Founder", "Gründer", "CTO"]);
    const twoGroups = moveGroup(grouped, "g2", "c1", 2);
    expect(entriesOf(groupWithAbove(twoGroups, "c1", 2), "c1")[1]).toEqual({
      id: "g1",
      name: "Founders",
      titles: ["Founder", "Gründer", "QA"],
      count: 3,
    });
  });

  test("groupWithAbove ignores the first entry and gives new groups unused ids", () => {
    expect(groupWithAbove(board, "c1", 0)).toBe(board);
    expect(entriesOf(groupWithAbove(grouped, "c1", 1), "c1")[0].id).toBe("g3");
  });

  test("moveTitleToGroup inserts or reorders inside a group", () => {
    expect(findGroup(moveTitleToGroup(grouped, "CEO", "g1", 0), "g1").group.titles).toEqual(["CEO", "Founder", "Gründer"]);
    expect(entriesOf(moveTitleToGroup(grouped, "CEO", "g1", 0), "c1")).toHaveLength(2);
    expect(findGroup(moveTitleToGroup(grouped, "Gründer", "g1", 0), "g1").group.titles).toEqual(["Gründer", "Founder"]);
    expect(findGroup(moveTitleToGroup(grouped, "Architect", "g2"), "g2").group.titles).toEqual(["QA", "Architect"]);
  });

  test("moveTitleToGroup leaves the board unchanged when the group disappears", () => {
    expect(moveTitleToGroup(grouped, "QA", "g2", 0)).toBe(grouped);
  });

  test("moveGroup moves a whole group between columns", () => {
    const next = moveGroup(grouped, "g1", "c2", 0);
    expect(columnTitles(next, "c1")).toEqual(["CEO", "CTO"]);
    expect(entriesOf(next, "c2")[0]).toEqual(entriesOf(grouped, "c1")[1]);
  });

  test("moveGroup to the pool returns its titles and drops the manual ones", () => {
    const next = moveGroup(grouped, "g1", POOL);
    expect(columnTitles(next, "c1")).toEqual(["CEO", "CTO"]);
    expect(next.manual).toEqual([]);
    expect(getPool(next, ["Founder", "CEO"])).toEqual(["Founder"]);
  });

  test("ungroup splits a group into single titles in its place", () => {
    expect(entriesOf(ungroup(grouped, "g1"), "c1")).toEqual([single("CEO"), single("Founder"), single("Gründer"), single("CTO")]);
  });

  test("setEntryCount clamps the count of a title or group", () => {
    expect(entriesOf(setEntryCount(grouped, "c1", 1, "7"), "c1")[1].count).toBe(7);
    expect(entriesOf(setEntryCount(grouped, "c1", 0, "500"), "c1")[0].count).toBe(9);
    expect(entriesOf(setEntryCount(grouped, "c1", 0, "abc"), "c1")[0].count).toBe(1);
    expect(setEntryCount(grouped, "c1", 9, 3)).toBe(grouped);
    expect(setEntryCount(grouped, "c9", 0, 3)).toBe(grouped);
  });

  test("renameGroup trims the name", () => {
    expect(findGroup(renameGroup(grouped, "g2", "  Quality   assurance "), "g2").group.name).toBe("Quality assurance");
  });
});

describe("columns", () => {
  test("addColumn adds an empty column at the end with an unused id and the default count", () => {
    const { board: next, id } = addColumn(board, "  Sales  ops ");
    expect(id).toBe("c3");
    expect(next.columns[2]).toEqual(column("c3", "Sales ops", []));
    expect(names(addColumn(next, "").board)).toEqual(["Management", "Technical", "Sales ops", "Column 4"]);
    expect(board.columns).toHaveLength(2);
  });

  test("addColumn ids don't repeat after a removal", () => {
    const three = addColumn(board, "HR").board;
    expect(addColumn(removeColumn(three, "c1"), "Ops").id).toBe("c4");
  });

  test("removeColumn sends the column's titles back to the pool and drops its manual ones", () => {
    const next = removeColumn(grouped, "c1");
    expect(names(next)).toEqual(["Technical"]);
    expect(next.manual).toEqual([]);
    expect(getPool(next, ["CEO", "Founder", "QA"])).toEqual(["CEO", "Founder"]);
  });

  test("removeColumn keeps the last column and ignores unknown ids", () => {
    const one = removeColumn(board, "c2");
    expect(removeColumn(one, "c1")).toBe(one);
    expect(removeColumn(board, "c9")).toBe(board);
  });

  test("renameColumn trims the name and ignores an empty one", () => {
    expect(getColumn(renameColumn(board, "c2", "  Engineering   leads "), "c2").name).toBe("Engineering leads");
    expect(renameColumn(board, "c2", "   ")).toBe(board);
    expect(renameColumn(board, "c9", "HR")).toBe(board);
  });

  test("moveColumn reorders the columns, clamping the index", () => {
    const three = addColumn(board, "HR").board;
    expect(names(moveColumn(three, "c3", 0))).toEqual(["HR", "Management", "Technical"]);
    expect(names(moveColumn(three, "c1", 1))).toEqual(["Technical", "Management", "HR"]);
    expect(names(moveColumn(three, "c1", 99))).toEqual(["Technical", "HR", "Management"]);
    expect(names(moveColumn(three, "c3", -1))).toEqual(["HR", "Management", "Technical"]);
    expect(moveColumn(three, "c9", 0)).toBe(three);
  });

  test("setColumnCount clamps the column's lead count", () => {
    expect(getColumn(setColumnCount(board, "c1", "4"), "c1").count).toBe(4);
    expect(getColumn(setColumnCount(board, "c1", 50), "c1").count).toBe(9);
    expect(setColumnCount(board, "c9", 2)).toBe(board);
  });

  test("titles move to and from an added column", () => {
    const { board: withHr, id } = addColumn(board, "HR");
    const next = moveTitle(withHr, "CEO", id, 0);
    expect(columnTitles(next, id)).toEqual(["CEO"]);
    expect(findColumn(next, "CEO")).toBe(id);
  });
});

describe("sanitizeBoard", () => {
  test("converts the oldest format (plain title lists) to single titles with the default count", () => {
    expect(sanitizeBoard({ management: ["CEO", "CTO"], technical: ["QA"], manual: ["QA"] })).toEqual({
      columns: [column("c1", "Management", [single("CEO"), single("CTO")]), column("c2", "Technical", [single("QA")])],
      manual: ["QA"],
      companyLimit: off,
    });
  });

  test("converts the fixed Management / Technical format, with the lead counts kept apart", () => {
    const old = { management: [single("CEO", 3)], technical: [], manual: [], leadsCount: { management: 2, technical: 0 } };
    expect(sanitizeBoard(old)).toEqual({
      columns: [column("c1", "Management", [single("CEO", 3)], 2), column("c2", "Technical", [], 0)],
      manual: [],
      companyLimit: off,
    });
  });

  test("drops non-strings, duplicates, empty groups and unknown keys", () => {
    const raw = {
      columns: [
        column("c1", "Management", ["CEO", 5, single("CEO"), { id: "g1", titles: ["CEO", 3], count: 2 }]),
        column("c2", "Technical", [{ title: "QA", count: 4 }]),
        "not a column",
      ],
      other: ["x"],
    };
    expect(sanitizeBoard(raw)).toEqual({
      columns: [column("c1", "Management", [single("CEO")]), column("c2", "Technical", [single("QA", 4)])],
      manual: [],
      companyLimit: off,
    });
    expect(sanitizeBoard(null)).toEqual(createEmptyBoard());
    expect(sanitizeBoard({ columns: [] })).toEqual(createEmptyBoard());
  });

  test("names unnamed columns by position, clamps their counts and gives missing or repeated ids new ones", () => {
    const raw = {
      columns: [
        { id: "c2", name: "  Sales ", count: 40, entries: [] },
        { id: "c2", name: "", count: "3" },
        { name: 7, entries: ["CEO"] },
      ],
    };
    expect(sanitizeBoard(raw)).toEqual({
      columns: [column("c2", "Sales", [], 9), column("c3", "Column 2", [], 3), column("c4", "Column 3", [single("CEO")])],
      manual: [],
      companyLimit: off,
    });
  });

  test("keeps groups, clamps counts and gives missing or repeated ids new ones", () => {
    const raw = {
      columns: [
        column("c1", "Management", [{ id: "g1", name: 7, titles: ["Founder"], count: 300 }]),
        column("c2", "Technical", [{ id: "g1", name: " QA ", titles: ["QA"], count: "2" }, { titles: ["Tester"] }]),
      ],
    };
    expect(sanitizeBoard(raw)).toEqual({
      columns: [
        column("c1", "Management", [{ id: "g1", name: "", titles: ["Founder"], count: 9 }]),
        column("c2", "Technical", [
          { id: "g2", name: "QA", titles: ["QA"], count: 2 },
          { id: "g3", name: "", titles: ["Tester"], count: 1 },
        ]),
      ],
      manual: [],
      companyLimit: off,
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
    const { board: next, title, outcome } = addTitle(board, "  Head   of  QA ", "c2", filterTitles);
    expect(outcome).toBe("added");
    expect(title).toBe("Head of QA");
    expect(entriesOf(next, "c2")).toEqual([single("Architect"), single("Head of QA")]);
    expect(isManualTitle(next, "Head of QA")).toBe(true);
  });

  test("takes a filter title with the filter's spelling, not as manual", () => {
    const { board: next, title, outcome } = addTitle(board, "chief technology officer", "c1", filterTitles);
    expect(outcome).toBe("placed");
    expect(title).toBe("Chief Technology Officer");
    expect(columnTitles(next, "c1")).toEqual(["CEO", "CTO", "Chief Technology Officer"]);
    expect(next.manual).toEqual([]);
  });

  test("moves a title already in another column, also out of a group", () => {
    const { board: next, outcome } = addTitle(board, "architect", "c1", filterTitles);
    expect(outcome).toBe("moved");
    expect(entriesOf(next, "c1")).toEqual([single("CEO"), single("CTO", 2), single("Architect")]);
    expect(entriesOf(next, "c2")).toEqual([]);

    const fromGroup = addTitle(grouped, "qa", "c1");
    expect(fromGroup.outcome).toBe("moved");
    expect(entriesOf(fromGroup.board, "c2")).toEqual([]);
  });

  test("leaves the board unchanged for a title already in the column (also in a group) or empty input", () => {
    expect(addTitle(board, "cto", "c1").outcome).toBe("exists");
    expect(addTitle(board, "cto", "c1").board).toBe(board);
    expect(addTitle(grouped, "GRÜNDER", "c1").outcome).toBe("exists");
    expect(addTitle(board, "   ", "c1").outcome).toBe("empty");
  });

  test("a manual title moved between columns stays manual; sent to the pool it's dropped", () => {
    const { board: withManual } = addTitle(board, "Head of QA", "c2");
    const moved = moveTitle(withManual, "Head of QA", "c1", 0);
    expect(entriesOf(moved, "c1")[0]).toEqual(single("Head of QA"));
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

describe("findColumn / clampCount / getColumnPlan / getBoardPlan", () => {
  test("finds a title's column, also inside a group", () => {
    expect(findColumn(board, "Architect")).toBe("c2");
    expect(findColumn(grouped, "Gründer")).toBe("c1");
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
    const withUnnamed = groupWithAbove(grouped, "c1", 1);
    expect(getColumnPlan(grouped, "c1")).toEqual([
      { name: "CEO", titles: ["CEO"], count: 1 },
      { name: "Founders", titles: ["Founder", "Gründer"], count: 3 },
      { name: "CTO", titles: ["CTO"], count: 1 },
    ]);
    expect(getColumnPlan(withUnnamed, "c1")[0]).toEqual({
      name: "CEO / Founder / Gründer",
      titles: ["CEO", "Founder", "Gründer"],
      count: 1,
    });
  });

  test("lists the columns in their order with their names and lead counts", () => {
    const plan = getBoardPlan(moveColumn(setColumnCount(board, "c2", 3), "c2", 0));
    expect(plan).toEqual([
      { id: "c2", name: "Technical", count: 3, entries: [{ name: "Architect", titles: ["Architect"], count: 1 }] },
      {
        id: "c1",
        name: "Management",
        count: 1,
        entries: [
          { name: "CEO", titles: ["CEO"], count: 1 },
          { name: "CTO", titles: ["CTO"], count: 2 },
        ],
      },
    ]);
  });
});

describe("company limit", () => {
  test("is off on a new board and on boards saved without it", () => {
    expect(getCompanyLimit(createEmptyBoard())).toBeNull();
    expect(sanitizeBoard({ columns: board.columns }).companyLimit).toEqual(off);
    expect(sanitizeBoard({ management: ["CEO"] }).companyLimit).toEqual(off);
  });

  test("setCompanyLimit turns it on and clamps the value", () => {
    expect(getCompanyLimit(setCompanyLimit(board, { enabled: true, value: "12" }))).toBe(12);
    expect(getCompanyLimit(setCompanyLimit(board, { enabled: true, value: 500 }))).toBe(99);
    expect(getCompanyLimit(setCompanyLimit(board, { enabled: true, value: 0 }))).toBe(1);
    expect(setCompanyLimit(board, { enabled: false, value: 3 }).companyLimit).toEqual({ enabled: false, value: 3 });
    expect(getCompanyLimit(setCompanyLimit(board, { enabled: false, value: 3 }))).toBeNull();
    expect(board.companyLimit).toEqual(off);
  });

  test("sanitizeBoard keeps it, clamped, and survives board changes", () => {
    expect(sanitizeBoard({ ...board, companyLimit: { enabled: true, value: "300" } }).companyLimit).toEqual({ enabled: true, value: 99 });
    expect(sanitizeBoard({ ...board, companyLimit: { enabled: "yes", value: 3 } }).companyLimit).toEqual({ enabled: false, value: 3 });
    const limited = setCompanyLimit(board, { enabled: true, value: 4 });
    expect(getCompanyLimit(moveColumn(addColumn(limited, "HR").board, "c3", 0))).toBe(4);
  });
});

describe("hasJobTitles", () => {
  test("is false only when every column is empty", () => {
    expect(hasJobTitles(createEmptyBoard())).toBe(false);
    expect(hasJobTitles(addColumn(createEmptyBoard(), "HR").board)).toBe(false);
    expect(hasJobTitles(moveTitle(addColumn(createEmptyBoard(), "HR").board, "QA", "c3"))).toBe(true);
    expect(hasJobTitles(groupWithAbove(board, "c1", 1))).toBe(true);
  });
});

describe("boardToFile / boardFromFile", () => {
  const limits = { min: 0, max: 9, default: 1 };

  test("a saved board loads back the same, with the columns' names, order and lead counts", () => {
    const custom = moveColumn(setColumnCount(addColumn(grouped, "HR").board, "c3", 4), "c3", 0);
    expect(boardFromFile(JSON.stringify(boardToFile(custom)), limits)).toEqual(custom);
  });

  test("a saved company limit loads back", () => {
    const limited = setCompanyLimit(board, { enabled: true, value: 7 });
    expect(boardFromFile(JSON.stringify(boardToFile(limited)), limits).companyLimit).toEqual({ enabled: true, value: 7 });
  });

  test("loads a version 1 file (fixed Management / Technical columns) and cleans it", () => {
    const file = {
      format: "leads-automate-job-titles",
      version: 1,
      leadsCount: { management: 50 },
      management: ["CEO", { titles: ["Founder", "CEO"], count: 20 }],
      manual: ["Founder", "Gone"],
    };
    expect(boardFromFile(JSON.stringify(file), limits)).toEqual({
      columns: [
        column("c1", "Management", [single("CEO"), { id: "g1", name: "", titles: ["Founder"], count: 9 }], 9),
        column("c2", "Technical", []),
      ],
      manual: ["Founder"],
      companyLimit: off,
    });
  });

  test("rejects other files", () => {
    expect(() => boardFromFile("CEO, CTO")).toThrow("not a JSON file");
    expect(() => boardFromFile(JSON.stringify({ auto: [], manual: [] }))).toThrow("not a job titles file");
    expect(() => boardFromFile(JSON.stringify({ format: "leads-automate-job-titles", version: 3 }))).toThrow(
      "unsupported file version 3"
    );
    expect(() => boardFromFile(JSON.stringify({ format: "leads-automate-job-titles", version: 2 }))).toThrow(
      "the file has no columns"
    );
  });
});
