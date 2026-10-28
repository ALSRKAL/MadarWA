import type { CampaignLogEntry, CampaignStatus, RecipientStatus } from "../types";

export interface QueueItem<T> {
  id: string;
  data: T;
}

export interface QueueItemResult {
  status: Extract<RecipientStatus, "sent" | "failed" | "invalid" | "skipped">;
  detail?: string;
}

export interface QueueSnapshot {
  status: CampaignStatus;
  processed: number;
  total: number;
  sent: number;
  failed: number;
  invalid: number;
  currentIndex: number;
}

export interface BroadcastQueueConfig {
  minDelaySec: number;
  maxDelaySec: number;
  batchSize: number;
  batchCooldownSec: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface QueueCallbacks<T> {
  onItem: (item: QueueItem<T>, index: number) => Promise<QueueItemResult>;
  onProgress: (snapshot: QueueSnapshot) => void;
  onLog: (entry: CampaignLogEntry) => void;
  onStateChange: (status: CampaignStatus) => void;
  onCooldown?: (seconds: number, nextIndex: number) => void;
}

/** Random delay in [min, max]; guards reversed config values. */
export function computeDelayMs(minDelaySec: number, maxDelaySec: number, random: () => number): number {
  const min = Math.max(0, Math.round(minDelaySec));
  const max = Math.max(min, Math.round(maxDelaySec));
  const unit = Math.min(0.999999, Math.max(0, random()));
  return Math.round((min + (max - min) * unit) * 1000);
}

/**
 * Sequential anti-ban queue. One request is in flight at a time; delays and
 * batch cooldowns are injectable so the state machine is deterministic in tests.
 */
export class BroadcastQueue<T> {
  private readonly items: QueueItem<T>[];
  private readonly config: Required<Omit<BroadcastQueueConfig, "sleep">> & { sleep: (ms: number) => Promise<void> };
  private readonly callbacks: QueueCallbacks<T>;
  private statusValue: CampaignStatus = "idle";
  private index = 0;
  private sent = 0;
  private failed = 0;
  private invalid = 0;
  private waiters: Array<() => void> = [];
  private runToken = 0;

  constructor(items: QueueItem<T>[], config: BroadcastQueueConfig, callbacks: QueueCallbacks<T>) {
    this.items = items;
    this.callbacks = callbacks;
    this.config = {
      minDelaySec: Math.max(0, config.minDelaySec),
      maxDelaySec: Math.max(config.minDelaySec, config.maxDelaySec),
      batchSize: Math.max(1, config.batchSize),
      batchCooldownSec: Math.max(0, config.batchCooldownSec),
      random: config.random ?? Math.random,
      now: config.now ?? Date.now,
      sleep: config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    };
  }

  get status(): CampaignStatus {
    return this.statusValue;
  }

  snapshot(): QueueSnapshot {
    return {
      status: this.statusValue,
      processed: this.index,
      total: this.items.length,
      sent: this.sent,
      failed: this.failed,
      invalid: this.invalid,
      currentIndex: this.index,
    };
  }

  start(): void {
    if (this.statusValue === "running" || this.statusValue === "paused") return;
    if (this.items.length === 0) {
      this.setStatus("completed");
      return;
    }
    this.index = 0;
    this.sent = 0;
    this.failed = 0;
    this.invalid = 0;
    const token = ++this.runToken;
    this.setStatus("running");
    void this.runLoop(token);
  }

  pause(): void {
    if (this.statusValue !== "running") return;
    this.setStatus("paused");
  }

  resume(): void {
    if (this.statusValue !== "paused") return;
    this.setStatus("running");
    this.wakeAll();
  }

  stop(): void {
    if (this.statusValue === "completed" || this.statusValue === "stopped") return;
    this.runToken += 1;
    this.setStatus("stopped");
    this.wakeAll();
  }

  private wakeAll(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private setStatus(status: CampaignStatus): void {
    this.statusValue = status;
    this.callbacks.onStateChange(status);
    this.callbacks.onProgress(this.snapshot());
  }

  private waitForWake(): Promise<void> {
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private isStopped(): boolean {
    return this.statusValue === "stopped";
  }

  private async waitWhilePaused(token: number): Promise<boolean> {
    while (this.statusValue === "paused" && token === this.runToken) {
      await this.waitForWake();
    }
    return this.statusValue === "running" && token === this.runToken;
  }

  private async sleep(ms: number, token: number): Promise<void> {
    if (ms <= 0 || token !== this.runToken) return;
    await Promise.race([this.config.sleep(ms), this.waitForWake()]);
  }

  private async runLoop(token: number): Promise<void> {
    try {
      while (this.index < this.items.length) {
        if (token !== this.runToken || this.statusValue === "stopped") return;
        if (!(await this.waitWhilePaused(token))) return;

        const item = this.items[this.index];
        if (!item) break;

        let result: QueueItemResult;
        try {
          result = await this.callbacks.onItem(item, this.index);
        } catch (error) {
          result = {
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          };
        }

        if (result.status === "sent") this.sent += 1;
        else if (result.status === "invalid") this.invalid += 1;
        else if (result.status === "failed") this.failed += 1;

        this.callbacks.onLog({
          index: this.index,
          phone: item.id,
          status: result.status,
          detail: result.detail ?? "",
          at: this.config.now(),
        });

        this.index += 1;
        this.callbacks.onProgress(this.snapshot());

        if (token !== this.runToken || this.isStopped()) return;
        if (this.index >= this.items.length) break;
        if (!(await this.waitWhilePaused(token))) return;

        if (this.index % this.config.batchSize === 0 && this.config.batchCooldownSec > 0) {
          this.callbacks.onCooldown?.(this.config.batchCooldownSec, this.index);
          await this.sleep(this.config.batchCooldownSec * 1000, token);
        } else {
          await this.sleep(computeDelayMs(this.config.minDelaySec, this.config.maxDelaySec, this.config.random), token);
        }
      }

      if (
        token === this.runToken &&
        this.index >= this.items.length &&
        (this.statusValue === "running" || this.statusValue === "paused")
      ) {
        this.setStatus("completed");
      }
    } catch (error) {
      if (token === this.runToken) {
        this.callbacks.onLog({
          index: this.index,
          phone: this.items[this.index]?.id ?? "",
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
          at: this.config.now(),
        });
        this.setStatus("stopped");
      }
    }
  }
}
