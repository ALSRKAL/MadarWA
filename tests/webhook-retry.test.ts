import { describe, expect, it } from "vitest";
import { WEBHOOK } from "../src/shared/constants";
import { isRetryableStatus, retryDelayMs } from "../src/shared/utils/retry";

describe("webhook retry policy", () => {
  it("retries only temporary receiver failures", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), String(status)).toBe(true);
    }
    for (const status of [200, 204, 301, 400, 401, 403, 404, 413, 422]) {
      expect(isRetryableStatus(status), String(status)).toBe(false);
    }
  });

  it("follows the backoff table and honors a capped Retry-After", () => {
    expect(retryDelayMs(0, null)).toBe(WEBHOOK.retryDelaysMs[0]);
    expect(retryDelayMs(1, null)).toBe(WEBHOOK.retryDelaysMs[1]);
    expect(retryDelayMs(9, null)).toBe(WEBHOOK.retryDelaysMs[WEBHOOK.retryDelaysMs.length - 1]);
    expect(retryDelayMs(0, "2")).toBe(2000);
    expect(retryDelayMs(0, "0")).toBe(0);
    expect(retryDelayMs(0, "3600")).toBe(WEBHOOK.maxRetryAfterMs);
    // HTTP-date and empty values fall back to the table.
    expect(retryDelayMs(0, "Wed, 21 Oct 2026 07:28:00 GMT")).toBe(WEBHOOK.retryDelaysMs[0]);
    expect(retryDelayMs(1, "  ")).toBe(WEBHOOK.retryDelaysMs[1]);
  });
});
