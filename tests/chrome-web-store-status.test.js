import { jest } from "@jest/globals";
import { pollUploadStatus, isTerminalUploadState, isSuccessUploadState } from "../scripts/chrome-web-store/status.js";

function fakeClient(request) {
  return { itemPath: "/publishers/p/items/e", request };
}

describe("pollUploadStatus", () => {
  test("returns immediately when fetchStatus already reports a terminal lastAsyncUploadState", async () => {
    const request = jest.fn().mockResolvedValue({ lastAsyncUploadState: "SUCCESS" });
    const status = await pollUploadStatus(fakeClient(request), { sleep: jest.fn(), now: () => 0 });
    expect(status).toEqual({ lastAsyncUploadState: "SUCCESS" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("polls again while lastAsyncUploadState is UPLOAD_IN_PROGRESS, then returns on success", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({ lastAsyncUploadState: "UPLOAD_IN_PROGRESS" })
      .mockResolvedValueOnce({ lastAsyncUploadState: "UPLOAD_IN_PROGRESS" })
      .mockResolvedValueOnce({ lastAsyncUploadState: "SUCCESS" });
    const sleep = jest.fn().mockResolvedValue(undefined);

    const status = await pollUploadStatus(fakeClient(request), { sleep, now: () => 0, intervalMs: 10, timeoutMs: 1000 });

    expect(status.lastAsyncUploadState).toBe("SUCCESS");
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("keeps polling (does not treat as terminal) when lastAsyncUploadState is simply absent", async () => {
    // Per Google's docs, lastAsyncUploadState is only set for an async
    // upload — a synchronous one never populates it at all. Polling this
    // case forever until timeout is expected: callers must avoid ever
    // polling when the initial :upload response already resolved
    // synchronously (see run-upload.js / isTerminalUploadState usage there).
    const request = jest.fn().mockResolvedValue({});
    let t = 0;
    const now = () => t;
    const sleep = jest.fn().mockImplementation(() => {
      t += 100;
      return Promise.resolve();
    });

    await expect(
      pollUploadStatus(fakeClient(request), { sleep, now, intervalMs: 100, timeoutMs: 250 })
    ).rejects.toThrow(/Timed out/);
  });

  test("times out and throws when the deadline passes while still UPLOAD_IN_PROGRESS", async () => {
    const request = jest.fn().mockResolvedValue({ lastAsyncUploadState: "UPLOAD_IN_PROGRESS" });
    let t = 0;
    const now = () => t;
    const sleep = jest.fn().mockImplementation(() => {
      t += 100;
      return Promise.resolve();
    });

    await expect(
      pollUploadStatus(fakeClient(request), { sleep, now, intervalMs: 100, timeoutMs: 250 })
    ).rejects.toThrow(/Timed out/);
  });

  test("treats a non-progress, non-SUCCESS terminal state (e.g. FAILURE) as terminal, not a timeout", async () => {
    const request = jest.fn().mockResolvedValue({ lastAsyncUploadState: "FAILURE" });
    const status = await pollUploadStatus(fakeClient(request), { sleep: jest.fn(), now: () => 0 });
    expect(status.lastAsyncUploadState).toBe("FAILURE");
  });
});

describe("isTerminalUploadState", () => {
  test("false for missing/undefined state", () => {
    expect(isTerminalUploadState(undefined)).toBe(false);
    expect(isTerminalUploadState(null)).toBe(false);
    expect(isTerminalUploadState("")).toBe(false);
  });

  test("false for UPLOAD_IN_PROGRESS", () => {
    expect(isTerminalUploadState("UPLOAD_IN_PROGRESS")).toBe(false);
  });

  test("true for any other non-empty state", () => {
    expect(isTerminalUploadState("SUCCESS")).toBe(true);
    expect(isTerminalUploadState("FAILURE")).toBe(true);
  });
});

describe("isSuccessUploadState", () => {
  test("true for SUCCEEDED (the value the Chrome Web Store API actually returns)", () => {
    expect(isSuccessUploadState("SUCCEEDED")).toBe(true);
  });

  test("true for SUCCESS too, in case fetchStatus ever uses a different literal than :upload", () => {
    expect(isSuccessUploadState("SUCCESS")).toBe(true);
  });

  test("false for anything else", () => {
    expect(isSuccessUploadState("FAILURE")).toBe(false);
    expect(isSuccessUploadState(undefined)).toBe(false);
  });
});
