import {
  createEmptyBoard,
  sanitizeBoard,
  getPool,
  moveTitle,
  findColumn,
  isManualTitle,
  addTitle,
  getPriorityWeights,
  POOL,
} from "../src/utils/priority-board.js";

const board = { management: ["CEO", "CTO"], technical: ["Architect"], manual: [] };

describe("getPool", () => {
  test("lists filter titles not placed in any column, in filter order", () => {
    expect(getPool(board, ["Developer", "CTO", "Architect", "QA"])).toEqual(["Developer", "QA"]);
  });
});

describe("moveTitle", () => {
  test("adds a pool title at the given index", () => {
    expect(moveTitle(board, "VP", "management", 1).management).toEqual(["CEO", "VP", "CTO"]);
  });

  test("appends when no index is given and clamps out-of-range indexes", () => {
    expect(moveTitle(board, "VP", "technical").technical).toEqual(["Architect", "VP"]);
    expect(moveTitle(board, "VP", "technical", 99).technical).toEqual(["Architect", "VP"]);
    expect(moveTitle(board, "VP", "technical", -3).technical).toEqual(["VP", "Architect"]);
  });

  test("reorders within a column", () => {
    expect(moveTitle(board, "CTO", "management", 0).management).toEqual(["CTO", "CEO"]);
  });

  test("moves between columns", () => {
    const next = moveTitle(board, "CTO", "technical", 0);
    expect(next).toEqual({ management: ["CEO"], technical: ["CTO", "Architect"], manual: [] });
  });

  test("returns a title to the pool", () => {
    expect(moveTitle(board, "CEO", POOL)).toEqual({ management: ["CTO"], technical: ["Architect"], manual: [] });
  });

  test("does not mutate the input board", () => {
    moveTitle(board, "CEO", "technical", 0);
    expect(board).toEqual({ management: ["CEO", "CTO"], technical: ["Architect"], manual: [] });
  });

  test("rejects unknown columns", () => {
    expect(() => moveTitle(board, "CEO", "sales")).toThrow();
  });
});

describe("sanitizeBoard", () => {
  test("drops non-strings, duplicates and unknown keys", () => {
    expect(sanitizeBoard({ management: ["CEO", 5, "CEO"], technical: ["CEO", "QA"], other: ["x"] })).toEqual({
      management: ["CEO"],
      technical: ["QA"],
      manual: [],
    });
    expect(sanitizeBoard(null)).toEqual(createEmptyBoard());
  });

  test("keeps only manual titles that are still in a column", () => {
    expect(sanitizeBoard({ management: ["CEO"], technical: ["Hand-made"], manual: ["Hand-made", "Gone", 7] })).toEqual({
      management: ["CEO"],
      technical: ["Hand-made"],
      manual: ["Hand-made"],
    });
  });
});

describe("addTitle", () => {
  const filterTitles = ["Chief Technology Officer", "Developer"];

  test("adds a new typed title at the end of the column and marks it manual", () => {
    const { board: next, title, outcome } = addTitle(board, "  Head   of  QA ", "technical", filterTitles);
    expect(outcome).toBe("added");
    expect(title).toBe("Head of QA");
    expect(next.technical).toEqual(["Architect", "Head of QA"]);
    expect(isManualTitle(next, "Head of QA")).toBe(true);
  });

  test("takes a filter title with the filter's spelling, not as manual", () => {
    const { board: next, title, outcome } = addTitle(board, "chief technology officer", "management", filterTitles);
    expect(outcome).toBe("placed");
    expect(title).toBe("Chief Technology Officer");
    expect(next.management).toEqual(["CEO", "CTO", "Chief Technology Officer"]);
    expect(next.manual).toEqual([]);
  });

  test("moves a title already in the other column", () => {
    const { board: next, outcome } = addTitle(board, "architect", "management", filterTitles);
    expect(outcome).toBe("moved");
    expect(next).toEqual({ management: ["CEO", "CTO", "Architect"], technical: [], manual: [] });
  });

  test("leaves the board unchanged for a title already in the column or empty input", () => {
    expect(addTitle(board, "cto", "management").outcome).toBe("exists");
    expect(addTitle(board, "cto", "management").board).toBe(board);
    expect(addTitle(board, "   ", "management").outcome).toBe("empty");
  });

  test("a manual title moved between columns stays manual; sent to the pool it's dropped", () => {
    const { board: withManual } = addTitle(board, "Head of QA", "technical");
    const moved = moveTitle(withManual, "Head of QA", "management", 0);
    expect(moved.management[0]).toBe("Head of QA");
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

describe("findColumn / getPriorityWeights", () => {
  test("finds a title's column", () => {
    expect(findColumn(board, "Architect")).toBe("technical");
    expect(findColumn(board, "QA")).toBeNull();
  });

  test("gives the first title the highest weight", () => {
    expect(getPriorityWeights(["CEO", "CTO", "VP"])).toEqual([
      { title: "CEO", weight: 3 },
      { title: "CTO", weight: 2 },
      { title: "VP", weight: 1 },
    ]);
  });
});
