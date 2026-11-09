import { jest } from "@jest/globals";
import { createClient, sanitizeApiError } from "../scripts/chrome-web-store/client.js";

describe("createClient", () => {
  test("requires an access token, publisher id, and extension id", () => {
    expect(() => createClient({ publisherId: "p", extensionId: "e" })).toThrow(/access token/);
    expect(() => createClient({ accessToken: "t", extensionId: "e" })).toThrow(/CWS_PUBLISHER_ID/);
    expect(() => createClient({ accessToken: "t", publisherId: "p" })).toThrow(/CWS_EXTENSION_ID/);
  });

  test("builds the publishers/{id}/items/{id} path", () => {
    const client = createClient({ accessToken: "t", publisherId: "pub", extensionId: "ext" });
    expect(client.itemPath).toBe("/publishers/pub/items/ext");
  });

  test("sends the bearer token but never leaks it in a thrown error", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: { message: "forbidden" } }),
    });
    const client = createClient({ accessToken: "super-secret-token", publisherId: "pub", extensionId: "ext", fetchImpl });

    await expect(client.request("/whatever")).rejects.toThrow(/HTTP 403/);

    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer super-secret-token");

    let thrown;
    try {
      await client.request("/whatever");
    } catch (err) {
      thrown = err;
    }
    expect(JSON.stringify(thrown)).not.toContain("super-secret-token");
    expect(thrown.body).toEqual({ error: { message: "forbidden" } });
  });

  test("returns parsed JSON on success", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) });
    const client = createClient({ accessToken: "t", publisherId: "pub", extensionId: "ext", fetchImpl });
    await expect(client.request("/path")).resolves.toEqual({ ok: true });
  });
});

describe("sanitizeApiError", () => {
  test("carries status/body but is a plain Error with no header data", () => {
    const err = sanitizeApiError("boom", { status: 500, body: { detail: "x" } });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(500);
    expect(err.body).toEqual({ detail: "x" });
    expect(err.headers).toBeUndefined();
  });
});
