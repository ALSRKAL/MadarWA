// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIDGE } from "../src/shared/constants";
import { BridgeClient, BridgeEngine } from "../src/shared/bridge/bridge";
import {
  BridgeProtocolError,
  decodeEnvelope,
  encodeEnvelope,
  type Handshake,
} from "../src/shared/bridge/protocol";

const origin = window.location.origin;
const sid = "a".repeat(32);
const key = "b".repeat(64);

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(action: () => void): string {
  try {
    action();
    return "";
  } catch (error) {
    return (error as { code?: string }).code ?? "";
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await wait(10);
  }
}

function createPair(
  commandHandler: (cmd: string, params: unknown) => Promise<unknown>,
  options: { requestTimeoutMs?: number } = {},
) {
  const engine = new BridgeEngine({ target: window, origin, commandHandler });
  const client = new BridgeClient({
    target: window,
    origin,
    handshakeRetryMs: 5,
    steadyHandshakeMs: 500,
    requestTimeoutMs: options.requestTimeoutMs ?? 1000,
    sessionFactory: () => ({ sid, key }),
  });
  client.start();
  cleanup.push(() => client.dispose());
  cleanup.push(() => engine.dispose());
  return { engine, client };
}

describe("bridge protocol", () => {
  it("round-trips Arabic payloads through the keyed envelope", () => {
    const payload = {
      reqId: "req-1",
      cmd: "message.send",
      params: { text: "مرحباً بالعالم 🌿", rows: Array.from({ length: 50 }, (_, i) => ({ i, name: `عميل ${i}` })) },
      ts: 1700000000000,
    };
    const raw = encodeEnvelope(key, sid, 7, "req", payload);
    const decoded = decodeEnvelope(key, sid, raw);

    expect(decoded.seq).toBe(7);
    expect(decoded.kind).toBe("req");
    expect(decoded.payload).toEqual(payload);
  });

  it("rejects a tampered payload with an authentication error", () => {
    const raw = encodeEnvelope(key, sid, 3, "req", { cmd: "x" });
    const parsed = JSON.parse(raw) as { b: string };
    const first = parsed.b.startsWith("A") ? "B" : "A";
    parsed.b = `${first}${parsed.b.slice(1)}`;
    expect(errorCode(() => decodeEnvelope(key, sid, JSON.stringify(parsed)))).toBe("AUTH");
  });

  it("rejects envelopes from another session", () => {
    const raw = encodeEnvelope(key, sid, 1, "req", { cmd: "x" });
    expect(errorCode(() => decodeEnvelope(key, "c".repeat(32), raw))).toBe("SESSION");
  });

  it("rejects malformed and oversized envelopes", () => {
    expect(errorCode(() => decodeEnvelope(key, sid, "not-json"))).toBe("MALFORMED");
    expect(errorCode(() => decodeEnvelope(key, sid, "x".repeat(BRIDGE.maxEnvelopeBytes + 1)))).toBe("TOO_LARGE");
  });
});

