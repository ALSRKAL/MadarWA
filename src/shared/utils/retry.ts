import { WEBHOOK } from "../constants";

/**
 * Statuses that describe a temporary receiver problem and are worth a retry:
 * timeout, too early, rate limited, or a server error. Every other 4xx means
 * the request itself is wrong, and repeating it cannot help.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Delay before retry number `attempt` (0-based). A numeric Retry-After header
 * (seconds) wins, capped so one slow receiver cannot stall the worker;
 * otherwise the fixed backoff table applies.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const raw = retryAfter?.trim() ?? "";
  const seconds = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(WEBHOOK.maxRetryAfterMs, Math.round(seconds * 1000));
  }
  const table = WEBHOOK.retryDelaysMs;
  return table[Math.min(Math.max(0, attempt), table.length - 1)] ?? 1000;
}
