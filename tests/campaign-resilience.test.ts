// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { BroadcastManager } from "../src/content/broadcast";
import { emptyCampaign, useAppStore } from "../src/content/store";
import { BridgeProtocolError } from "../src/shared/bridge/protocol";
import { CAMPAIGN } from "../src/shared/constants";
import { createDefaultSettings } from "../src/shared/defaults";
import { tFor } from "../src/shared/i18n";
import type { AppSettings, CampaignRecipient } from "../src/shared/types";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await wait(5);
  }
}

function fakeBridge() {
  const state = {
    connected: true,
    calls: [] as Array<{ cmd: string; chatId: string }>,
    failures: [] as Array<unknown>,
    onCall: (() => undefined) as (count: number) => void,
  };
  return {
    state,
    bridge: {
      isConnected: () => state.connected,
      request: async <T,>(cmd: string, params: unknown): Promise<T> => {
        state.calls.push({ cmd, chatId: String((params as { chatId?: string }).chatId ?? "") });
        state.onCall(state.calls.length);
        const failure = state.failures.shift();
        if (failure) throw failure;
        return { id: "sent" } as T;
      },
    },
  };
}

function campaignSettings(): AppSettings {
  const defaults = createDefaultSettings();
  return {
    ...defaults,
    language: "en",
    broadcaster: {
      ...defaults.broadcaster,
      minDelaySec: 0,
      maxDelaySec: 0,
      batchSize: 100,
      batchCooldownSec: 0,
      validateNumbers: false,
    },
  };
}

function recipient(phone: string): CampaignRecipient {
  return { phone, chatId: `${phone}@c.us`, name: "", custom1: "", custom2: "", status: "pending", reason: "" };
}

function setWhatsApp(usable: boolean, state: { connected: boolean }): void {
  state.connected = usable;
  useAppStore.setState({
    bridgeConnected: usable,
    engine: { ready: true, connected: usable, wppVersion: "", me: "" },
  });
}

beforeEach(() => {
  useAppStore.setState({
    engine: { ready: true, connected: true, wppVersion: "", me: "" },
    bridgeConnected: true,
    campaign: emptyCampaign(),
    recipients: [],
    toasts: [],
  });
});

describe("campaign resilience", () => {
  it("auto-pauses while WhatsApp is unreachable and resumes without skipping anyone", async () => {
    const { bridge, state } = fakeBridge();
    const manager = new BroadcastManager(bridge);
    // WhatsApp drops right after the first message goes out.
    state.onCall = (count) => {
      if (count === 1) setWhatsApp(false, state);
    };

    const started = await manager.start({
      recipients: ["111111", "222222", "333333"].map(recipient),
      message: "hello",
      attachment: null,
      settings: campaignSettings(),
    });
    expect(started.ok).toBe(true);

    await waitFor(() => useAppStore.getState().campaign.waitingForConnection === true);
    expect(useAppStore.getState().campaign.status).toBe("paused");
    await wait(30);
    expect(state.calls).toHaveLength(1);

    setWhatsApp(true, state);
    await waitFor(() => useAppStore.getState().campaign.status === "completed");

    const campaign = useAppStore.getState().campaign;
    expect(campaign).toMatchObject({ sent: 3, failed: 0, waitingForConnection: false });
    expect(state.calls.map((call) => call.chatId)).toEqual(["111111@c.us", "222222@c.us", "333333@c.us"]);
  });

  it("retries a send that never reached WhatsApp, but never retries a timeout", async () => {
    const { bridge, state } = fakeBridge();
    state.failures = [
      new BridgeProtocolError("UNAVAILABLE", "MadarWA engine is not connected"),
      null,
      new BridgeProtocolError("TIMEOUT", "Command timed out: message.sendText"),
    ];
    const manager = new BroadcastManager(bridge);

    await manager.start({
      recipients: ["111111", "222222"].map(recipient),
      message: "hello",
      attachment: null,
      settings: campaignSettings(),
    });
    await waitFor(() => useAppStore.getState().campaign.status === "completed");

    expect(state.calls.map((call) => call.chatId)).toEqual(["111111@c.us", "111111@c.us", "222222@c.us"]);
    expect(useAppStore.getState().campaign).toMatchObject({ sent: 1, failed: 1 });
    const failed = manager.getRecipients().find((entry) => entry.phone === "222222");
    expect(failed?.status).toBe("failed");
    expect(failed?.reason).toBe(tFor("en")("errors.timeout"));
  });

  it("pauses for review after repeated per-recipient failures instead of stopping", async () => {
    const { bridge, state } = fakeBridge();
    state.failures = Array.from({ length: 10 }, () => new BridgeProtocolError("ENGINE_ERROR", "send rejected"));
    const manager = new BroadcastManager(bridge);

    await manager.start({
      recipients: ["1111111", "2222222", "3333333", "4444444", "5555555", "6666666", "7777777"].map(recipient),
      message: "hello",
      attachment: null,
      settings: campaignSettings(),
    });
    await waitFor(() => useAppStore.getState().campaign.status === "paused");
    await wait(30);

    expect(state.calls).toHaveLength(CAMPAIGN.maxConsecutiveFailures);
    expect(useAppStore.getState().toasts[0]?.title).toBe(
      tFor("en")("broadcaster.pausedAfterFailures", { count: CAMPAIGN.maxConsecutiveFailures }),
    );

    manager.stop();
    await waitFor(() => useAppStore.getState().campaign.status === "stopped");
  });
});
