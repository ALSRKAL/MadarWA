import { BRIDGE_COMMANDS, CAMPAIGN, UI_LIMITS } from "../shared/constants";
import { describeError, isTransportError } from "../shared/errors";
import { tFor } from "../shared/i18n";
import type {
  AppSettings,
  BroadcasterSettings,
  CampaignRecipient,
  RecipientStatus,
} from "../shared/types";
import { normalizeRecipientTarget } from "../shared/utils/phone";
import { BroadcastQueue, type QueueItemResult } from "../shared/utils/queue";
import { personalizeMessage } from "../shared/utils/template";
import { emptyCampaign, useAppStore } from "./store";

export interface BroadcastBridge {
  request: <T>(cmd: string, params: unknown, timeoutMs?: number) => Promise<T>;
  isConnected: () => boolean;
}

export interface Attachment {
  name: string;
  mimetype: string;
  dataUrl: string;
  type: "image" | "video" | "audio" | "document" | "sticker";
}

export interface StartCampaignInput {
  recipients: CampaignRecipient[];
  message: string;
  attachment: Attachment | null;
  settings: AppSettings;
}

interface ValidationResponse {
  exists: boolean;
  chatId: string;
  error: string;
}

type Translate = (key: string, variables?: Record<string, unknown>) => string;

function failureReason(error: unknown, t: Translate): string {
  const { title, detail } = describeError(error, t);
  return detail ? `${title} (${detail})` : title;
}

export function parseManualRecipients(text: string, defaultCountryCode = ""): {
  recipients: CampaignRecipient[];
  invalid: number;
  duplicates: number;
} {
  const seen = new Set<string>();
  const recipients: CampaignRecipient[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const line of text.split(/\r?\n/)) {
    if (recipients.length >= UI_LIMITS.maxCampaignRecipients) break;
    const raw = line.trim();
    if (!raw) continue;
    const parts = raw.split(/[,;\t]/);
    const phoneRaw = parts[0] ?? "";
    const name = (parts[1] ?? "").trim();
    const custom1 = (parts[2] ?? "").trim();
    const custom2 = (parts[3] ?? "").trim();
    const sanitized = normalizeRecipientTarget(phoneRaw, defaultCountryCode);
    if (!sanitized.valid) {
      invalid += 1;
      continue;
    }
    if (seen.has(sanitized.chatId)) {
      duplicates += 1;
      continue;
    }
    seen.add(sanitized.chatId);
    recipients.push({
      phone: sanitized.digits,
      chatId: sanitized.chatId,
      name,
      custom1,
      custom2,
      status: "pending",
      reason: "",
    });
  }

  return { recipients, invalid, duplicates };
}

function attachmentType(mimetype: string): Attachment["type"] {
  if (mimetype.startsWith("image/")) return mimetype.includes("webp") ? "sticker" : "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
}

export function inferAttachment(name: string, mimetype: string, dataUrl: string): Attachment {
  return { name, mimetype, dataUrl, type: attachmentType(mimetype) };
}

export function attachmentSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((payload.length * 3) / 4);
}

/**
 * Owns the anti-ban queue and converts UI input into real WA-Web sends.
 * The campaign runs independently of React tab switches.
 */
export class BroadcastManager {
  private readonly bridge: BroadcastBridge;
  private queue: BroadcastQueue<{ index: number; recipient: CampaignRecipient }> | null = null;
  private recipients: CampaignRecipient[] = [];
  private validationAbort = false;
  private validationInvalid = 0;
  private validationFailed = 0;
  private consecutiveFailures = 0;
  private flushTimer = 0;
  private busy = false;
  private stopRequested = false;
  private userPaused = false;

  constructor(bridge: BroadcastBridge) {
    this.bridge = bridge;
  }

  isBusy(): boolean {
    const status = useAppStore.getState().campaign.status;
    return status === "running" || status === "paused" || this.busy;
  }

