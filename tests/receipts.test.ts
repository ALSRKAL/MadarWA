import { describe, expect, it } from "vitest";
import { DeliveryReceiptGuard } from "../src/injected/modules/receipts";
import { PrivacyController } from "../src/injected/modules/privacy";
import type { WppApi } from "../src/injected/wpp";
import { createDefaultSettings } from "../src/shared/defaults";

function makeModules() {
  const calls = {
    delivery: 0,
    offline: 0,
    aggregateDelivery: 0,
    aggregate: [] as unknown[],
    played: 0,
    handle: 0,
  };
  const delivery = {
    sendDeliveryReceiptsAfterDecryption: (_payload?: unknown) => {
      calls.delivery += 1;
    },
  };
  const offline = {
    sendAggregateOfflineReceipts: (_payload?: unknown) => {
      calls.offline += 1;
    },
  };
  const aggregateDelivery = {
    aggregateDeliveryReceipts: (_payload?: unknown) => {
      calls.aggregateDelivery += 1;
    },
  };
  const common = {
    RECEIPT_TYPE: { DELIVERY: "delivery", READ: "read" },
    sendAggregateReceipts: (payload?: unknown) => {
      calls.aggregate.push(payload);
    },
  };
  const modules: Record<string, unknown> = {
    WAWebSendDeliveryReceiptJob: delivery,
    WAWebSendOfflineDeliveryReceiptJob: offline,
    WAWebSendAggregateDeliveryReceipts: aggregateDelivery,
    WAWebSendReceiptJobCommon: common,
  };
  return { modules, calls, delivery, offline, aggregateDelivery, common };
}

const loadFrom = (modules: Record<string, unknown>) => (name: string) => modules[name];

describe("delivery receipt guard", () => {
  it("blocks delivery receipts while leaving read receipts untouched", () => {
    const { modules, calls, delivery, offline, aggregateDelivery, common } = makeModules();
    const guard = new DeliveryReceiptGuard();
    const result = guard.sync(loadFrom(modules), true);

    expect(result.active).toBe(true);
    expect(result.patched).toBe(4);
    expect(result.unsupported).toBe(0);
    expect(result.modules).toContain("WAWebSendDeliveryReceiptJob.sendDeliveryReceiptsAfterDecryption");
    expect(result.modules).toContain("WAWebSendReceiptJobCommon.sendAggregateReceipts");

    delivery.sendDeliveryReceiptsAfterDecryption({});
    offline.sendAggregateOfflineReceipts({});
    aggregateDelivery.aggregateDeliveryReceipts({});
    expect(calls.delivery).toBe(0);
    expect(calls.offline).toBe(0);
    expect(calls.aggregateDelivery).toBe(0);

    for (const type of ["delivery", "read", "read-self", "read_self", "inactive", "played", "played-self", "sender"]) {
      common.sendAggregateReceipts({ receiptType: type });
      common.sendAggregateReceipts({ type });
      common.sendAggregateReceipts({ receipts: [{ type }] });
    }
    common.sendAggregateReceipts({});
    expect(calls.aggregate).toHaveLength(0);

    common.sendAggregateReceipts({ receiptType: "history-sync-completion" });
    common.sendAggregateReceipts({ receiptType: "server-error" });
    expect(calls.aggregate).toHaveLength(2);
    expect((delivery.sendDeliveryReceiptsAfterDecryption as unknown as { __madarwa?: string }).__madarwa).toBe(
      "delivery-noop",
    );
    expect((common.sendAggregateReceipts as unknown as { __madarwa?: string }).__madarwa).toBe("receipt-filter");
  });

  it("blocks the high-level receipt handler when present", () => {
    const { modules, calls, delivery } = makeModules();
    const handle = {
      sendReceipt: (_a?: unknown, _b?: unknown, _c?: unknown, _d?: unknown) => {
        calls.handle += 1;
      },
    };
    modules.WAWebHandleMsgSendReceipt = handle;
    const guard = new DeliveryReceiptGuard();
    const result = guard.sync(loadFrom(modules), true);

    expect(result.patched).toBe(5);
    expect(result.modules).toContain("WAWebHandleMsgSendReceipt.sendReceipt");

    handle.sendReceipt({}, {}, {}, {});
    expect(calls.handle).toBe(0);

    guard.sync(loadFrom(modules), false);
    handle.sendReceipt({}, {}, {}, {});
    expect(calls.handle).toBe(1);
    expect(delivery).toBeTruthy();
  });

  it("restores the original WhatsApp functions when disabled", () => {
    const { modules, calls, delivery, common } = makeModules();
    const original = delivery.sendDeliveryReceiptsAfterDecryption;
    const guard = new DeliveryReceiptGuard();

    guard.sync(loadFrom(modules), true);
    expect(delivery.sendDeliveryReceiptsAfterDecryption).not.toBe(original);

    const result = guard.sync(loadFrom(modules), false);
    expect(result.active).toBe(false);
    expect(delivery.sendDeliveryReceiptsAfterDecryption).toBe(original);

    delivery.sendDeliveryReceiptsAfterDecryption({});
    common.sendAggregateReceipts({ receiptType: "delivery" });
    expect(calls.delivery).toBe(1);
    expect(calls.aggregate).toHaveLength(1);
  });

  it("is idempotent and reports unsupported builds", () => {
    const { modules, calls, delivery } = makeModules();
    const guard = new DeliveryReceiptGuard();
    guard.sync(loadFrom(modules), true);
    const second = guard.sync(loadFrom(modules), true);
    expect(second.patched).toBe(4);
    delivery.sendDeliveryReceiptsAfterDecryption({});
    expect(calls.delivery).toBe(0);

    const missing = new DeliveryReceiptGuard();
    const result = missing.sync(undefined, true);
    expect(result.active).toBe(false);
    expect(result.unsupported).toBeGreaterThan(0);
  });
});

