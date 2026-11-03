import {
  titleMatches,
  splitTitle,
  nextPick,
  countFound,
  canOpenLead,
  wantsMoreLeads,
  companyLimitReached,
  leadProgress,
} from "../src/utils/lead-picker.js";

const lead = (index, title, extra = {}) => ({
  index,
  name: `Lead ${index}`,
  title,
  href: `https://www.linkedin.com/sales/lead/L${index}`,
  locked: false,
  ...extra,
});
const entry = (titles, count = 1, name = titles.join(" / ")) => ({ name, titles, count });
// The board's plan (getBoardPlan) from { [column id]: entries } and
// { [column id]: lead count }: the columns in key order, named by their ids.
const columns = (plans, counts) =>
  Object.entries(plans).map(([id, entries]) => ({ id, name: id, count: counts[id] ?? 0, entries }));

describe("splitTitle", () => {
  test.each([
    ["Co-Founder and Chairman", ["co founder", "chairman"]],
    ["CEO & Founder", ["ceo", "founder"]],
    ["Founder / Managing Partner", ["founder", "managing partner"]],
    ["Technical Director | Co-Founder", ["technical director", "co founder"]],
    ["Director,Founder", ["director", "founder"]],
    ["Chief Executive Officer (CEO)", ["chief executive officer", "ceo"]],
    ["CEO/Managing Director [DGA]", ["ceo", "managing director", "dga"]],
    ["Technical Director at VrijdagOnline BV", ["technical director", "vrijdagonline bv"]],
    [
      "VP Solutions and Development / Tech Lead @ Isatis x Onclic",
      ["vp solutions", "development", "tech lead", "isatis x onclic"],
    ],
    ["Portfoliomanager Gas; Gas Trader; Contract Negotiator", ["portfoliomanager gas", "gas trader", "contract negotiator"]],
    ["Founder AND CEO", ["founder", "ceo"]],
  ])("%s", (title, parts) => {
    expect(splitTitle(title)).toEqual(parts);
  });

  test("'and' and 'at' split only as whole words", () => {
    expect(splitTitle("Head of Brand, Data Analyst")).toEqual(["head of brand", "data analyst"]);
  });
});

describe("titleMatches", () => {
  test("matches one of the lead's titles in full, in any letter case", () => {
    expect(titleMatches("CTO & Co-founder", "cto")).toBe(true);
    expect(titleMatches("Co-Founder and Chairman", "Co-Founder")).toBe(true);
    expect(titleMatches("Head of Engineering, EMEA", "Head of Engineering")).toBe(true);
    expect(titleMatches("Chief Executive Officer (CEO)", "CEO")).toBe(true);
  });

  test("matches the whole title, for job titles holding a separator", () => {
    expect(titleMatches("Head of R&D", "head of r&d")).toBe(true);
    expect(titleMatches("Sales and Marketing Director", "Sales and Marketing Director")).toBe(true);
  });

  test("doesn't match a part of a title", () => {
    expect(titleMatches("Director Of Operations", "Director")).toBe(false);
    expect(titleMatches("Co-Founder and Chairman", "Founder")).toBe(false);
    expect(titleMatches("CTOs club", "CTO")).toBe(false);
    expect(titleMatches("Engineering Manager", "Head of Engineering")).toBe(false);
  });

  test("an empty job title or lead title never matches", () => {
    expect(titleMatches("CTO", "  ")).toBe(false);
    expect(titleMatches("", "CTO")).toBe(false);
    expect(titleMatches(undefined, "CTO")).toBe(false);
  });

  test("works for non-Latin titles", () => {
    expect(titleMatches("Технічний директор, співзасновник", "технічний директор")).toBe(true);
  });
});

// Runs nextPick to the end, saving the leads whose index is in `saves`
// (all when omitted). Returns { order: [[column, index]], tried }.
function run(leads, plans, leadsCount, saves = null) {
  const tried = [];
  const order = [];
  for (let pick; (pick = nextPick(leads, columns(plans, leadsCount), tried)); ) {
    order.push([pick.column, pick.lead.index]);
    tried.push({ index: pick.lead.index, column: pick.column, entryIndex: pick.entryIndex, saved: !saves || saves.includes(pick.lead.index) });
  }
  return { order, tried };
}
const indexes = ({ order }) => order.map(([, index]) => index);