  async start(input: StartCampaignInput): Promise<{ ok: boolean; error?: string }> {
    const t = tFor(input.settings.language);
    if (this.isBusy()) return { ok: false, error: t("errors.generic") };

    const message = input.message.trim();
    if (!input.recipients.length) return { ok: false, error: t("broadcaster.noRecipients") };
    if (!message && !input.attachment) return { ok: false, error: t("broadcaster.noMessage") };
    if (message.length > 4096) return { ok: false, error: t("broadcaster.longMessage") };
    if (input.attachment && attachmentSize(input.attachment.dataUrl) > CAMPAIGN.maxAttachmentBytes) {
      return { ok: false, error: t("broadcaster.attachmentTooLarge", { size: "4 MB" }) };
    }
    if (!this.isUsable()) return { ok: false, error: t("errors.bridgeUnavailable") };

    this.busy = true;
    this.stopRequested = false;
    this.userPaused = false;
    this.validationAbort = false;
    this.validationInvalid = 0;
    this.validationFailed = 0;
    this.consecutiveFailures = 0;
    this.recipients = input.recipients.map((recipient) => ({
      ...recipient,
      status: "pending" as RecipientStatus,
      reason: "",
    }));

    const store = useAppStore.getState();
    store.setRecipients(this.recipients.slice());
    store.setCampaign({
      ...emptyCampaign(),
      id: `campaign-${Date.now()}`,
      status: "running",
      total: this.recipients.length,
      startedAt: Date.now(),
    });
    store.setValidation({ active: Boolean(input.settings.broadcaster.validateNumbers), current: 0, total: this.recipients.length });

    void this.runCampaign(input, t);
    return { ok: true };
  }

  private async runCampaign(
    input: StartCampaignInput,
    t: (key: string, variables?: Record<string, unknown>) => string,
  ): Promise<void> {
    const store = useAppStore.getState();
    try {
      if (input.settings.broadcaster.validateNumbers) {
        const ok = await this.validateAll(t);
        if (!ok) {
          this.finishStopped(t);
          return;
        }
      }

      store.setValidation({ active: false, current: 0, total: 0 });
      const valid = this.recipients
        .map((recipient, index) => ({ recipient, index }))
        .filter(({ recipient }) => recipient.status === "pending");

      const invalid = this.recipients.filter((recipient) => recipient.status === "invalid").length;
      const failed = this.recipients.filter((recipient) => recipient.status === "failed").length;
      store.patchCampaign({
        invalid,
        failed,
        processed: invalid + failed,
      });

      if (valid.length === 0) {
        this.finishCompleted(0, failed, invalid, t);
        return;
      }

      const settings: BroadcasterSettings = input.settings.broadcaster;
      const queue = new BroadcastQueue(
        valid.map((entry) => ({ id: entry.recipient.phone, data: entry })),
        {
          minDelaySec: settings.minDelaySec,
          maxDelaySec: settings.maxDelaySec,
          batchSize: settings.batchSize,
          batchCooldownSec: settings.batchCooldownSec,
        },
        {
          onItem: (item) => this.sendOne(item.data.index, input, t),
          onLog: (entry) => useAppStore.getState().appendCampaignLog(entry),
          onProgress: (snapshot) => {
            useAppStore.getState().patchCampaign({
              status: snapshot.status,
              processed: snapshot.processed + invalid + failed,
              sent: snapshot.sent,
              failed: snapshot.failed + failed,
              invalid,
              total: this.recipients.length,
            });
          },
          onStateChange: (status) => {
            useAppStore.getState().patchCampaign({ status });
            if (status === "completed") {
              this.busy = false;
              this.flushRecipients(true);
              const latest = useAppStore.getState().campaign;
              useAppStore.getState().patchCampaign({ finishedAt: Date.now() });
              useAppStore.getState().pushToast({
                kind: "success",
                title: t("broadcaster.finished"),
                body: t("toast.campaignComplete", { sent: latest.sent, failed: latest.failed }),
              });
            } else if (status === "stopped") {
              this.busy = false;
              this.flushRecipients(true);
              useAppStore.getState().patchCampaign({ finishedAt: Date.now() });
              useAppStore.getState().pushToast({
                kind: "info",
                title: t("broadcaster.stopped"),
                body: "",
              });
            }
          },
          onCooldown: (seconds, nextIndex) => {
            useAppStore.getState().pushToast({
              kind: "info",
              title: t("broadcaster.antiBanSection"),
              body: t("broadcaster.cooldown", { seconds, count: nextIndex }),
            });
          },
        },
      );

      this.queue = queue;
      queue.start();
    } catch (error) {
      this.busy = false;
      this.queue = null;
      useAppStore.getState().setValidation({ active: false, current: 0, total: 0 });
      useAppStore.getState().patchCampaign({ status: "stopped", finishedAt: Date.now() });
      useAppStore.getState().pushToast({
        kind: "error",
        title: t("errors.generic"),
        body: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      });
    }
  }