describe("privacy controller stealth integration", () => {
  it("enables read-receipt privacy and the delivery guard together", async () => {
    const { modules, calls } = makeModules();
    const privacyCalls: string[] = [];
    let localClears = 0;
    let networkReads = 0;
    const wpp = {
      loader: { loadModule: loadFrom(modules) },
      privacy: {
        get: async () => ({ readReceipts: "all", online: "all" }),
        setReadReceipts: async (value: string) => {
          privacyCalls.push(`read:${value}`);
          return value;
        },
        setOnline: async (value: string) => {
          privacyCalls.push(`online:${value}`);
          return value;
        },
      },
      chat: {
        get: (chatId: string) => ({ id: chatId }),
        markIsRead: async () => {
          networkReads += 1;
          return { wid: "", unreadCount: 0 };
        },
        markMessageAsRead: async () => {
          networkReads += 1;
        },
        markPlayed: async () => undefined,
      },
      whatsapp: {
        functions: {
          markChatRead: async () => {
            networkReads += 1;
          },
          markPlayed: async () => undefined,
          updateUnreadCountMD: () => {
            localClears += 1;
          },
        },
      },
    } as unknown as WppApi;

    const controller = new PrivacyController();
    const settings = createDefaultSettings().privacy;
    const on = await controller.apply(wpp, {
      ...settings,
      disableReadReceipts: false,
      suppressDeliveryReceipts: true,
    });

    expect(privacyCalls).toContain("read:none");
    expect(on.guard.deliveryActive).toBe(true);
    expect(on.guard.deliveryPatched).toBe(4);

    await (wpp.chat.markIsRead as unknown as (id: string) => Promise<unknown>)("chat-1");
    expect(localClears).toBe(1);
    expect(networkReads).toBe(0);

    const off = await controller.apply(wpp, { ...settings });
    expect(privacyCalls).toContain("read:all");
    expect(off.guard.deliveryActive).toBe(false);
    expect(calls.delivery).toBe(0);
  });

  it("suppresses native played and status receipts independently", async () => {
    const { modules } = makeModules();
    let playedCalls = 0;
    let statusCalls = 0;
    const playedModule = {
      default: () => {
        playedCalls += 1;
      },
    };
    const readModule = {
      markStatusRead: () => {
        statusCalls += 1;
      },
    };
    const allModules: Record<string, unknown> = {
      ...modules,
      WAWebSendPlayedReceiptJob: playedModule,
      WAWebSendReadReceiptJob: readModule,
    };
    const wpp = {
      loader: { loadModule: (name: string) => allModules[name] },
      privacy: {
        get: async () => ({ readReceipts: "all", online: "all" }),
        setReadReceipts: async (value: string) => value,
        setOnline: async (value: string) => value,
      },
      chat: {
        get: (chatId: string) => ({ id: chatId }),
        markIsRead: async () => undefined,
        markMessageAsRead: async () => undefined,
        markPlayed: async () => undefined,
      },
      whatsapp: {
        functions: {
          markChatRead: async () => undefined,
          markPlayed: async () => undefined,
          updateUnreadCountMD: () => undefined,
        },
      },
    } as unknown as WppApi;

    const controller = new PrivacyController();
    const settings = createDefaultSettings().privacy;
    const on = await controller.apply(wpp, {
      ...settings,
      disableAudioReceipts: true,
      privateStatusView: true,
    });
    expect(on.guard.audioActive).toBe(true);
    expect(on.guard.statusActive).toBe(true);
    expect((playedModule.default as unknown as { __madarwa?: string }).__madarwa).toBe("played-noop");
    expect((readModule.markStatusRead as unknown as { __madarwa?: string }).__madarwa).toBe("status-noop");

    playedModule.default();
    readModule.markStatusRead();
    expect(playedCalls).toBe(0);
    expect(statusCalls).toBe(0);

    const off = await controller.apply(wpp, { ...settings });
    expect(off.guard.audioActive).toBe(false);
    expect(off.guard.statusActive).toBe(false);

    playedModule.default();
    readModule.markStatusRead();
    expect(playedCalls).toBe(1);
    expect(statusCalls).toBe(1);
  });
});
