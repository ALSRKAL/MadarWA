import type { PrivacySettings } from "../../shared/types";
import type { WppApi } from "../wpp";
import { DeliveryReceiptGuard } from "./receipts";

export interface ReceiptGuardResult {
  active: boolean;
  patched: number;
  unsupported: number;
  audioActive: boolean;
  statusActive: boolean;
}

export interface PrivacyGuardResult extends ReceiptGuardResult {
  deliveryActive: boolean;
  deliveryPatched: number;
  deliveryUnsupported: number;
  deliveryModules: string[];
}

export interface PrivacyApplyResult {
  readReceipts: string;
  online: string;
  guard: PrivacyGuardResult;
  errors: string[];
}

interface GuardSlot {
  owner: Record<string, unknown>;
  key: string;
  original: PropertyDescriptor;
}

/**
 * Best-effort suppression of receipt calls emitted through the WPP API
 * surface. WhatsApp's own UI may bypass these wrappers depending on the
 * build; the result is reported to the UI so the user is never misled.
 */
class ReceiptGuard {
  private slots: GuardSlot[] = [];
  private lastResult: ReceiptGuardResult = {
    active: false,
    patched: 0,
    unsupported: 0,
    audioActive: false,
    statusActive: false,
  };
  private signature = "";

  sync(wpp: WppApi, flags: { audio: boolean; read: boolean; status: boolean }): ReceiptGuardResult {
    const signature = `${flags.audio ? 1 : 0}:${flags.read ? 1 : 0}:${flags.status ? 1 : 0}`;
    if (signature === this.signature) return this.lastResult;

    this.restore();
    let patched = 0;
    let unsupported = 0;
    let audioPatched = 0;
    let statusPatched = 0;

    const attempt = (
      owner: Record<string, unknown> | undefined,
      key: string,
      replacement: (...args: unknown[]) => Promise<unknown>,
      bucket?: "audio" | "status",
    ) => {
      if (!owner) {
        unsupported += 1;
        return;
      }
      if (this.patch(owner, key, replacement)) {
        patched += 1;
        if (bucket === "audio") audioPatched += 1;
        if (bucket === "status") statusPatched += 1;
      } else {
        unsupported += 1;
      }
    };

    if (flags.audio) {
      attempt(wpp.chat as unknown as Record<string, unknown>, "markPlayed", async () => undefined, "audio");
      attempt(wpp.whatsapp?.functions, "markPlayed", async () => undefined, "audio");
      const playedModule = wpp.loader?.loadModule?.("WAWebSendPlayedReceiptJob") as
        | Record<string, unknown>
        | undefined;
      if (playedModule && typeof playedModule.default === "function") {
        const playedNoop = (async () => undefined) as ((...args: unknown[]) => Promise<unknown>) & {
          __madarwa?: string;
        };
        playedNoop.__madarwa = "played-noop";
        attempt(playedModule, "default", playedNoop, "audio");
      }
    }
    if (flags.read) {
      attempt(wpp.chat as unknown as Record<string, unknown>, "markIsRead", async (chatId) =>
        this.clearLocalUnread(wpp, String(chatId)),
      );
      attempt(wpp.chat as unknown as Record<string, unknown>, "markMessageAsRead", async () => undefined);
      attempt(wpp.whatsapp?.functions, "markChatRead", async () => undefined);
    }
    if (flags.status) {
      const readModule = wpp.loader?.loadModule?.("WAWebSendReadReceiptJob") as
        | Record<string, unknown>
        | undefined;
      const statusNoop = (async () => undefined) as ((...args: unknown[]) => Promise<unknown>) & {
        __madarwa?: string;
      };
      statusNoop.__madarwa = "status-noop";
      attempt(readModule, "markStatusRead", statusNoop, "status");
    }

    this.signature = signature;
    this.lastResult = {
      active: patched > 0,
      patched,
      unsupported,
      audioActive: audioPatched > 0,
      statusActive: statusPatched > 0,
    };
    return this.lastResult;
  }

