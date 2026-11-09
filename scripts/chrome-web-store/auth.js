// Chrome Web Store API v2 authentication: exchanges a Google Cloud Service
// Account key for a short-lived OAuth2 access token via the standard
// service-account JWT-bearer flow (RFC 7523). No token is ever persisted to
// disk or logged.
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const TOKEN_LIFETIME_SECONDS = 3600;

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseServiceAccountKey(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("CWS_SERVICE_ACCOUNT_KEY is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("CWS_SERVICE_ACCOUNT_KEY is missing client_email or private_key");
  }
  return parsed;
}

export function buildAssertion(serviceAccount, { now = Math.floor(Date.now() / 1000) } = {}) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = base64url(createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key));

  return `${unsigned}.${signature}`;
}

// Deliberately short-lived: a fresh token is requested per workflow run
// rather than persisting one, per the "prefer short-lived access tokens"
// requirement.
export async function getAccessToken(rawServiceAccountJson, { fetchImpl = fetch } = {}) {
  const serviceAccount = parseServiceAccountKey(rawServiceAccountJson);
  const assertion = buildAssertion(serviceAccount);

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.access_token) {
    // Never include `body` here — Google's error payload can echo back
    // request parameters.
    throw new Error(`Chrome Web Store authentication failed (HTTP ${response.status})`);
  }

  return body.access_token;
}
