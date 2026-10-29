import { BridgeClient } from "../shared/bridge/bridge";
import { BRIDGE_COMMANDS, RUNTIME_MESSAGES, STORAGE_KEYS } from "../shared/constants";
import { mergeSettings } from "../shared/defaults";
import { initI18n, tFor } from "../shared/i18n";
import {
  asSeenAt,
  isExtensionContextValid,
  loadSettings,
  loadVault,
  loadVaultSeenAt,
  loadWebhookLog,
  onStorageChanged,
  readStorage,
  removeStorage,
  saveVault,
  saveVaultSeenAt,
  saveSettings,
  saveWebhookLog,
  writeStorage,
} from "../shared/storage";
import type {
  AppSettings,
  CachedMessage,
  CampaignLogEntry,
  CampaignRecipient,
  CampaignState,
  DeletedMessage,
  EngineInfo,
  EnginePingResult,
  IncomingMessageEvent,
  MessageSnapshot,
  PrivacyGuardStatus,
  RevokedMessageEvent,
  RevokedRowIndexEntry,
  WebhookLogEntry,
} from "../shared/types";
import { CLIENT_ERROR_CODES, codedError } from "../shared/errors";
import { truncate, uid } from "../shared/format";
import { extractStanzaId } from "../shared/utils/revoke";
import type { Attachment, StartCampaignInput } from "./broadcast";
import { BroadcastManager } from "./broadcast";
import { InlineRestorer } from "./inline-restore";
import { LauncherManager } from "./launcher";
import { applyPrivacyAttributes, detectTheme, PresenceScrubber, watchTheme } from "./privacy-runtime";
import { PrivacyTagger } from "./privacyTagger";
import { emptyCampaign, selectUnseenVault, useAppStore } from "./store";

function signature(settings: AppSettings): string {
  return JSON.stringify({ ...settings, updatedAt: 0 });
}

