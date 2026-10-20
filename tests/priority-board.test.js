import {
  createEmptyBoard,
  sanitizeBoard,
  getPool,
  moveTitle,
  findColumn,
  getPriorityWeights,
  POOL,
} from "../src/utils/priority-board.js";

const board = { management: ["CEO", "CTO"], technical: ["Architect"] };

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
    expect(next).toEqual({ management: ["CEO"], technical: ["CTO", "Architect"] });
  });

  test("returns a title to the pool", () => {
    expect(moveTitle(board, "CEO", POOL)).toEqual({ management: ["CTO"], technical: ["Architect"] });
  });

  test("does not mutate the input board", () => {
    moveTitle(board, "CEO", "technical", 0);
    expect(board).toEqual({ management: ["CEO", "CTO"], technical: ["Architect"] });
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
    });
    expect(sanitizeBoard(null)).toEqual(createEmptyBoard());
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
