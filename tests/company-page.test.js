import { companyPagePath, companyPageUrl, companyIdFromPageHtml, companyNameFromPageHtml, organizationFromSignedInPageHtml } from "../src/utils/company-page.js";

describe("companyNameFromPageHtml", () => {
  test.each([
    ['<meta property="og:title" content="Tangent | LinkedIn">', "Tangent"],
    ['<meta property="og:title" content="Moriyama - Umbraco Platinum Partner UK/US | LinkedIn" />', "Moriyama - Umbraco Platinum Partner UK/US"],
    ['<meta property="og:title" content="ENVNT Destination &amp; Event  Management | LinkedIn">', "ENVNT Destination & Event Management"],
    ['<meta property="og:title" content="Ørskov&#39;s &#x26; Co | LinkedIn">', "Ørskov's & Co"],
    ['<meta property="og:title" content=" | LinkedIn">', null],
    ["<title>Tangent</title>", null],
    [undefined, null],
  ])("%s → %s", (html, expected) => {
    expect(companyNameFromPageHtml(html)).toBe(expected);
  });
});

describe("companyPagePath", () => {
  test.each([
    ["https://www.linkedin.com/company/moriyama/", "company/moriyama"],
    ["https://www.linkedin.com/company/Moriyama", "company/moriyama"],
    ["linkedin.com/company/acme/about/?viewAsMember=true", "company/acme"],
    ["https://uk.linkedin.com/company/acme#top", "company/acme"],
    ["https://www.linkedin.com/showcase/ptools-web/", "showcase/ptools-web"],
    ["https://www.linkedin.com/school/some-school", "school/some-school"],
    ["https://www.linkedin.com/company/kraftwerk-agentur-f%C3%BCr-neue-kommunikation/", "company/kraftwerk-agentur-für-neue-kommunikation"],
    ["https://www.linkedin.com/company/bad%E0%A4/", "company/bad%e0%a4"],
    ["https://www.linkedin.com/company/2781504/", "company/2781504"],
    ["https://www.linkedin.com/in/someone/", null],
    ["https://www.linkedin.com/sales/company/2781504", null],
    ["https://example.com/company/acme", null],
    ["acme", null],
    ["", null],
    [null, null],
  ])("%s → %s", (value, expected) => {
    expect(companyPagePath(value)).toBe(expected);
  });
});

describe("companyPageUrl", () => {
  test("encodes the name part", () => {
    expect(companyPageUrl("company/moriyama")).toBe("https://www.linkedin.com/company/moriyama/");
    expect(companyPageUrl("company/kraftwerk-agentur-für-neue-kommunikation")).toBe(
      "https://www.linkedin.com/company/kraftwerk-agentur-f%C3%BCr-neue-kommunikation/"
    );
  });
});

describe("companyIdFromPageHtml", () => {
  test("reads the top card's organization URN, not other companies on the page", () => {
    const html =
      '<a data-entity-id="urn:li:organization:1035">Similar</a>' +
      '<button data-semaphore-content-type="COMPANY" data-semaphore-content-urn="urn:li:organization:804354"></button>';
    expect(companyIdFromPageHtml(html)).toBe("804354");
  });

  test("falls back to the overview module", () => {
    const html = '<code><!--{"organization":{"objectUrn":"urn:li:organization:804354"},"module":"COMPANY_OVERVIEW"}--></code>';
    expect(companyIdFromPageHtml(html)).toBe("804354");
  });

  test("null when the page has no id of its own", () => {
    expect(companyIdFromPageHtml('<a data-entity-id="urn:li:organization:1035">Similar</a>')).toBeNull();
    expect(companyIdFromPageHtml("")).toBeNull();
    expect(companyIdFromPageHtml(undefined)).toBeNull();
  });
});

describe("organizationFromSignedInPageHtml", () => {
  // As in the page: escaped inside a script's string, other organizations' follow payloads around it.
  const html =
    '<script>self.push("{\\"payload\\":{\\"organizationId\\":\\"67153999\\",\\"contentRef\\":\\"x\\"}},' +
    '{\\"payload\\":{\\"key\\":\\"481261\\",\\"pageKind\\":\\"School\\",\\"organizationIdOrVanityName\\":\\"jmcacademy\\",' +
    '\\"organizationId\\":\\"481261\\",\\"organizationName\\":\\"JMC  Academy \\\\\\"Sydney\\\\\\" \u0026 Co\\"}},' +
    '{\\"payload\\":{\\"organizationIdOrVanityName\\":\\"34702226\\",\\"organizationId\\":\\"34702226\\"}}")</script>';

  test("reads the id and name next to the page's name part", () => {
    expect(organizationFromSignedInPageHtml(html, "school/jmcacademy")).toEqual({ id: "481261", name: 'JMC Academy "Sydney" & Co' });
  });

  test("a page addressed by its id", () => {
    expect(organizationFromSignedInPageHtml(html, "company/34702226")).toEqual({ id: "34702226", name: null });
  });

  test("not unescaped JSON either", () => {
    const plain = '{"organizationIdOrVanityName":"JMCAcademy","organizationId":"481261","organizationName":"JMC Academy"}';
    expect(organizationFromSignedInPageHtml(plain, "school/jmcacademy")).toEqual({ id: "481261", name: "JMC Academy" });
  });

  test.each([
    ["another page's", html, "school/other"],
    ["a zero id", '{"organizationIdOrVanityName":"a","organizationId":"0"}', "school/a"],
    ["no payload", "<html></html>", "school/a"],
    ["no path", html, undefined],
  ])("null for %s", (_, text, path) => {
    expect(organizationFromSignedInPageHtml(text, path)).toBeNull();
  });
});
