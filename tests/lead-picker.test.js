import { titleMatches, splitTitle, nextPick, countFound, canOpenLead } from "../src/utils/lead-picker.js";

const lead = (index, title, extra = {}) => ({
  index,
  name: `Lead ${index}`,
  title,
  href: `https://www.linkedin.com/sales/lead/L${index}`,
  locked: false,
  ...extra,
});
const entry = (titles, count = 1, name = titles.join(" / ")) => ({ name, titles, count });

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
  for (let pick; (pick = nextPick(leads, plans, leadsCount, tried)); ) {
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
    expect(nextPick(leads, plans, { management: 2, technical: 0 }).entry).toBe("CEO");
  });

  test("stops a column at its leads count", () => {
    const plans = { management: [], technical: [entry(["CTO"], 5), entry(["Engineering Manager"])] };
    const result = run(leads, plans, { management: 0, technical: 2 });
    expect(indexes(result)).toEqual([1, 3]);
    expect(countFound(result.tried, { management: 0, technical: 2 }).technical).toEqual({ wanted: 2, found: 2 });
  });

  test("takes at most an entry's count, then goes to the next entry", () => {
    const plans = { management: [], technical: [entry(["CTO"], 1), entry(["Engineering Manager"])] };
    expect(indexes(run(leads, plans, { management: 0, technical: 3 }))).toEqual([1, 0]);
  });

  test("a lead not saved doesn't count: the entry tries its next lead", () => {
    const plans = { management: [], technical: [entry(["CTO"], 1), entry(["Engineering Manager"])] };
    const result = run(leads, plans, { management: 0, technical: 2 }, [3, 0]);
    expect(indexes(result)).toEqual([1, 3, 0]);
    expect(countFound(result.tried, { management: 0, technical: 2 }).technical).toEqual({ wanted: 2, found: 2 });
  });

  test("a column without enough savable leads ends short", () => {
    const plans = { management: [entry(["CEO"], 2), entry(["COO"])], technical: [] };
    const result = run(leads, plans, { management: 3, technical: 0 }, []);
    expect(indexes(result)).toEqual([2, 4]);
    expect(countFound(result.tried, { management: 3, technical: 0 }).management).toEqual({ wanted: 3, found: 0 });
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
    expect(nextPick(leads, plans, { management: 0, technical: 0 })).toBeNull();
  });
});

describe("canOpenLead", () => {
  test("needs a link and no lock", () => {
    expect(canOpenLead(lead(0, "CTO"))).toBe(true);
    expect(canOpenLead(lead(0, "CTO", { locked: true }))).toBe(false);
    expect(canOpenLead(lead(0, "CTO", { href: "" }))).toBe(false);
  });
});
