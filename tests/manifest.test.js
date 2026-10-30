import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

// Chrome derives an extension's id from its manifest key: the first 32 hex
// digits of the key's SHA-256, written with the letters a–p.
function extensionIdFromKey(key) {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}

describe("manifest key", () => {
  // Lead generator answers only this id (COMPANION_EXTENSION_IDS in its
  // src/constants/config.js); a new key needs the new id there too.
  test("gives the id Lead generator accepts", () => {
    expect(extensionIdFromKey(manifest.key)).toBe("ofbkinmakmfacepccjcbmjgecdppolki");
  });
});
