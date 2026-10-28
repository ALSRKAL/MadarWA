import { BridgeClient } from "../shared/bridge/bridge";
import { BRIDGE_COMMANDS, RUNTIME_MESSAGES, STORAGE_KEYS } from "../shared/constants";
import { mergeSettings } from "../shared/defaults";
import { initI18n, tFor } from "../shared/i18n";
import {
  isExtensionContextValid,
  loadSettings,
  loadVault,
  loadWebhookLog,
  onStorageChanged,
  readStorage,
  saveVault,
  saveSettings,
  saveWebhookLog,
  writeStorage,
} from "../shared/storage";
import type {
  AppSettings,
  CachedMessage,
  CampaignRecipient,
  DeletedMessage,
  EngineInfo,
  EnginePingResult,
  IncomingMessageEvent,
  RevokedMessageEvent,
  WebhookLogEntry,
} from "../shared/types";
import { truncate, uid } from "../shared/format";
import type { Attachment, StartCampaignInput } from "./broadcast";
import { BroadcastManager } from "./broadcast";
import { LauncherManager } from "./launcher";
import { applyPrivacyAttributes, detectTheme, PresenceScrubber, watchTheme } from "./privacy-runtime";
import { useAppStore } from "./store";

function signature(settings: AppSettings): string {
  return JSON.stringify({ ...settings, updatedAt: 0 });
}

function asMessageCache(value: unknown): CachedMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CachedMessage => {
    if (typeof entry !== "object" || entry === null) return false;
    const item = entry as Partial<CachedMessage>;
    return typeof item.id === "string" && typeof item.timestamp === "number";
  });
}

/**
 * Single owner of the ISOLATED-world runtime: bridge, persistence, cache,
 * vault, privacy application, lock state and campaign manager.
 */
export class ContentController {
  readonly bridge = new BridgeClient();
  readonly broadcast = new BroadcastManager(this.bridge);
  readonly scrubber = new PresenceScrubber();
  readonly launcher = new LauncherManager();

  private initialized = false;
  private readonly cleanups: Array<() => void> = [];
  private messageCache = new Map<string, CachedMessage>();
  private cacheFlushTimer = 0;
  private settingsTimer = 0;
  private lastSaved = "";
  private lastPrivacy = "";
  private lastAutoReply = "";
  private lastAntiDelete: boolean | null = null;
  private lastActivity = Date.now();
  private lockTimer = 0;
  private pingTimer = 0;
  private lastEngineErrorAt = 0;
  private lastAutoReplyErrorAt = 0;
  private engineReady = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const settings = await loadSettings();
    this.lastSaved = signature(settings);
    initI18n(settings.language);
    useAppStore.getState().setSettings(settings);
    useAppStore.getState().setTheme(settings.theme === "auto" ? detectTheme() : settings.theme);
    applyPrivacyAttributes(settings.privacy);
    this.scrubber.setEnabled(settings.privacy.hidePresence, settings.privacy.hideTyping);

    const [vault, webhookLog, rawCache] = await Promise.all([
      loadVault(),
      loadWebhookLog(),
      readStorage<unknown>(STORAGE_KEYS.messageCache, []),
    ]);
    useAppStore.getState().setVault(vault);
    useAppStore.getState().setWebhookLog(webhookLog);
    this.messageCache = new Map(asMessageCache(rawCache).map((entry) => [entry.id, entry]));
    this.trimCache(settings.antiDelete.maxCache);
    this.updateBadge(vault.length);

    this.cleanups.push(watchTheme((theme) => useAppStore.getState().setTheme(theme)));

    this.bridge.onConnectionChange((connected) => {
      useAppStore.getState().setBridgeConnected(connected);
      if (connected) {
        this.engineReady = false;
        void this.refreshEngineInfo(true);
      } else {
        this.engineReady = false;
        const current = useAppStore.getState().engine;
        useAppStore.getState().setEngine({ ...current, ready: false, connected: false });
      }
    });
    this.cleanups.push(
      this.bridge.onEvent((event, data) => this.handleEngineEvent(event, data)),
    );
    this.bridge.start();