describe("bridge engine/client", () => {
  it("performs request/response with structured results", async () => {
    const { client } = createPair(async (cmd, params) => {
      if (cmd === "echo") return params;
      throw Object.assign(new Error("no such command"), { code: "NOPE" });
    });

    await client.waitForReady(1500);
    const result = await client.request<{ arabic: string }>("echo", { arabic: "أهلاً" });
    expect(result).toEqual({ arabic: "أهلاً" });

    await expect(client.request("missing", {})).rejects.toMatchObject({
      code: "NOPE",
      message: "no such command",
    });
  });

  it("times out unanswered requests and keeps the session alive", async () => {
    const { client } = createPair(
      async (cmd) => {
        if (cmd === "hang") return new Promise(() => undefined);
        return { ok: true };
      },
      { requestTimeoutMs: 800 },
    );

    await client.waitForReady(1500);
    await expect(client.request("hang", {}, 30)).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(client.request("quick", {}, 200)).resolves.toEqual({ ok: true });
  });

  it("streams authenticated engine events", async () => {
    const { engine, client } = createPair(async () => ({ ok: true }));
    await client.waitForReady(1500);

    const received: Array<{ event: string; data: unknown }> = [];
    const off = client.onEvent((event, data) => received.push({ event, data }));
    engine.emit("message.revoked", { chatName: "مجموعة العمل", text: "نص محذوف" });

    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({
      event: "message.revoked",
      data: { chatName: "مجموعة العمل", text: "نص محذوف" },
    });
    off();
  });

  it("ignores replayed command sequence numbers", async () => {
    let calls = 0;
    const engine = new BridgeEngine({
      target: window,
      origin,
      commandHandler: () => {
        calls += 1;
        return { ok: true };
      },
    });
    cleanup.push(() => engine.dispose());

    const replaySid = "c".repeat(32);
    const replayKey = "d".repeat(64);
    const handshake: Handshake = {
      v: 1,
      ns: "madarwa",
      sid: replaySid,
      key: replayKey,
      ts: Date.now(),
      origin,
    };
    window.dispatchEvent(new CustomEvent(BRIDGE.handshake, { detail: JSON.stringify(handshake) }));
    expect(engine.hasSession()).toBe(true);

    const request = encodeEnvelope(replayKey, replaySid, 1, "req", {
      reqId: "replay-1",
      cmd: "echo",
      params: {},
      ts: Date.now(),
    });
    window.dispatchEvent(new CustomEvent(BRIDGE.commandRequest, { detail: request }));
    window.dispatchEvent(new CustomEvent(BRIDGE.commandRequest, { detail: request }));
    await wait(40);
    expect(calls).toBe(1);
  });

  it("refuses handshakes from a foreign origin", async () => {
    const engine = new BridgeEngine({ target: window, origin, commandHandler: () => ({}) });
    cleanup.push(() => engine.dispose());

    const handshake: Handshake = {
      v: 1,
      ns: "madarwa",
      sid: "e".repeat(32),
      key: "f".repeat(64),
      ts: Date.now(),
      origin: "https://evil.example",
    };
    window.dispatchEvent(new CustomEvent(BRIDGE.handshake, { detail: JSON.stringify(handshake) }));
    expect(engine.hasSession()).toBe(false);
  });

  it("rejects requests before a handshake", async () => {
    const engine = new BridgeEngine({ target: window, origin, commandHandler: () => ({}) });
    cleanup.push(() => engine.dispose());

    const request = encodeEnvelope("a".repeat(64), "b".repeat(32), 1, "req", {
      reqId: "no-session",
      cmd: "echo",
      params: {},
      ts: Date.now(),
    });
    expect(() => {
      window.dispatchEvent(new CustomEvent(BRIDGE.commandRequest, { detail: request }));
    }).not.toThrow();
    expect(engine.hasSession()).toBe(false);
  });

  it("rejects pending requests when the client is disposed", async () => {
    const { client } = createPair(async () => new Promise(() => undefined));
    await client.waitForReady(1500);
    const pending = client.request("hang", {}, 5000);
    client.dispose();
    await expect(pending).rejects.toBeInstanceOf(BridgeProtocolError);
  });
});

describe("bridge liveness and recovery", () => {
  function throttledPair(commandHandler: (cmd: string, params: unknown) => Promise<unknown>) {
    const engine = new BridgeEngine({ target: window, origin, commandHandler });
    const client = new BridgeClient({
      target: window,
      origin,
      handshakeRetryMs: 500,
      steadyHandshakeMs: 3000,
      staleAfterMs: 15_000,
      sessionFactory: () => ({ sid, key }),
    });
    const changes: boolean[] = [];
    client.onConnectionChange((connected) => changes.push(connected));
    client.start();
    cleanup.push(() => client.dispose());
    cleanup.push(() => engine.dispose());
    return { engine, client, changes };
  }

  it("stays connected when a hidden tab throttles the heartbeat to once a minute", () => {
    vi.useFakeTimers();
    try {
      const { client, changes } = throttledPair(async () => ({ ok: true }));
      expect(client.isConnected()).toBe(true);

      // Chrome's intensive throttling: no timer runs for a minute, then one does.
      vi.setSystemTime(Date.now() + 60_000);
      vi.advanceTimersByTime(500);

      expect(client.isConnected()).toBe(true);
      expect(changes).toEqual([true]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("declares the connection lost only when the engine stops answering, and fails in-flight commands fast", async () => {
    vi.useFakeTimers();
    try {
      const { engine, client, changes } = throttledPair(async () => new Promise(() => undefined));
      const pending = client.request("hang", {}, 120_000);
      const outcome = pending.catch((error: unknown) => error);

      engine.dispose();
      vi.setSystemTime(Date.now() + 20_000);
      vi.advanceTimersByTime(500);

      expect(client.isConnected()).toBe(false);
      expect(changes).toEqual([true, false]);
      await expect(outcome).resolves.toMatchObject({ code: "CONNECTION_LOST" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a command during a short outage and sends it once the engine is back", async () => {
    const client = new BridgeClient({
      target: window,
      origin,
      handshakeRetryMs: 20,
      connectGraceMs: 1500,
      requestTimeoutMs: 1000,
      sessionFactory: () => ({ sid, key }),
    });
    client.start();
    cleanup.push(() => client.dispose());
    expect(client.isConnected()).toBe(false);

    const pending = client.request<{ echoed: string }>("echo", { echoed: "رسالة" });
    await wait(120);
    const engine = new BridgeEngine({ target: window, origin, commandHandler: async (_cmd, params) => params });
    cleanup.push(() => engine.dispose());

    await expect(pending).resolves.toEqual({ echoed: "رسالة" });
  });

  it("gives up with UNAVAILABLE after the grace period when no engine exists", async () => {
    const client = new BridgeClient({
      target: window,
      origin,
      handshakeRetryMs: 20,
      connectGraceMs: 80,
      sessionFactory: () => ({ sid, key }),
    });
    client.start();
    cleanup.push(() => client.dispose());
    await expect(client.request("anything", {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