  /**
   * Clears the browser's unread counter without calling WhatsApp's read
   * receipt sender. The network receipt remains blocked by the guard.
   */
  private clearLocalUnread(wpp: WppApi, chatId: string): { wid: string; unreadCount: number } {
    try {
      const chat = wpp.chat.get(chatId);
      const update = wpp.whatsapp?.functions?.updateUnreadCountMD;
      if (chat && typeof update === "function") {
        (update as (...args: unknown[]) => unknown)(chat, 0, false);
      }
    } catch {
      // Local unread clearing is best effort; the network receipt stays blocked.
    }
    return { wid: chatId, unreadCount: 0 };
  }

  private patch(owner: Record<string, unknown>, key: string, replacement: (...args: unknown[]) => Promise<unknown>): boolean {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor) return false;
    try {
      if (descriptor.configurable) {
        Object.defineProperty(owner, key, {
          configurable: true,
          enumerable: descriptor.enumerable ?? true,
          writable: true,
          value: replacement,
        });
        this.slots.push({ owner, key, original: descriptor });
        return true;
      }
      if ("writable" in descriptor && descriptor.writable) {
        owner[key] = replacement;
        this.slots.push({ owner, key, original: descriptor });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  private restore(): void {
    for (const slot of this.slots.reverse()) {
      try {
        Object.defineProperty(slot.owner, slot.key, slot.original);
      } catch {
        // Non-restorable descriptor — leave the guard inactive.
      }
    }
    this.slots = [];
    this.lastResult = {
      active: false,
      patched: 0,
      unsupported: 0,
      audioActive: false,
      statusActive: false,
    };
  }
}

/**
 * Applies real WhatsApp account privacy settings where required (read receipts
 * and online visibility) and remembers the previous values so turning a
 * MadarWA toggle off restores the user's original account state.
 */
export class PrivacyController {
  private guard = new ReceiptGuard();
  private deliveryGuard = new DeliveryReceiptGuard();
  private currentRead: string | null = null;
  private currentOnline: string | null = null;
  private originalRead = "all";
  private originalOnline = "all";
  private snapshotLoaded = false;

  private async snapshot(wpp: WppApi): Promise<void> {
    if (this.snapshotLoaded) return;
    try {
      const privacy = await wpp.privacy.get();
      this.originalRead = privacy.readReceipts === "none" ? "none" : "all";
      this.originalOnline = privacy.online === "match_last_seen" ? "match_last_seen" : "all";
      this.snapshotLoaded = true;
    } catch {
      this.originalRead = "all";
      this.originalOnline = "all";
    }
  }

  async apply(wpp: WppApi, settings: PrivacySettings): Promise<PrivacyApplyResult> {
    const errors: string[] = [];
    const readOff = settings.disableReadReceipts || settings.suppressDeliveryReceipts;
    await this.snapshot(wpp);

    if (readOff) {
      if (this.currentRead !== "none") {
        try {
          await wpp.privacy.setReadReceipts("none");
          this.currentRead = "none";
        } catch (error) {
          errors.push(`readReceipts: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (this.currentRead === "none") {
      const restore = this.originalRead === "none" ? "none" : "all";
      try {
        await wpp.privacy.setReadReceipts(restore);
        this.currentRead = restore;
      } catch (error) {
        errors.push(`readReceipts: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (settings.hidePresence) {
      if (this.currentOnline !== "match_last_seen") {
        try {
          await wpp.privacy.setOnline("match_last_seen");
          this.currentOnline = "match_last_seen";
        } catch (error) {
          errors.push(`online: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (this.currentOnline === "match_last_seen") {
      const restore = this.originalOnline === "match_last_seen" ? "match_last_seen" : "all";
      try {
        await wpp.privacy.setOnline(restore);
        this.currentOnline = restore;
      } catch (error) {
        errors.push(`online: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const guard = this.guard.sync(wpp, {
      audio: settings.disableAudioReceipts || settings.suppressDeliveryReceipts,
      read: readOff,
      status: settings.privateStatusView,
    });
    const delivery = this.deliveryGuard.sync(wpp.loader?.loadModule, settings.suppressDeliveryReceipts);

    return {
      readReceipts: this.currentRead ?? this.originalRead,
      online: this.currentOnline ?? this.originalOnline,
      guard: {
        ...guard,
        deliveryActive: delivery.active,
        deliveryPatched: delivery.patched,
        deliveryUnsupported: delivery.unsupported,
        deliveryModules: delivery.modules,
      },
      errors,
    };
  }
}