    this.cleanups.push(
      useAppStore.subscribe((state, previous) => {
        if (state.settings !== previous.settings) this.onSettingsChanged(state.settings);
      }),
    );

    this.cleanups.push(
      onStorageChanged((changes) => {
        const settingsChange = changes[STORAGE_KEYS.settings];
        if (settingsChange) {
          const next = mergeSettings(settingsChange.newValue);
          const nextSignature = signature(next);
          if (nextSignature !== signature(useAppStore.getState().settings)) {
            this.lastSaved = nextSignature;
            useAppStore.getState().setSettings(next);
          }
        }
        const vaultChange = changes[STORAGE_KEYS.vault];
        if (vaultChange && Array.isArray(vaultChange.newValue)) {
          const nextVault = (vaultChange.newValue as DeletedMessage[]).filter(
            (entry) => entry && typeof entry.id === "string",
          );
          useAppStore.getState().setVault(nextVault);
          this.updateBadge(nextVault.length);
        }
        const logChange = changes[STORAGE_KEYS.webhookLog];
        if (logChange && Array.isArray(logChange.newValue)) {
          useAppStore.getState().setWebhookLog(logChange.newValue as WebhookLogEntry[]);
        }
      }),
    );

    this.setupActivityTracking();
    this.launcher.start();
    this.registerRuntimeMessages();

    void this.bridge
      .waitForReady(20_000)
      .then(() => this.refreshEngineInfo(true))
      .catch(() => undefined);

