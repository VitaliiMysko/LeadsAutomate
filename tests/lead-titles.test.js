import { parseCsv } from "../src/utils/csv.js";
import {
  newLeadTitles,
  addLeadTitles,
  columnForTitle,
  leadTitleRows,
  leadTitlesCsv,
  restoreLeadTitles,
} from "../src/utils/lead-titles.js";

const lead = (title, locked = false) => ({ title, locked });
const columns = [
  { id: "a", name: "Management", count: 1, entries: [{ name: "CEO", titles: ["CEO", "Chief Executive Officer"], count: 1 }] },
  { id: "b", name: "Technical", count: 1, entries: [{ name: "CTO", titles: ["CTO"], count: 1 }] },
];

describe("addLeadTitles", () => {
  test("counts the titles, grouping case, punctuation and spaces", () => {
    let record = newLeadTitles(1);
    record = addLeadTitles(record, [lead("CEO"), lead("Co-Founder"), lead("ceo "), lead("Co Founder")]);
    record = addLeadTitles(record, [lead("CEO")]);
    expect(record.leads).toBe(5);
    expect(record.titles.map(({ title, count }) => [title, count])).toEqual([
      ["CEO", 3],
      ["Co-Founder", 2],
    ]);
  });

  test("leaves out locked leads and leads without a title", () => {
    const record = addLeadTitles(newLeadTitles(), [lead("CTO", true), lead(""), lead(undefined), lead(" , "), lead("CTO")]);
    expect(record.leads).toBe(1);
    expect(record.titles).toEqual([{ key: "cto", title: "CTO", count: 1 }]);
  });

  test("doesn't change the record it's given", () => {
    const record = addLeadTitles(newLeadTitles(), [lead("CTO")]);
    addLeadTitles(record, [lead("CTO")]);
    expect(record.titles[0].count).toBe(1);
    expect(record.leads).toBe(1);
  });
});

describe("columnForTitle", () => {
  test("names the first column whose items take the title", () => {
    expect(columnForTitle("CTO & Co-founder", columns)).toBe("Technical");
    expect(columnForTitle("chief executive officer", columns)).toBe("Management");
    expect(columnForTitle("Director", columns)).toBe("");
  });
});

describe("leadTitleRows / leadTitlesCsv", () => {
  const record = addLeadTitles(newLeadTitles(), [lead("Director"), lead("CTO"), lead("CTO"), lead("Head of R&D, EMEA")]);

  test("sorts by count, then by title", () => {
    expect(leadTitleRows(record, columns)).toEqual([
      { title: "CTO", count: 2, column: "Technical" },
      { title: "Director", count: 1, column: "" },
      { title: "Head of R&D, EMEA", count: 1, column: "" },
    ]);
  });

  test("writes a CSV that reads back", () => {
    expect(parseCsv(leadTitlesCsv(record, columns))).toEqual([
      ["job_title", "count", "column"],
      ["CTO", "2", "Technical"],
      ["Director", "1", ""],
      ["Head of R&D, EMEA", "1", ""],
    ]);
  });
});

describe("restoreLeadTitles", () => {
  test("keeps a stored record", () => {
    const record = addLeadTitles({ ...newLeadTitles(5), companies: 2 }, [lead("CTO")]);
    expect(restoreLeadTitles(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  test("rejects other values and drops bad titles", () => {
    expect(restoreLeadTitles(null)).toBeNull();
    expect(restoreLeadTitles({ titles: "x" })).toBeNull();
    expect(restoreLeadTitles({ titles: [{ title: "" }, { title: "CTO", count: "x" }, 7] })).toEqual({
      startedAt: 0,
      companies: 0,
      leads: 0,
      titles: [{ key: "cto", title: "CTO", count: 1 }],
    });
  });
});