function asCampaignReport(value: unknown): { campaign: CampaignState; recipients: CampaignRecipient[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { campaign?: Partial<CampaignState>; recipients?: unknown[] };
  const campaign = raw.campaign;
  if (!campaign || typeof campaign.id !== "string" || !Array.isArray(campaign.logs)) return null;
  const statuses: CampaignState["status"][] = ["idle", "running", "paused", "stopped", "completed"];
  const status = statuses.includes(campaign.status as CampaignState["status"])
    ? (campaign.status as CampaignState["status"])
    : "stopped";
  const recipients = Array.isArray(raw.recipients)
    ? raw.recipients.filter((entry): entry is CampaignRecipient => {
        if (typeof entry !== "object" || entry === null) return false;
        const row = entry as Partial<CampaignRecipient>;
        return typeof row.phone === "string" && typeof row.chatId === "string";
      })
    : [];

  return {
    campaign: {
      ...emptyCampaign(),
      ...campaign,
      status,
      logs: campaign.logs.slice(-500) as CampaignLogEntry[],
      waitingForConnection: false,
    },
    recipients,
  };
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
  readonly privacyTagger = new PrivacyTagger();
  readonly launcher = new LauncherManager();
  readonly inlineRestorer = new InlineRestorer({
    getLanguage: () => useAppStore.getState().settings.language,
    getMode: () => useAppStore.getState().settings.antiDelete.inlineMode,
    onOpenVault: () => useAppStore.getState().openPanel("vault"),
  });

  private initialized = false;
  private readonly cleanups: Array<() => void> = [];
  private messageCache = new Map<string, CachedMessage>();
  private cacheFlushTimer = 0;
  private campaignPersistTimer = 0;
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
  private orphaned = false;
  private contextTimer = 0;
  private engineReady = false;
  private engineAuthed = false;
  private engineBootId = "";
  private syncRunning: Promise<void> | null = null;
  private syncAgain = false;
  private preindexRequested = false;
  private revokedIndexBusy = false;
  private lastBadgeCount = -1;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const settings = await loadSettings();
    this.lastSaved = signature(settings);
    initI18n(settings.language);
    useAppStore.getState().setSettings(settings);
    // The panel is light only. The launcher and the in-chat restore pills sit
    // inside WhatsApp's own chrome, so they follow WhatsApp's theme.
    const initialTheme = detectTheme();
    useAppStore.getState().setTheme(initialTheme);
    document.body?.setAttribute("data-madarwa-theme", initialTheme);
    applyPrivacyAttributes(settings.privacy);
    this.scrubber.setEnabled(settings.privacy.hidePresence, settings.privacy.hideTyping, settings.privacy.hideRecording);
    this.privacyTagger.setActive(settings.privacy);

    const [vault, vaultSeenAt, webhookLog, rawCache, rawReport] = await Promise.all([
      loadVault(),
      loadVaultSeenAt(),
      loadWebhookLog(),
      readStorage<unknown>(STORAGE_KEYS.messageCache, []),
      readStorage<unknown>(STORAGE_KEYS.campaignReport, null),
    ]);
    useAppStore.getState().setVault(vault);
    useAppStore.getState().setVaultSeenAt(vaultSeenAt);
    useAppStore.getState().setWebhookLog(webhookLog);
    this.messageCache = new Map(asMessageCache(rawCache).map((entry) => [entry.id, entry]));
    this.trimCache(settings.antiDelete.maxCache);
    this.updateBadge();
    this.inlineRestorer.setLanguage(settings.language);
    this.inlineRestorer.setMode(settings.antiDelete.inlineMode);
    this.inlineRestorer.setEnabled(settings.antiDelete.enabled && settings.antiDelete.inlineRestore);
    this.inlineRestorer.setRecords(vault);

    const report = asCampaignReport(rawReport);
    if (report && report.campaign.total > 0) {
      const interrupted = report.campaign.status === "running" || report.campaign.status === "paused";
      useAppStore.getState().setCampaign({
        ...report.campaign,
        status: interrupted ? "stopped" : report.campaign.status,
        finishedAt: interrupted ? Date.now() : report.campaign.finishedAt,
      });
      useAppStore.getState().setRecipients(report.recipients);
    }

    this.cleanups.push(
      watchTheme((theme) => {
        useAppStore.getState().setTheme(theme);
        document.body?.setAttribute("data-madarwa-theme", theme);
      }),
    );

    this.bridge.onConnectionChange((connected) => {
      useAppStore.getState().setBridgeConnected(connected);
      if (connected) {
        // The ping reply carries the engine boot id; config is re-pushed only
        // if the engine actually restarted, not on every reconnect.
        void this.refreshEngineInfo();
      } else {
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
        if (state.campaign !== previous.campaign || state.recipients !== previous.recipients) {
          this.scheduleCampaignPersist();
        }
        if (
          state.vault !== previous.vault ||
          state.panelOpen !== previous.panelOpen ||
          state.activeTab !== previous.activeTab ||
          state.locked !== previous.locked
        ) {
          this.markVaultSeenIfVisible();
        }
        if (state.vault !== previous.vault || state.vaultSeenAt !== previous.vaultSeenAt) this.updateBadge();
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
          this.inlineRestorer.setRecords(nextVault);
        }
        // Another WhatsApp tab (or this one) marked the vault as seen.
        const seenChange = changes[STORAGE_KEYS.vaultSeenAt];
        if (seenChange) {
          const seenAt = asSeenAt(seenChange.newValue);
          if (seenAt !== useAppStore.getState().vaultSeenAt) useAppStore.getState().setVaultSeenAt(seenAt);
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
    this.contextTimer = window.setInterval(() => this.checkExtensionContext(), 5000);

    this.pingTimer = window.setInterval(() => {
      if (!this.bridge.isConnected()) return;
      void this.refreshEngineInfo();
      // A chat can load new store models after the initial scan; refreshing
      // the revoke index keeps already-visible deleted rows restorable. No
      // rows render while the tab is hidden, so skip the scan until visible.
      if (!document.hidden) void this.requestRevokedIndex();
    }, 6000);

    const onVisible = () => {
      if (document.hidden) return;
      this.checkExtensionContext();
      if (!this.bridge.isConnected()) return;
      void this.refreshEngineInfo();
      void this.requestRevokedIndex();
    };
    document.addEventListener("visibilitychange", onVisible);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisible));
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
      case "engine.state":
        if (typeof data === "object" && data !== null) this.applyEngineInfo(data as EngineInfo);
        break;
      case "engine.error":
        this.showEngineError(data);
        break;
      default:
        break;
    }
  }

  private async refreshEngineInfo(): Promise<void> {
    try {
      const info = await this.bridge.request<EnginePingResult>(BRIDGE_COMMANDS.ping, {}, 8000);
      this.applyEngineInfo(info);
    } catch {
      // Connection listeners handle availability; avoid noisy toasts.
    }
  }

  /**
   * Single entry point for engine state, from ping replies and pushed events.
   * Config is synced only on a real transition: the engine restarted, became
   * ready, or WhatsApp finished logging in. A reconnect or a duplicate
   * ready signal does not re-send anything.
   */
  private applyEngineInfo(info: EngineInfo): void {
    if (info.bootId && info.bootId !== this.engineBootId) {
      this.engineBootId = info.bootId;
      this.engineReady = false;
      this.engineAuthed = false;
    }
    useAppStore.getState().setEngine(info);

    const wasReady = this.engineReady;
    const wasUsable = this.engineReady && this.engineAuthed;
    this.engineReady = info.ready;
    this.engineAuthed = info.connected;
    const usable = info.ready && info.connected;

    if (usable && !wasUsable) {
      // Logged in (or engine restarted): account-level privacy calls only
      // succeed now, so everything is re-applied once.
      this.preindexRequested = false;
      this.resetPushSignatures();
      void this.pushConfig();
      void this.requestPreindex();
      void this.requestRevokedIndex();
    } else if (info.ready && !wasReady) {
      void this.pushConfig();
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
    this.scrubber.setEnabled(settings.privacy.hidePresence, settings.privacy.hideTyping, settings.privacy.hideRecording);
    this.privacyTagger.setActive(settings.privacy);
    this.inlineRestorer.setLanguage(settings.language);
    this.inlineRestorer.setMode(settings.antiDelete.inlineMode);
    this.inlineRestorer.setEnabled(settings.antiDelete.enabled && settings.antiDelete.inlineRestore);
    if (settings.antiDelete.enabled) void this.requestPreindex();
    if (!settings.pin.enabled) useAppStore.getState().setLocked(false);

    if (this.settingsTimer) window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = 0;
      void this.persistAndPush(settings);
    }, 250);
  }

  /** Persists settings and pushes them to the engine; resolves to whether the save succeeded. */
  private async persistAndPush(settings: AppSettings): Promise<boolean> {
    const currentSignature = signature(settings);
    let saved = true;
    if (currentSignature !== this.lastSaved) {
      saved = await saveSettings(settings);
      if (saved) this.lastSaved = currentSignature;
      else this.checkExtensionContext();
    }
    await this.pushConfig();
    return saved;
  }

  /**
   * After an extension reload or update, this content script keeps running
   * but every chrome.* call fails. Detect that once and surface a reload
   * prompt instead of silently dropping saves. Bridge features keep working
   * with the old engine, so a running campaign is not interrupted.
   */
  private checkExtensionContext(): boolean {
    if (this.orphaned) return false;
    if (isExtensionContextValid()) return true;
    this.orphaned = true;
    window.clearInterval(this.contextTimer);
    this.contextTimer = 0;
    useAppStore.getState().setOrphaned(true);
    return false;
  }

  reloadPage(): void {
    window.location.reload();
  }

  /**
   * Single-flight config sync. Concurrent callers share the running sync; a
   * request that arrives mid-flight schedules exactly one follow-up pass with
   * the latest settings, so the engine never receives interleaved duplicates.
   */
  private pushConfig(): Promise<void> {
    if (this.syncRunning) {
      this.syncAgain = true;
      return this.syncRunning;
    }
    this.syncRunning = (async () => {
      try {
        do {
          this.syncAgain = false;
          await this.pushConfigOnce(useAppStore.getState().settings);
        } while (this.syncAgain);
      } finally {
        this.syncRunning = null;
      }
    })();
    return this.syncRunning;
  }

  private async pushConfigOnce(settings: AppSettings): Promise<void> {
    if (!this.bridge.isConnected() || !this.engineReady) return;

    const privacySignature = JSON.stringify(settings.privacy);
    if (privacySignature !== this.lastPrivacy) {
      this.lastPrivacy = privacySignature;
      try {
        const result = await this.bridge.request<{ errors?: string[]; guard?: PrivacyGuardStatus }>(
          BRIDGE_COMMANDS.privacyApply,
          settings.privacy,
          30_000,
        );
        if (result.guard) useAppStore.getState().setPrivacyGuard(result.guard);
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
      stanzaId: event.stanzaId,
      chatId: event.chatId,
      chatName: event.chatName,
      sender: event.sender,
      senderName: event.senderName,
      text: event.text,
      messageType: event.messageType,
      timestamp: event.timestamp,
      isGroup: event.isGroup,
      previewDataUrl: event.previewDataUrl,
      caption: event.caption,
      hasFullMedia: event.hasFullMedia,
      mediaType: event.mediaType,
      mimetype: event.mimetype,
      filename: event.filename,
      fileSize: event.fileSize,
      duration: event.duration,
      width: event.width,
      height: event.height,
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
      const limit = Math.max(50, useAppStore.getState().settings.antiDelete.maxCache);
      const values = [...this.messageCache.values()].slice(-limit);
      void writeStorage(STORAGE_KEYS.messageCache, values);
    }, 1500);
  }

  private scheduleCampaignPersist(): void {
    if (this.campaignPersistTimer) return;
    this.campaignPersistTimer = window.setTimeout(() => {
      this.campaignPersistTimer = 0;
      const { campaign, recipients } = useAppStore.getState();
      if (campaign.total === 0 && recipients.length === 0) {
        void removeStorage(STORAGE_KEYS.campaignReport);
        return;
      }
      void writeStorage(STORAGE_KEYS.campaignReport, {
        campaign,
        recipients: recipients.slice(0, 20_000),
      });
    }, 800);
  }

  private async requestPreindex(): Promise<void> {
    const settings = useAppStore.getState().settings;
    if (this.preindexRequested || !settings.antiDelete.enabled || !this.engineReady || !this.bridge.isConnected()) {
      return;
    }
    this.preindexRequested = true;
    try {
      const result = await this.bridge.request<{ messages?: MessageSnapshot[] }>(
        BRIDGE_COMMANDS.preindexMessages,
        { limit: 1000 },
        45_000,
      );
      let changed = false;
      for (const snapshot of result.messages ?? []) {
        if (!snapshot?.id) continue;
        const existing = this.messageCache.get(snapshot.id);
        if (existing && existing.timestamp >= snapshot.timestamp && existing.text) continue;
        this.messageCache.set(snapshot.id, {
          id: snapshot.id,
          stanzaId: snapshot.stanzaId,
          chatId: snapshot.chatId,
          chatName: snapshot.chatName,
          sender: snapshot.sender,
          senderName: snapshot.senderName,
          text: snapshot.text,
          messageType: snapshot.messageType,
          timestamp: snapshot.timestamp,
          isGroup: snapshot.isGroup,
          previewDataUrl: snapshot.previewDataUrl,
          caption: snapshot.caption,
          hasFullMedia: snapshot.hasFullMedia,
          mediaType: snapshot.mediaType,
          mimetype: snapshot.mimetype,
          filename: snapshot.filename,
          fileSize: snapshot.fileSize,
          duration: snapshot.duration,
          width: snapshot.width,
          height: snapshot.height,
        });
        changed = true;
      }
      if (changed) {
        this.trimCache(settings.antiDelete.maxCache);
        this.scheduleCacheFlush();
      }
      void this.requestRevokedIndex();
    } catch {
      this.preindexRequested = false;
    }
  }

  private async requestRevokedIndex(): Promise<void> {
    if (this.revokedIndexBusy || !this.engineReady || !this.bridge.isConnected()) return;
    this.revokedIndexBusy = true;
    try {
      const result = await this.bridge.request<{ rows?: RevokedRowIndexEntry[] }>(
        BRIDGE_COMMANDS.revokedIndex,
        {},
        20_000,
      );
      this.inlineRestorer.setRevokeIndex(result.rows ?? []);
    } catch {
      // WhatsApp may be re-rendering; the next interval pass retries.
    } finally {
      this.revokedIndexBusy = false;
    }
  }

  private cachedByStanza(stanzaId: string): CachedMessage | undefined {
    if (!stanzaId) return undefined;
    for (const entry of this.messageCache.values()) {
      if (entry.stanzaId === stanzaId || extractStanzaId(entry.id) === stanzaId) return entry;
    }
    return undefined;
  }

  private async handleRevoked(event: RevokedMessageEvent): Promise<void> {
    const settings = useAppStore.getState().settings;
    if (!settings.antiDelete.enabled || !event?.refId) return;

    const cached = this.messageCache.get(event.refId) || this.cachedByStanza(event.stanzaId ?? "");
    const original = event.original;
    const entry: DeletedMessage = {
      id: original?.id || event.refId || uid("deleted"),
      stanzaId: original?.stanzaId || event.stanzaId || extractStanzaId(event.refId),
      chatId: original?.chatId || cached?.chatId || event.chatId,
      chatName: original?.chatName || cached?.chatName || event.chatName,
      sender: original?.sender || event.originalSenderPhone || cached?.sender || event.author,
      senderName: original?.senderName || cached?.senderName || event.originalSenderName || event.senderName || "",
      text: original?.text || cached?.text || event.originalText || "",
      messageType: original?.messageType || cached?.messageType || event.mediaType || "",
      previewDataUrl:
        event.previewDataUrl || original?.previewDataUrl || cached?.previewDataUrl || "",
      caption: event.caption || original?.caption || cached?.caption,
      hasFullMedia: event.hasFullMedia ?? original?.hasFullMedia ?? cached?.hasFullMedia,
      mediaType: event.mediaType || original?.mediaType || cached?.mediaType,
      mimetype: event.mimetype || original?.mimetype || cached?.mimetype,
      filename: event.filename || original?.filename || cached?.filename,
      fileSize: event.fileSize || original?.fileSize || cached?.fileSize,
      duration: event.duration || original?.duration || cached?.duration,
      width: event.width || original?.width || cached?.width,
      height: event.height || original?.height || cached?.height,
      timestamp: original?.timestamp || cached?.timestamp || event.timestamp,
      isGroup: original?.isGroup ?? cached?.isGroup ?? event.isGroup,
      revokedAt: Date.now(),
      revokedBy: event.revokedBy,
      revokeType: event.revokeType,
      recoveredFromCache: Boolean(original || cached),
      revokeMessageId: event.revokeMessageId,
    };

    this.messageCache.delete(event.refId);
    if (cached && cached.id !== event.refId) this.messageCache.delete(cached.id);
    this.scheduleCacheFlush();

    const store = useAppStore.getState();
    store.addVaultEntry(entry);
    const nextVault = useAppStore.getState().vault;
    this.inlineRestorer.register(entry);
    this.inlineRestorer.setRecords(nextVault);
    this.inlineRestorer.restoreForRevoke(entry, event.revokeMessageId);
    await saveVault(nextVault);

    const t = tFor(settings.language);
    const sender = entry.senderName || entry.sender || entry.revokedBy || t("common.unknown");
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

  /** The toolbar badge counts only deleted messages the user has not looked at. */
  private updateBadge(): void {
    const count = selectUnseenVault(useAppStore.getState());
    if (count === this.lastBadgeCount) return;
    this.lastBadgeCount = count;
    this.postRuntime({ type: RUNTIME_MESSAGES.badgeSet, count });
  }

  /** While the vault is on screen, everything in it counts as seen. */
  private markVaultSeenIfVisible(): void {
    const state = useAppStore.getState();
    if (!state.panelOpen || state.locked || state.activeTab !== "vault") return;
    if (selectUnseenVault(state) === 0) return;
    const newest = state.vault.reduce((latest, entry) => Math.max(latest, entry.revokedAt), 0);
    const seenAt = Math.max(Date.now(), newest);
    state.setVaultSeenAt(seenAt);
    void saveVaultSeenAt(seenAt);
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
        sendResponse({
          ok: true,
          bridgeConnected: state.bridgeConnected,
          everConnected: state.everConnected,
          engine: state.engine,
        });
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
    if (!active.chatId) throw codedError(CLIENT_ERROR_CODES.noActiveChat, "No active chat");
    await this.sendText(active.chatId, text);
  }

  async insertTemplate(text: string): Promise<void> {
    await this.bridge.request(BRIDGE_COMMANDS.setInput, { text }, 15_000);
  }

  async startCampaign(input: StartCampaignInput): Promise<{ ok: boolean; error?: string }> {
    return this.broadcast.start(input);
  }

  /** Flushes pending settings immediately; resolves to false if storage rejected the write. */
  async saveNow(): Promise<boolean> {
    if (this.settingsTimer) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = 0;
    }
    return this.persistAndPush(useAppStore.getState().settings);
  }

  async testWebhook(): Promise<{ ok: boolean; status: number; error: string }> {
    const settings = useAppStore.getState().settings;
    await this.persistAndPush(settings);
    if (!this.checkExtensionContext()) {
      return { ok: false, status: 0, error: tFor(settings.language)("errors.updated") };
    }
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
    window.clearInterval(this.contextTimer);
    if (this.settingsTimer) window.clearTimeout(this.settingsTimer);
    if (this.cacheFlushTimer) window.clearTimeout(this.cacheFlushTimer);
    if (this.campaignPersistTimer) window.clearTimeout(this.campaignPersistTimer);
    this.launcher.stop();
    this.privacyTagger.stop();
    this.inlineRestorer.dispose();
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
