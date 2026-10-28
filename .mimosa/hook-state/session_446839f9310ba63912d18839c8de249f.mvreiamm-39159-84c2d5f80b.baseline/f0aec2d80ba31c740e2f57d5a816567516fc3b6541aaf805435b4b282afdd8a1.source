import type { PrivacySettings } from "../../shared/types";
import type { WppApi } from "../wpp";

export interface ReceiptGuardResult {
  active: boolean;
  patched: number;
  unsupported: number;
}

export interface PrivacyApplyResult {
  readReceipts: string;
  online: string;
  guard: ReceiptGuardResult;
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
  private lastResult: ReceiptGuardResult = { active: false, patched: 0, unsupported: 0 };
  private signature = "";

  sync(wpp: WppApi, flags: { audio: boolean; read: boolean }): ReceiptGuardResult {
    const signature = `${flags.audio ? 1 : 0}:${flags.read ? 1 : 0}`;
    if (signature === this.signature) return this.lastResult;

    this.restore();
    let patched = 0;
    let unsupported = 0;

    const attempt = (owner: Record<string, unknown> | undefined, key: string, replacement: (...args: unknown[]) => Promise<unknown>) => {
      if (!owner) {
        unsupported += 1;
        return;
      }
      if (this.patch(owner, key, replacement)) patched += 1;
      else unsupported += 1;
    };

    if (flags.audio) {
      attempt(wpp.chat as unknown as Record<string, unknown>, "markPlayed", async () => undefined);
      attempt(wpp.whatsapp?.functions, "markPlayed", async () => undefined);
    }
    if (flags.read) {
      attempt(wpp.chat as unknown as Record<string, unknown>, "markIsRead", async (chatId) => ({
        wid: chatId,
        unreadCount: 0,
      }));
      attempt(wpp.chat as unknown as Record<string, unknown>, "markMessageAsRead", async () => undefined);
      attempt(wpp.whatsapp?.functions, "markChatRead", async () => undefined);
    }

    this.signature = signature;
    this.lastResult = { active: patched > 0, patched, unsupported };
    return this.lastResult;
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
    this.lastResult = { active: false, patched: 0, unsupported: 0 };
  }
}

/**
 * Applies real WhatsApp account privacy settings where required (read receipts
 * and online visibility) and remembers the previous values so turning a
 * MadarWA toggle off restores the user's original account state.
 */
export class PrivacyController {
  private guard = new ReceiptGuard();
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
    await this.snapshot(wpp);

    if (settings.disableReadReceipts) {
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
      audio: settings.disableAudioReceipts,
      read: settings.disableReadReceipts,
    });

    return {
      readReceipts: this.currentRead ?? this.originalRead,
      online: this.currentOnline ?? this.originalOnline,
      guard,
      errors,
    };
  }
}
