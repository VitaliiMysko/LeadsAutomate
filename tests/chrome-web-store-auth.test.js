import { jest } from "@jest/globals";
import { generateKeyPairSync } from "node:crypto";
import { parseServiceAccountKey, buildAssertion, getAccessToken } from "../scripts/chrome-web-store/auth.js";

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("parseServiceAccountKey", () => {
  test("parses a valid service account JSON key", () => {
    const parsed = parseServiceAccountKey(JSON.stringify({ client_email: "a@b.com", private_key: "key" }));
    expect(parsed.client_email).toBe("a@b.com");
  });

  test("rejects invalid JSON", () => {
    expect(() => parseServiceAccountKey("{not json")).toThrow(/not valid JSON/);
  });

  test("rejects a key missing required fields", () => {
    expect(() => parseServiceAccountKey(JSON.stringify({ client_email: "a@b.com" }))).toThrow(/missing/);
  });
});

describe("buildAssertion", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serviceAccount = { client_email: "svc@project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs1", format: "pem" }) };

  test("encodes the expected JWT header and claims", () => {
    const jwt = buildAssertion(serviceAccount, { now: 1000 });
    const [headerB64, claimsB64] = jwt.split(".");

    expect(decodeSegment(headerB64)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodeSegment(claimsB64)).toEqual({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/chromewebstore",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1000,
      exp: 1000 + 3600,
    });
  });

  test("produces a signature segment", () => {
    const jwt = buildAssertion(serviceAccount, { now: 1000 });
    expect(jwt.split(".")).toHaveLength(3);
  });
});

describe("getAccessToken", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rawKey = JSON.stringify({
    client_email: "svc@project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs1", format: "pem" }),
  });

  test("returns the access token on success", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "test-token" }),
    });

    const token = await getAccessToken(rawKey, { fetchImpl });
    expect(token).toBe("test-token");
  });

  test("throws a sanitized error on failure, without leaking the request body", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid_grant" }),
    });

    await expect(getAccessToken(rawKey, { fetchImpl })).rejects.toThrow(/HTTP 401/);
  });
});
