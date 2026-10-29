import { describe, expect, it } from "vitest";
import type { CampaignLogEntry, CampaignStatus } from "../src/shared/types";
import { BroadcastQueue, computeDelayMs, type QueueItemResult } from "../src/shared/utils/queue";

const items = ["1", "2", "3", "4", "5"].map((id) => ({ id, data: id }));

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await wait(5);
  }
}

describe("anti-ban delay", () => {
  it("keeps jitter within the configured bounds", () => {
    expect(computeDelayMs(6, 15, () => 0)).toBe(6000);
    expect(computeDelayMs(6, 15, () => 0.5)).toBe(10500);
    expect(computeDelayMs(6, 15, () => 0.999999)).toBe(15000);
    expect(computeDelayMs(15, 6, () => 0)).toBe(15000);
  });
});

describe("broadcast queue", () => {
  it("processes sequentially with jitter and batch cooldowns", async () => {
    const sleeps: number[] = [];
    const logs: CampaignLogEntry[] = [];
    const states: CampaignStatus[] = [];
    const cooldowns: number[] = [];
    const processed: string[] = [];

    const queue = new BroadcastQueue<string>(
      items,
      {
        minDelaySec: 1,
        maxDelaySec: 3,
        batchSize: 2,
        batchCooldownSec: 2,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 1000,
      },
      {
        onItem: async (item): Promise<QueueItemResult> => {
          processed.push(item.id);
          return { status: "sent", detail: "ok" };
        },
        onProgress: () => undefined,
        onLog: (entry) => logs.push(entry),
        onStateChange: (status) => states.push(status),
        onCooldown: (seconds) => cooldowns.push(seconds),
      },
    );

    queue.start();
    await waitFor(() => queue.status === "completed");

    expect(processed).toEqual(["1", "2", "3", "4", "5"]);
    expect(sleeps).toEqual([2000, 2000, 2000, 2000]);
    expect(cooldowns).toEqual([2, 2]);
    expect(logs).toHaveLength(5);
    expect(queue.snapshot()).toMatchObject({
      status: "completed",
      processed: 5,
      sent: 5,
      failed: 0,
      invalid: 0,
    });
    expect(states).toEqual(["running", "completed"]);
  });

  it("pauses after the current message and resumes without losing the queue", async () => {
    const processed: string[] = [];
    let queue: BroadcastQueue<string>;
    const states: CampaignStatus[] = [];

    queue = new BroadcastQueue<string>(
      items.slice(0, 3),
      {
        minDelaySec: 1,
        maxDelaySec: 1,
        batchSize: 10,
        batchCooldownSec: 0,
        sleep: async () => undefined,
      },
      {
        onItem: async (item) => {
          processed.push(item.id);
          if (item.id === "2") queue.pause();
          return { status: "sent" };
        },
        onProgress: () => undefined,
        onLog: () => undefined,
        onStateChange: (status) => states.push(status),
      },
    );

    queue.start();
    await waitFor(() => queue.status === "paused");
    expect(processed).toEqual(["1", "2"]);
    await wait(20);
    expect(processed).toEqual(["1", "2"]);

    queue.resume();
    await waitFor(() => queue.status === "completed");
    expect(processed).toEqual(["1", "2", "3"]);
    expect(states).toEqual(["running", "paused", "running", "completed"]);
  });

  it("stops immediately and does not process the remaining items", async () => {
    const processed: string[] = [];
    let queue: BroadcastQueue<string>;

    queue = new BroadcastQueue<string>(
      items,
      {
        minDelaySec: 1,
        maxDelaySec: 1,
        batchSize: 10,
        batchCooldownSec: 0,
        sleep: async () => undefined,
      },
      {
        onItem: async (item) => {
          processed.push(item.id);
          if (item.id === "1") queue.stop();
          return { status: "sent" };
        },
        onProgress: () => undefined,
        onLog: () => undefined,
        onStateChange: () => undefined,
      },
    );

    queue.start();
    await waitFor(() => queue.status === "stopped");
    await wait(20);
    expect(processed).toEqual(["1"]);
    expect(queue.snapshot().processed).toBe(1);
    expect(queue.snapshot().sent).toBe(1);
  });

  it("records failures and continues", async () => {
    const statuses: string[] = [];
    const queue = new BroadcastQueue<string>(
      items.slice(0, 3),
      {
        minDelaySec: 0,
        maxDelaySec: 0,
        batchSize: 10,
        batchCooldownSec: 0,
        sleep: async () => undefined,
      },
      {
        onItem: async (item) => {
          if (item.id === "2") throw new Error("network down");
          statuses.push(item.id);
          return { status: "failed", detail: "rejected" };
        },
        onProgress: () => undefined,
        onLog: () => undefined,
        onStateChange: () => undefined,
      },
    );

    queue.start();
    await waitFor(() => queue.status === "completed");
    expect(statuses).toEqual(["1", "3"]);
    expect(queue.snapshot()).toMatchObject({ processed: 3, sent: 0, failed: 3 });
  });

  it("keeps the remaining anti-ban delay when paused and resumed mid-delay", async () => {
    let clock = 0;
    const timers: Array<{ until: number; resolve: () => void }> = [];
    const advance = (ms: number) => {
      clock += ms;
      for (const timer of [...timers]) {
        if (timer.until > clock) continue;
        timers.splice(timers.indexOf(timer), 1);
        timer.resolve();
      }
    };
    const sentAt: number[] = [];

    const queue = new BroadcastQueue<string>(
      items.slice(0, 2),
      {
        minDelaySec: 10,
        maxDelaySec: 10,
        batchSize: 10,
        batchCooldownSec: 0,
        now: () => clock,
        sleep: (ms) => new Promise<void>((resolve) => timers.push({ until: clock + ms, resolve })),
      },
      {
        onItem: async () => {
          sentAt.push(clock);
          return { status: "sent" };
        },
        onProgress: () => undefined,
        onLog: () => undefined,
        onStateChange: () => undefined,
      },
    );

    queue.start();
    await waitFor(() => sentAt.length === 1 && timers.length === 1);
    advance(3000);
    queue.pause();
    advance(1000);
    queue.resume();
    await wait(20);
    // Resuming 4s into a 10s delay must not send at once.
    expect(sentAt).toEqual([0]);

    advance(6000);
    await waitFor(() => sentAt.length === 2);
    expect(sentAt).toEqual([0, 10_000]);
  });

  it("completes synchronously for an empty queue", () => {
    const queue = new BroadcastQueue<string>(
      [],
      { minDelaySec: 1, maxDelaySec: 2, batchSize: 10, batchCooldownSec: 0 },
      {
        onItem: async () => ({ status: "sent" }),
        onProgress: () => undefined,
        onLog: () => undefined,
        onStateChange: () => undefined,
      },
    );
    queue.start();
    expect(queue.status).toBe("completed");
  });
});