    this.pingTimer = window.setInterval(() => {
      if (this.bridge.isConnected()) void this.refreshEngineInfo(false);
    }, 6000);
  }

  private handleEngineEvent(event: string, data: unknown): void {
    switch (event) {
      case "message.new":
        this.recordIncoming(data as IncomingMessageEvent);
        this.forwardWebhook("message", data as Record<string, unknown>);
        break;
      case "message.revoked":
        void this.handleRevoked(data as RevokedMessageEvent);
        this.forwardWebhook("revoked", data as Record<string, unknown>);
        break;
      case "presence.change":
        this.scrubber.schedule(200);
        break;
      case "autoreply.error":
        this.showAutoReplyError(data);
        break;
      case "engine.state": {
        const info = data as EngineInfo;
        useAppStore.getState().setEngine(info);
        if (info.ready && !this.engineReady) {
          this.engineReady = true;
          this.resetPushSignatures();
          void this.pushConfig();
        }
        break;
      }
      case "engine.error":
        this.showEngineError(data);
        break;
      default:
        break;
    }
  }

  private async refreshEngineInfo(forcePush: boolean): Promise<void> {
    try {
      const info = await this.bridge.request<EnginePingResult>(BRIDGE_COMMANDS.ping, {}, 8000);
      const wasReady = this.engineReady;
      useAppStore.getState().setEngine(info);
      this.engineReady = info.ready;
      if (info.ready && (!wasReady || forcePush)) {
        this.resetPushSignatures();
        void this.pushConfig();
      }
    } catch {
      // Connection listeners handle availability; avoid noisy toasts.
    }
  }

  private resetPushSignatures(): void {
    this.lastPrivacy = "";
    this.lastAutoReply = "";
    this.lastAntiDelete = null;
  }

  private onSettingsChanged(settings: AppSettings): void {
    initI18n(settings.language);
    applyPrivacyAttributes(settings.privacy);
    this.scrubber.setEnabled(settings.privacy.hidePresence, settings.privacy.hideTyping);
    if (!settings.pin.enabled) useAppStore.getState().setLocked(false);
    if (settings.theme !== "auto") useAppStore.getState().setTheme(settings.theme);

    if (this.settingsTimer) window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = 0;
      void this.persistAndPush(settings);
    }, 250);
  }

  private async persistAndPush(settings: AppSettings): Promise<void> {
    const currentSignature = signature(settings);
    if (currentSignature !== this.lastSaved) {
      const saved = await saveSettings(settings);
      if (saved) this.lastSaved = currentSignature;
    }
    await this.pushConfig(settings);
  }

  private async pushConfig(settings = useAppStore.getState().settings): Promise<void> {
    if (!this.bridge.isConnected() || !this.engineReady) return;

    const privacySignature = JSON.stringify(settings.privacy);
    if (privacySignature !== this.lastPrivacy) {
      this.lastPrivacy = privacySignature;
      try {
        const result = await this.bridge.request<{ errors?: string[] }>(
          BRIDGE_COMMANDS.privacyApply,
          settings.privacy,
          30_000,
        );
        if (result.errors && result.errors.length > 0) {
          const t = tFor(settings.language);
          useAppStore.getState().pushToast({
            kind: "error",
            title: t("privacy.applyError"),
            body: result.errors.join(" · ").slice(0, 200),
          });
        }
      } catch (error) {
        this.lastPrivacy = "";
        this.showEngineError(error);
      }
    }

    const autoReplySignature = JSON.stringify(settings.autoReply);
    if (autoReplySignature !== this.lastAutoReply) {
      this.lastAutoReply = autoReplySignature;
      try {
        await this.bridge.request(BRIDGE_COMMANDS.configureAutoReply, settings.autoReply, 10_000);
      } catch {
        this.lastAutoReply = "";
      }
    }

    if (this.lastAntiDelete !== settings.antiDelete.enabled) {
      this.lastAntiDelete = settings.antiDelete.enabled;
      try {
        await this.bridge.request(
          BRIDGE_COMMANDS.configureAntiDelete,
          { enabled: settings.antiDelete.enabled },
          10_000,
        );
      } catch {
        this.lastAntiDelete = null;
      }
    }
  }

  private recordIncoming(event: IncomingMessageEvent): void {
    const settings = useAppStore.getState().settings;
    if (!settings.antiDelete.enabled || !event?.id) return;
    if (!event.chatId || event.chatId.endsWith("@broadcast")) return;

    const cached: CachedMessage = {
      id: event.id,
      chatId: event.chatId,
      chatName: event.chatName,
      sender: event.sender,
      senderName: event.senderName,
      text: event.text,
      messageType: event.messageType,
      timestamp: event.timestamp,
      isGroup: event.isGroup,
    };
    this.messageCache.set(event.id, cached);
    this.trimCache(settings.antiDelete.maxCache);
    this.scheduleCacheFlush();
  }

  private trimCache(max: number): void {
    while (this.messageCache.size > Math.max(50, max)) {
      const oldest = this.messageCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.messageCache.delete(oldest);
    }
  }

  private scheduleCacheFlush(): void {
    if (this.cacheFlushTimer) return;
    this.cacheFlushTimer = window.setTimeout(() => {
      this.cacheFlushTimer = 0;
      const values = [...this.messageCache.values()].slice(-1500);
      void writeStorage(STORAGE_KEYS.messageCache, values);
    }, 1500);
  }

  private async handleRevoked(event: RevokedMessageEvent): Promise<void> {
    const settings = useAppStore.getState().settings;
    if (!settings.antiDelete.enabled || !event?.refId) return;

    const cached = this.messageCache.get(event.refId);
    const entry: DeletedMessage = {
      id: event.refId || uid("deleted"),
      chatId: cached?.chatId || event.chatId,
      chatName: cached?.chatName || event.chatName,
      sender: cached?.sender || event.author,
      senderName: cached?.senderName || event.senderName || "",
      text: cached?.text || "",
      messageType: cached?.messageType || "",
      timestamp: cached?.timestamp || event.timestamp,
      isGroup: cached?.isGroup ?? event.isGroup,
      revokedAt: Date.now(),
      revokedBy: event.revokedBy,
      revokeType: event.revokeType,
      recoveredFromCache: Boolean(cached),
    };

    if (this.messageCache.delete(event.refId)) this.scheduleCacheFlush();

    const store = useAppStore.getState();
    store.addVaultEntry(entry);
    const nextVault = useAppStore.getState().vault;
    await saveVault(nextVault);
    this.updateBadge(nextVault.length);

    const t = tFor(settings.language);
    const sender = entry.senderName || entry.revokedBy || t("common.unknown");
    const bodyText = entry.text ? truncate(entry.text, 120) : entry.recoveredFromCache ? "" : t("vault.notCached");

    if (settings.antiDelete.inChatToast) {
      store.pushToast({
        kind: "deleted",
        title: t("toast.deletedTitle"),
        body: t("toast.deletedBody", { sender, chat: entry.chatName, text: bodyText }),
      });
    }

    if (settings.antiDelete.desktopNotification) {
      this.postRuntime({
        type: RUNTIME_MESSAGES.notify,
        title: `${t("toast.deletedTitle")} — ${entry.chatName}`,
        message: `${sender}: ${bodyText || t("vault.notCached")}`,
      });
    }
  }

  private forwardWebhook(event: "message" | "revoked", data: Record<string, unknown>): void {
    const webhook = useAppStore.getState().settings.webhook;
    if (!webhook.enabled) return;
    if (event === "message" && !webhook.forwardMessages) return;
    if (event === "revoked" && !webhook.forwardRevoked) return;
    this.postRuntime({
      type: RUNTIME_MESSAGES.webhookDeliver,
      payload: {
        event,
        source: "madarwa",
        at: Date.now(),
        data,
      },
    });
  }

  private updateBadge(count: number): void {
    this.postRuntime({ type: RUNTIME_MESSAGES.badgeSet, count });
  }

  private postRuntime(message: Record<string, unknown>): void {
    if (!isExtensionContextValid()) return;
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined);
    } catch {
      // Orphaned content script after an extension reload.
    }
  }

  private showEngineError(data: unknown): void {
    const now = Date.now();
    if (now - this.lastEngineErrorAt < 30_000) return;
    this.lastEngineErrorAt = now;
    const t = tFor(useAppStore.getState().settings.language);
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message?: unknown }).message ?? "")
        : "";
    useAppStore.getState().pushToast({
      kind: "error",
      title: t("errors.bridgeUnavailable"),
      body: message.slice(0, 240),
    });
  }

  private showAutoReplyError(data: unknown): void {
    const now = Date.now();
    if (now - this.lastAutoReplyErrorAt < 60_000) return;
    this.lastAutoReplyErrorAt = now;
    const t = tFor(useAppStore.getState().settings.language);
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message?: unknown }).message ?? "")
        : "";
    useAppStore.getState().pushToast({
      kind: "error",
      title: t("autoreply.title"),
      body: message.slice(0, 240),
    });
  }

  private setupActivityTracking(): void {
    const onActivity = () => {
      if (useAppStore.getState().locked) return;
      this.lastActivity = Date.now();
    };
    for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      window.addEventListener(eventName, onActivity, { capture: true, passive: true });
      this.cleanups.push(() => window.removeEventListener(eventName, onActivity, { capture: true }));
    }

    this.lockTimer = window.setInterval(() => {
      const settings = useAppStore.getState().settings;
      if (!settings.pin.enabled || !settings.pin.hash) return;
      if (useAppStore.getState().locked) return;
      const idleMs = Math.max(1, settings.pin.idleMinutes) * 60_000;
      if (Date.now() - this.lastActivity >= idleMs) {
        useAppStore.getState().setLocked(true);
      }
    }, 15_000);
  }

  private registerRuntimeMessages(): void {
    if (!isExtensionContextValid()) return;
    const handler = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => {
      if (typeof message !== "object" || message === null) return false;
      const type = (message as { type?: string }).type;
      if (type === RUNTIME_MESSAGES.lockPanel) {
        sendResponse({ ok: this.lockNow() });
        return false;
      }
      if (type === RUNTIME_MESSAGES.openPanel) {
        useAppStore.getState().openPanel();
        sendResponse({ ok: true });
        return false;
      }
      if (type === RUNTIME_MESSAGES.status) {
        const state = useAppStore.getState();
        sendResponse({ ok: true, bridgeConnected: state.bridgeConnected, engine: state.engine });
        return false;
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(handler);
    this.cleanups.push(() => chrome.runtime.onMessage.removeListener(handler));
  }

  lockNow(): boolean {
    const settings = useAppStore.getState().settings;
    const t = tFor(settings.language);
    if (!settings.pin.enabled || !settings.pin.hash) {
      useAppStore.getState().pushToast({
        kind: "info",
        title: t("privacy.lockSection"),
        body: t("privacy.lockEnableHint"),
      });
      return false;
    }
    useAppStore.getState().setLocked(true);
    return true;
  }

  unlock(): void {
    this.lastActivity = Date.now();
    useAppStore.getState().setLocked(false);
  }

  request<T>(cmd: string, params: unknown = {}, timeoutMs?: number): Promise<T> {
    return this.bridge.request<T>(cmd, params, timeoutMs);
  }

  async sendText(chatId: string, text: string): Promise<unknown> {
    return this.bridge.request(BRIDGE_COMMANDS.sendText, { chatId, text }, 60_000);
  }

  async openChat(chatId: string): Promise<unknown> {
    return this.bridge.request(BRIDGE_COMMANDS.openChat, { chatId }, 20_000);
  }

  async sendTemplateToActiveChat(text: string): Promise<void> {
    const active = await this.bridge.request<{ chatId: string }>(BRIDGE_COMMANDS.activeChat, {}, 10_000);
    if (!active.chatId) throw new Error(tFor(useAppStore.getState().settings.language)("errors.noChat"));
    await this.sendText(active.chatId, text);
  }

  async insertTemplate(text: string): Promise<void> {
    await this.bridge.request(BRIDGE_COMMANDS.setInput, { text }, 15_000);
  }

  async startCampaign(input: StartCampaignInput): Promise<{ ok: boolean; error?: string }> {
    return this.broadcast.start(input);
  }

  async saveNow(): Promise<void> {
    await this.persistAndPush(useAppStore.getState().settings);
  }

  async testWebhook(): Promise<{ ok: boolean; status: number; error: string }> {
    const settings = useAppStore.getState().settings;
    await this.persistAndPush(settings);
    if (!isExtensionContextValid()) return { ok: false, status: 0, error: "Extension context unavailable" };
    try {
      const response = (await chrome.runtime.sendMessage({
        type: RUNTIME_MESSAGES.webhookTest,
      })) as { ok?: boolean; status?: number; error?: string } | undefined;
      return {
        ok: Boolean(response?.ok),
        status: Number(response?.status ?? 0),
        error: String(response?.error ?? ""),
      };
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async refreshWebhookLog(): Promise<void> {
    const log = await loadWebhookLog();
    useAppStore.getState().setWebhookLog(log);
  }

  async clearWebhookLog(): Promise<void> {
    await saveWebhookLog([]);
    useAppStore.getState().setWebhookLog([]);
  }

  attachmentFromFile(file: File): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        const type: Attachment["type"] = file.type.startsWith("image/")
          ? file.type.includes("webp")
            ? "sticker"
            : "image"
          : file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "audio"
              : "document";
        resolve({
          name: file.name,
          mimetype: file.type || "application/octet-stream",
          dataUrl,
          type,
        });
      };
      reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment"));
      reader.readAsDataURL(file);
    });
  }

  getCampaignRecipients(): CampaignRecipient[] {
    return this.broadcast.getRecipients();
  }

  dispose(): void {
    window.clearInterval(this.lockTimer);
    window.clearInterval(this.pingTimer);
    if (this.settingsTimer) window.clearTimeout(this.settingsTimer);
    if (this.cacheFlushTimer) window.clearTimeout(this.cacheFlushTimer);
    this.launcher.stop();
    this.bridge.dispose();
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
  }
}

export const contentController = new ContentController();