describe("nextPick", () => {
  const leads = [lead(0, "Engineering Manager"), lead(1, "CTO"), lead(2, "CEO & Founder"), lead(3, "CTO"), lead(4, "COO")];

  test("takes leads by priority, not page order", () => {
    const plans = { management: [entry(["CEO"]), entry(["COO"])], technical: [] };
    expect(indexes(run(leads, plans, { management: 2, technical: 0 }))).toEqual([2, 4]);
    expect(nextPick(leads, columns(plans, { management: 2, technical: 0 })).entry).toBe("CEO");
  });

  test("stops a column at its leads count", () => {
    const plans = { management: [], technical: [entry(["CTO"], 5), entry(["Engineering Manager"])] };
    const result = run(leads, plans, { management: 0, technical: 2 });
    expect(indexes(result)).toEqual([1, 3]);
    expect(countFound(result.tried, columns(plans, { management: 0, technical: 2 })).technical).toMatchObject({ wanted: 2, found: 2 });
  });

  test("takes at most an entry's count, then goes to the next entry", () => {
    const plans = { management: [], technical: [entry(["CTO"], 1), entry(["Engineering Manager"])] };
    expect(indexes(run(leads, plans, { management: 0, technical: 3 }))).toEqual([1, 0]);
  });

  test("a lead not saved doesn't count: the entry tries its next lead", () => {
    const plans = { management: [], technical: [entry(["CTO"], 1), entry(["Engineering Manager"])] };
    const result = run(leads, plans, { management: 0, technical: 2 }, [3, 0]);
    expect(indexes(result)).toEqual([1, 3, 0]);
    expect(countFound(result.tried, columns(plans, { management: 0, technical: 2 })).technical).toMatchObject({ wanted: 2, found: 2 });
  });

  test("a column without enough savable leads ends short", () => {
    const plans = { management: [entry(["CEO"], 2), entry(["COO"])], technical: [] };
    const result = run(leads, plans, { management: 3, technical: 0 }, []);
    expect(indexes(result)).toEqual([2, 4]);
    expect(countFound(result.tried, columns(plans, { management: 3, technical: 0 })).management).toMatchObject({ wanted: 3, found: 0 });
  });

  test("a group takes leads of any of its titles, its count shared", () => {
    const plans = { management: [entry(["COO", "CEO"], 2, "Executives")], technical: [] };
    expect(indexes(run(leads, plans, { management: 9, technical: 0 }))).toEqual([2, 4]);
  });

  test("an entry with count 0 is skipped", () => {
    const plans = { management: [entry(["CEO"], 0), entry(["COO"])], technical: [] };
    expect(indexes(run(leads, plans, { management: 2, technical: 0 }))).toEqual([4]);
  });

  test("management first; a lead is tried once", () => {
    const plans = { management: [entry(["CTO"])], technical: [entry(["CTO"], 3)] };
    expect(run(leads, plans, { management: 1, technical: 3 }).order).toEqual([
      ["management", 1],
      ["technical", 3],
    ]);
  });

  test("a lead not saved for management isn't tried again for technical", () => {
    const plans = { management: [entry(["CTO"])], technical: [entry(["CTO"], 3)] };
    expect(run(leads, plans, { management: 1, technical: 3 }, [3]).order).toEqual([
      ["management", 1],
      ["management", 3],
    ]);
  });

  test("locked leads and leads without a link are never taken", () => {
    const withLocked = [lead(0, "CTO", { locked: true }), lead(1, "CTO", { href: "" }), lead(2, "CTO")];
    const plans = { management: [], technical: [entry(["CTO"], 3)] };
    expect(indexes(run(withLocked, plans, { management: 0, technical: 3 }))).toEqual([2]);
  });

  test("a leads count of 0 takes nothing", () => {
    const plans = { management: [entry(["CEO"])], technical: [entry(["CTO"])] };
    expect(nextPick(leads, columns(plans, { management: 0, technical: 0 }))).toBeNull();
  });

  test("any number of columns, tried in their order, with the column's name", () => {
    const plans = { sales: [entry(["COO"])], technical: [entry(["CTO"])], management: [entry(["CEO"])] };
    const counts = { sales: 1, technical: 1, management: 1 };
    expect(run(leads, plans, counts).order).toEqual([
      ["sales", 4],
      ["technical", 1],
      ["management", 2],
    ]);
    expect(nextPick(leads, [{ id: "c7", name: "Sales", count: 1, entries: [entry(["COO"])] }])).toMatchObject({
      column: "c7",
      columnName: "Sales",
      entry: "COO",
    });
  });

  test("no columns, nothing to take", () => {
    expect(nextPick(leads, [])).toBeNull();
  });
});

describe("countFound", () => {
  test("counts the saved leads of every column, with its name", () => {
    const plan = [
      { id: "c1", name: "Management", count: 2, entries: [] },
      { id: "c3", name: "HR", count: 1, entries: [] },
    ];
    const tried = [
      { index: 0, column: "c3", entryIndex: 0, saved: true },
      { index: 1, column: "c1", entryIndex: 0, saved: false },
    ];
    expect(countFound(tried, plan)).toEqual({
      c1: { name: "Management", wanted: 2, found: 0 },
      c3: { name: "HR", wanted: 1, found: 1 },
    });
  });
});

