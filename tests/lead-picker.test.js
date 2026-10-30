import { titleMatches, splitTitle, pickLeads, canOpenLead } from "../src/utils/lead-picker.js";

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

describe("pickLeads", () => {
  const leads = [lead(0, "Engineering Manager"), lead(1, "CTO"), lead(2, "CEO & Founder"), lead(3, "CTO"), lead(4, "COO")];

  test("takes leads by priority, not page order", () => {
    const plans = { management: [entry(["CEO"]), entry(["COO"])], technical: [] };
    const { picks } = pickLeads(leads, plans, { management: 2, technical: 0 });
    expect(picks.map((pick) => pick.lead.index)).toEqual([2, 4]);
    expect(picks.map((pick) => pick.entry)).toEqual(["CEO", "COO"]);
  });

  test("stops a column at its leads count", () => {
    const plans = { management: [], technical: [entry(["CTO"], 5), entry(["Engineering Manager"])] };
    const result = pickLeads(leads, plans, { management: 0, technical: 2 });
    expect(result.picks.map((pick) => pick.lead.index)).toEqual([1, 3]);
    expect(result.columns.technical).toEqual({ wanted: 2, found: 2 });
  });

  test("takes at most an entry's count, then goes to the next entry", () => {
    const plans = { management: [], technical: [entry(["CTO"], 1), entry(["Engineering Manager"])] };
    const { picks } = pickLeads(leads, plans, { management: 0, technical: 3 });
    expect(picks.map((pick) => pick.lead.index)).toEqual([1, 0]);
  });

  test("a group takes leads of any of its titles, its count shared", () => {
    const plans = { management: [entry(["COO", "CEO"], 2, "Executives")], technical: [] };
    const { picks } = pickLeads(leads, plans, { management: 9, technical: 0 });
    expect(picks.map((pick) => pick.lead.index)).toEqual([2, 4]);
    expect(picks.every((pick) => pick.entry === "Executives")).toBe(true);
  });

  test("an entry with count 0 is skipped", () => {
    const plans = { management: [entry(["CEO"], 0), entry(["COO"])], technical: [] };
    const { picks } = pickLeads(leads, plans, { management: 2, technical: 0 });
    expect(picks.map((pick) => pick.lead.index)).toEqual([4]);
  });

  test("management first; a lead is taken once", () => {
    const plans = { management: [entry(["CTO"])], technical: [entry(["CTO"], 3)] };
    const result = pickLeads(leads, plans, { management: 1, technical: 3 });
    expect(result.picks.map((pick) => [pick.column, pick.lead.index])).toEqual([
      ["management", 1],
      ["technical", 3],
    ]);
    expect(result.columns).toEqual({ management: { wanted: 1, found: 1 }, technical: { wanted: 3, found: 1 } });
  });

  test("locked leads and leads without a link are never taken", () => {
    const withLocked = [lead(0, "CTO", { locked: true }), lead(1, "CTO", { href: "" }), lead(2, "CTO")];
    const plans = { management: [], technical: [entry(["CTO"], 3)] };
    const result = pickLeads(withLocked, plans, { management: 0, technical: 3 });
    expect(result.picks.map((pick) => pick.lead.index)).toEqual([2]);
    expect(result.columns.technical).toEqual({ wanted: 3, found: 1 });
  });

  test("a leads count of 0 takes nothing", () => {
    const plans = { management: [entry(["CEO"])], technical: [entry(["CTO"])] };
    expect(pickLeads(leads, plans, { management: 0, technical: 0 }).picks).toEqual([]);
  });
});

describe("canOpenLead", () => {
  test("needs a link and no lock", () => {
    expect(canOpenLead(lead(0, "CTO"))).toBe(true);
    expect(canOpenLead(lead(0, "CTO", { locked: true }))).toBe(false);
    expect(canOpenLead(lead(0, "CTO", { href: "" }))).toBe(false);
  });
});
