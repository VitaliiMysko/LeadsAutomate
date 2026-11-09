import { jest } from "@jest/globals";
import { uploadPackage } from "../scripts/chrome-web-store/upload.js";
import { publishItem } from "../scripts/chrome-web-store/publish.js";

function fakeClient(request) {
  return { itemPath: "/publishers/pub/items/ext", request };
}

describe("uploadPackage", () => {
  test("POSTs the zip bytes to the :upload endpoint via the upload API root", async () => {
    const request = jest.fn().mockResolvedValue({ uploadState: "IN_PROGRESS" });
    const zip = Buffer.from("zip-bytes");

    await uploadPackage(fakeClient(request), zip);

    expect(request).toHaveBeenCalledWith("/publishers/pub/items/ext:upload", {
      method: "POST",
      upload: true,
      headers: { "Content-Type": "application/octet-stream" },
      body: zip,
    });
  });
});

describe("publishItem", () => {
  test("POSTs to the :publish endpoint", async () => {
    const request = jest.fn().mockResolvedValue({ status: ["OK"] });

    await publishItem(fakeClient(request));

    expect(request).toHaveBeenCalledWith("/publishers/pub/items/ext:publish", { method: "POST" });
  });
});