describe("canOpenLead", () => {
  test("needs a link and no lock", () => {
    expect(canOpenLead(lead(0, "CTO"))).toBe(true);
    expect(canOpenLead(lead(0, "CTO", { locked: true }))).toBe(false);
    expect(canOpenLead(lead(0, "CTO", { href: "" }))).toBe(false);
  });
});

describe("company limit", () => {
  const leads = [lead(0, "CEO"), lead(1, "CTO"), lead(2, "COO"), lead(3, "CTO")];
  const plan = columns({ management: [entry(["CEO"]), entry(["COO"])], technical: [entry(["CTO"], 2)] }, { management: 2, technical: 2 });
  const save = (tried, pick, saved = true) => [...tried, { index: pick.lead.index, column: pick.column, entryIndex: pick.entryIndex, saved }];

  // Picks with the limit until nothing is left, saving the leads not in `failed`.
  function runLimited(limit, failed = []) {
    let tried = [];
    for (let pick; (pick = nextPick(leads, plan, tried, limit)); ) tried = save(tried, pick, !failed.includes(pick.lead.index));
    return tried;
  }

  test("stops taking leads once the company has its limit, across the columns", () => {
    expect(runLimited(3).map((item) => item.index)).toEqual([0, 2, 1]);
    expect(runLimited(null).map((item) => item.index)).toEqual([0, 2, 1, 3]);
  });

  test("only saved leads count toward it", () => {
    expect(runLimited(2, [0]).map((item) => item.index)).toEqual([0, 2, 1]);
  });

  test("companyLimitReached and wantsMoreLeads follow it", () => {
    const tried = runLimited(2);
    expect(companyLimitReached(tried, 2)).toBe(true);
    expect(companyLimitReached(tried, 3)).toBe(false);
    expect(companyLimitReached(tried, null)).toBe(false);
    expect(wantsMoreLeads(plan, tried, 2)).toBe(false);
    expect(wantsMoreLeads(plan, tried, null)).toBe(true);
  });
});

describe("leadProgress", () => {
  const plan = columns({ management: [entry(["CEO"])], technical: [entry(["CTO"])] }, { management: 2, technical: 3 });
  const tried = [
    { index: 0, column: "management", entryIndex: 0, saved: true },
    { index: 1, column: "technical", entryIndex: 0, saved: false },
    { index: 2, column: "technical", entryIndex: 0, saved: true },
  ];

  test("found of wanted in all and per column, in the columns' order", () => {
    expect(leadProgress(plan, tried)).toEqual({
      found: 2,
      wanted: 5,
      columns: [
        { id: "management", name: "management", wanted: 2, found: 1 },
        { id: "technical", name: "technical", wanted: 3, found: 1 },
      ],
    });
  });

  test("the company limit caps the leads wanted in all, not per column", () => {
    expect(leadProgress(plan, tried, 3)).toMatchObject({ found: 2, wanted: 3 });
    expect(leadProgress(plan, tried, 9).wanted).toBe(5);
    expect(leadProgress(plan, [], 3).columns[1]).toMatchObject({ wanted: 3, found: 0 });
  });

  test("nothing tried yet, or no columns", () => {
    expect(leadProgress(plan, [])).toMatchObject({ found: 0, wanted: 5 });
    expect(leadProgress([], [])).toEqual({ found: 0, wanted: 0, columns: [] });
  });
});

describe("wantsMoreLeads", () => {
  const plans = { management: [entry(["CEO"], 1), entry(["COO"], 1)], technical: [] };
  const counts = { management: 2, technical: 0 };

  test("true while a column lacks leads and an entry has room", () => {
    expect(wantsMoreLeads(columns(plans, counts), [])).toBe(true);
    expect(wantsMoreLeads(columns(plans, counts), [{ index: 0, column: "management", entryIndex: 0, saved: true }])).toBe(true);
  });

  test("false once the columns have their leads", () => {
    const tried = [
      { index: 0, column: "management", entryIndex: 0, saved: true },
      { index: 1, column: "management", entryIndex: 1, saved: true },
    ];
    expect(wantsMoreLeads(columns(plans, counts), tried)).toBe(false);
  });

  test("false when every entry is full though the column lacks leads", () => {
    const tried = [
      { index: 0, column: "management", entryIndex: 0, saved: true },
      { index: 1, column: "management", entryIndex: 1, saved: true },
    ];
    expect(wantsMoreLeads(columns(plans, { management: 3, technical: 0 }), tried)).toBe(false);
  });

  test("leads not saved don't fill an entry", () => {
    const tried = [{ index: 0, column: "management", entryIndex: 0, saved: false }];
    expect(wantsMoreLeads(columns({ management: [entry(["CEO"], 1)], technical: [] }, { management: 1, technical: 0 }), tried)).toBe(
      true
    );
  });
});