  private async validateAll(t: (key: string, variables?: Record<string, unknown>) => string): Promise<boolean> {
    const store = useAppStore.getState();
    for (let index = 0; index < this.recipients.length; index += 1) {
      if (this.validationAbort) return false;
      const recipient = this.recipients[index];
      if (!recipient) continue;
      store.setValidation({ active: true, current: index + 1, total: this.recipients.length });
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await this.bridge.request<ValidationResponse>(
            BRIDGE_COMMANDS.validateContact,
            { chatId: recipient.chatId },
            25_000,
          );
          if (!result.exists) {
            recipient.status = "invalid";
            recipient.reason = t("errors.numberNotOnWhatsapp");
            this.validationInvalid += 1;
            store.appendCampaignLog({
              index,
              phone: recipient.phone,
              status: "invalid",
              detail: recipient.reason,
              at: Date.now(),
            });
          } else if (result.chatId) {
            recipient.chatId = result.chatId;
          }
          break;
        } catch (error) {
          // A lookup is read-only, so retrying after an outage is always safe.
          if (isTransportError(error) && attempt < CAMPAIGN.maxTransportRetries) {
            if (!(await this.holdForConnection(t))) return false;
            continue;
          }
          recipient.status = "failed";
          recipient.reason = failureReason(error, t);
          this.validationFailed += 1;
          store.appendCampaignLog({
            index,
            phone: recipient.phone,
            status: "failed",
            detail: recipient.reason,
            at: Date.now(),
          });
          break;
        }
      }
      if ((index + 1) % 10 === 0) this.flushRecipients(true);
    }
    this.flushRecipients(true);
    store.patchCampaign({
      invalid: this.validationInvalid,
      failed: this.validationFailed,
      processed: this.validationInvalid + this.validationFailed,
      total: this.recipients.length,
    });
    store.pushToast({
      kind: "success",
      title: t("broadcaster.validationDone"),
      body: t("broadcaster.parsedCount", { count: this.recipients.length - this.validationInvalid - this.validationFailed }),
    });
    return true;
  }

  private async sendOne(
    index: number,
    input: StartCampaignInput,
    t: (key: string, variables?: Record<string, unknown>) => string,
  ): Promise<QueueItemResult> {
    const recipient = this.recipients[index];
    if (!recipient) return { status: "skipped", detail: "missing" };
    recipient.status = "sending";
    this.flushRecipients();

    const text = personalizeMessage(input.message, {
      variables: {
        name: recipient.name,
        custom1: recipient.custom1,
        custom2: recipient.custom2,
        phone: recipient.phone,
      },
      enableSpintax: input.settings.broadcaster.randomizeWithSpintax,
    });

    for (let attempt = 0; ; attempt += 1) {
      // Never fire into a dead connection: hold the campaign until WhatsApp is back.
      if (!(await this.holdForConnection(t))) {
        recipient.status = "pending";
        this.flushRecipients();
        return { status: "skipped", detail: t("broadcaster.stopped") };
      }
      try {
        if (input.attachment) {
          const supportsCaption = ["image", "video", "document"].includes(input.attachment.type);
          await this.bridge.request(
            BRIDGE_COMMANDS.sendFile,
            {
              chatId: recipient.chatId,
              dataUrl: input.attachment.dataUrl,
              type: input.attachment.type,
              caption: supportsCaption ? text : "",
              filename: input.attachment.name,
              mimetype: input.attachment.mimetype,
            },
            120_000,
          );
        } else {
          await this.bridge.request(
            BRIDGE_COMMANDS.sendText,
            { chatId: recipient.chatId, text },
            60_000,
          );
        }
        recipient.status = "sent";
        recipient.reason = "";
        this.consecutiveFailures = 0;
        this.flushRecipients();
        return { status: "sent", detail: "ok" };
      } catch (error) {
        // The command never reached WhatsApp, so a retry cannot double-send.
        // Timeouts are not retried: the message may already be on its way.
        if (isTransportError(error) && attempt < CAMPAIGN.maxTransportRetries) continue;

        recipient.status = "failed";
        recipient.reason = failureReason(error, t);
        this.consecutiveFailures += 1;
        this.flushRecipients();
        if (this.consecutiveFailures >= CAMPAIGN.maxConsecutiveFailures && this.queue?.status === "running") {
          // A run of failures usually means a account-level problem; stop
          // hammering WhatsApp and let the user review before resuming.
          this.consecutiveFailures = 0;
          this.userPaused = true;
          this.queue.pause();
          useAppStore.getState().pushToast({
            kind: "error",
            title: t("broadcaster.pausedAfterFailures", { count: CAMPAIGN.maxConsecutiveFailures }),
            body: recipient.reason,
          });
        }
        return { status: "failed", detail: recipient.reason };
      }
    }
  }

  /** Bridge connected and WhatsApp loaded and logged in. */
  private isUsable(): boolean {
    const { engine } = useAppStore.getState();
    return this.bridge.isConnected() && engine.ready && engine.connected;
  }

  private waitForUsable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      let timer = 0;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        window.clearInterval(timer);
        resolve(value);
      };
      const check = () => {
        if (this.stopRequested || this.validationAbort) finish(false);
        else if (this.isUsable()) finish(true);
      };
      unsubscribe = useAppStore.subscribe(check);
      timer = window.setInterval(check, CAMPAIGN.connectionPollMs);
      check();
    });
  }

  /**
   * Auto-pause while WhatsApp is unreachable and auto-resume when it is back,
   * unless the user paused meanwhile. Resolves to false if the campaign was
   * stopped while waiting.
   */
  private async holdForConnection(t: Translate): Promise<boolean> {
    if (this.stopRequested || this.validationAbort) return false;
    if (this.isUsable()) return true;

    const queue = this.queue;
    if (queue?.status === "running") queue.pause();
    const store = useAppStore.getState();
    store.patchCampaign({ waitingForConnection: true });
    store.pushToast({ kind: "info", title: t("broadcaster.autoPaused"), body: t("broadcaster.autoPausedBody") });

    const usable = await this.waitForUsable();
    useAppStore.getState().patchCampaign({ waitingForConnection: false });
    if (!usable) return false;

    if (queue && queue === this.queue && queue.status === "paused") {
      if (this.userPaused) return this.waitForUserResume();
      queue.resume();
    }
    useAppStore.getState().pushToast({ kind: "success", title: t("broadcaster.autoResumed"), body: "" });
    return true;
  }

  /** The user paused during an outage: send nothing until they resume or stop. */
  private waitForUserResume(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const unsubscribe = useAppStore.subscribe((state) => {
        if (this.stopRequested || state.campaign.status === "stopped") {
          unsubscribe();
          resolve(false);
        } else if (state.campaign.status === "running") {
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  private flushRecipients(force = false): void {
    if (force) {
      if (this.flushTimer) window.clearTimeout(this.flushTimer);
      this.flushTimer = 0;
      useAppStore.getState().setRecipients(this.recipients.slice(0, 5000));
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      useAppStore.getState().setRecipients(this.recipients.slice(0, 5000));
    }, 400);
  }

  private finishStopped(t: (key: string, variables?: Record<string, unknown>) => string): void {
    if (useAppStore.getState().campaign.status === "stopped") {
      this.busy = false;
      return;
    }
    this.busy = false;
    this.queue = null;
    useAppStore.getState().setValidation({ active: false, current: 0, total: 0 });
    useAppStore.getState().patchCampaign({ status: "stopped", finishedAt: Date.now() });
    useAppStore.getState().pushToast({ kind: "info", title: t("broadcaster.stopped"), body: "" });
  }

  private finishCompleted(sent: number, failed: number, invalid: number, t: (key: string, variables?: Record<string, unknown>) => string): void {
    this.busy = false;
    this.queue = null;
    useAppStore.getState().patchCampaign({
      status: "completed",
      sent,
      failed,
      invalid,
      processed: sent + failed + invalid,
      finishedAt: Date.now(),
    });
    useAppStore.getState().pushToast({
      kind: "success",
      title: t("broadcaster.finished"),
      body: t("toast.campaignComplete", { sent, failed }),
    });
  }

  pause(): void {
    this.userPaused = true;
    this.queue?.pause();
  }

  resume(): void {
    this.userPaused = false;
    // While waiting for WhatsApp, the hold resumes the queue itself once it is back.
    if (useAppStore.getState().campaign.waitingForConnection) return;
    this.queue?.resume();
  }

  stop(): void {
    this.stopRequested = true;
    this.validationAbort = true;
    this.queue?.stop();
    if (!this.queue && this.isBusy()) {
      const t = tFor(useAppStore.getState().settings.language);
      this.finishStopped(t);
    }
  }

  getRecipients(): CampaignRecipient[] {
    return this.recipients;
  }

  reset(): void {
    if (this.isBusy()) return;
    this.queue = null;
    this.recipients = [];
    useAppStore.getState().resetCampaign();
  }
}
