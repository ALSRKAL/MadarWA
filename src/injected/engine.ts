import { BRIDGE_COMMANDS, ENGINE_VERSION, UI_LIMITS } from "../shared/constants";
import { BridgeEngine } from "../shared/bridge/bridge";
import { randomToken } from "../shared/bridge/protocol";
import { mergeSettings } from "../shared/defaults";
import { MediaVaultCache, type MediaVaultRecord } from "../shared/media-vault";
import type {
  ContactRow,
  EngineInfo,
  EnginePingResult,
  GroupParticipantRow,
  GroupSummary,
  IncomingMessageEvent,
  MessageSnapshot,
  PresenceEvent,
  RevokedMessageEvent,
  RevokedRowIndexEntry,
  SendResult,
  ValidationResult,
} from "../shared/types";
import { isGroupChatId, normalizeChatId, phoneFromChatId, sanitizePhone } from "../shared/utils/phone";
import {
  guessMimetype,
  inspectMediaBlob,
  MAX_MEDIA_BYTES,
  normalizeMediaKind,
} from "../shared/utils/media";
import {
  extractStanzaId,
  findSnapshotByCandidates,
  resolveRevokeCandidates,
  type RevokeKeyCandidates,
} from "../shared/utils/revoke";
import { AutoReplyController } from "./modules/autoreply";
import { listChats, listContacts, listGroupParticipants, listGroups } from "./modules/exporter";
import { PrivacyController } from "./modules/privacy";
import {
  chatDisplayName,
  chatIdOfMessage,
  engineInfo,
  isGroupChat,
  isIgnoredChat,
  messagePreview,
  messageText,
  msgKeyToId,
  resolveContactName,
  resolvePhone,
  senderIdOfMessage,
  waitForWpp,
  widToId,
  type WppApi,
  type WppMsg,
  type WppPresenceEvent,
  type WppRevokeEvent,
  type WppSendResult,
} from "./wpp";

const SUPPORTED_WA_JS = "4.7.2";
const MEDIA_CAPTURE_WINDOW_MS = 24 * 60 * 60_000;
const MEDIA_INDEX_LIMIT = 12;
const MEDIA_CONCURRENCY = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

class EngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EngineError("BAD_PARAMS", "Command parameters must be an object");
  }
  return value as Record<string, unknown>;
}

function strParam(params: Record<string, unknown>, key: string, options: { required?: boolean; max?: number } = {}): string {
  const raw = params[key];
  if (raw === undefined || raw === null) {
    if (options.required) throw new EngineError("BAD_PARAMS", `Missing parameter: ${key}`);
    return "";
  }
  if (typeof raw !== "string") throw new EngineError("BAD_PARAMS", `Parameter ${key} must be a string`);
  const value = raw.trim();
  if (options.required && !value) throw new EngineError("BAD_PARAMS", `Parameter ${key} is required`);
  return value.slice(0, options.max ?? 5000);
}

function boolParam(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = params[key];
  return typeof raw === "boolean" ? raw : fallback;
}

function serializeSend(result: WppSendResult): SendResult {
  return {
    id: msgKeyToId(result.id) || (typeof result.id === "string" ? result.id : ""),
    ack: typeof result.ack === "number" ? result.ack : 0,
    timestamp: typeof result.t === "number" ? result.t * 1000 : Date.now(),
  };
}

class MadarEngine {
  private readonly bridge: BridgeEngine;
  private readonly bootId = randomToken(8);
  private slow = false;
  private wpp: WppApi | null = null;
  private eventsAttached = false;
  private eventRetries = 0;
  private storeAttached = false;
  private antiDeleteEnabled = true;
  private readonly msgIndex = new Map<string, MessageSnapshot>();
  private readonly processedRevokes = new Set<string>();
  private readonly mediaVault = new MediaVaultCache();
  private readonly mediaTasks = new Map<string, Promise<MediaVaultRecord | null>>();
  private readonly mediaCompleted = new Set<string>();
  private readonly mediaWaiters: Array<() => void> = [];
  private mediaActive = 0;
  private readonly privacy = new PrivacyController();
  private readonly autoReply = new AutoReplyController();

  constructor() {
    this.bridge = new BridgeEngine({ commandHandler: (cmd, params) => this.handleCommand(cmd, params) });
    this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    try {
      const wpp = await waitForWpp({
        onSlow: () => {
          this.slow = true;
          this.bridge.emit("engine.state", this.info());
        },
      });
      this.slow = false;
      this.wpp = wpp;
      this.attachEvents();
      this.attachStoreEvents();
      this.indexExistingMessages();
      window.setTimeout(() => this.indexExistingMessages(), 4000);
      const info = this.info();
      window.__MADARWA_ENGINE__ = { version: ENGINE_VERSION, ready: true };
      this.bridge.announceReady({ ready: true, wppVersion: info.wppVersion, me: info.me });
      this.bridge.emit("engine.state", info);
    } catch (error) {
      this.bridge.emit("engine.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private attachEvents(): void {
    if (!this.wpp || this.eventsAttached) return;
    try {
      this.wpp.on("chat.new_message", this.handleNewMessage);
      this.wpp.on("chat.msg_revoke", this.handleRevoke);
      this.wpp.on("chat.presence_change", this.handlePresence);
      this.wpp.on("conn.authenticated", this.handleConnectionChange);
      this.wpp.on("conn.online", this.handleConnectionChange);
      this.wpp.on("conn.logout", this.handleConnectionChange);
      this.eventsAttached = true;
    } catch (error) {
      this.eventRetries += 1;
      if (this.eventRetries < 30) {
        window.setTimeout(() => this.attachEvents(), 1000);
      } else {
        this.bridge.emit("engine.error", {
          message: `Could not attach WhatsApp events: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  private attachStoreEvents(): void {
    if (this.storeAttached || !this.wpp) return;
    const store = this.wpp.whatsapp?.MsgStore;
    if (!store?.on) {
      window.setTimeout(() => this.attachStoreEvents(), 1200);
      return;
    }
    try {
      store.on("add", this.handleStoreAdd);
      store.on("change:type", this.handleStoreChangeType);
      this.storeAttached = true;
    } catch {
      window.setTimeout(() => this.attachStoreEvents(), 1200);
    }
  }

  private indexExistingMessages(): void {
    try {
      const models = this.wpp?.whatsapp?.MsgStore?.getModelsArray?.() ?? [];
      const recent = models.slice(-500);
      for (const msg of recent) this.indexMessage(msg);

      // Only the latest media messages are pre-downloaded; older history stays
      // as lightweight thumbnails so opening WhatsApp never causes a storm of
      // 25MB downloads.
      const mediaModels = recent
        .filter((msg) => normalizeMediaKind(msg.type) !== "")
        .slice(-MEDIA_INDEX_LIMIT);
      for (const msg of mediaModels) this.startMediaCapture(msg, MEDIA_CAPTURE_WINDOW_MS);
    } catch {
      // Store may be unavailable during a WhatsApp reload; live add events cover it.
    }
  }

  private handleStoreAdd = (raw: unknown): void => {
    const msg = raw as WppMsg;
    if (!msg) return;

    // WhatsApp can insert a revoked model as a brand-new store row instead of
    // mutating the original model's type. Treat both paths as revocations.
    if (msg.type === "revoked") {
      const protocol = msg.protocolMessageKey;
      const candidates = resolveRevokeCandidates({
        protocolFull: msgKeyToId(protocol),
        protocolStanza: protocol?.id,
        afterFull: msgKeyToId(msg.id),
        afterStanza: msg.id?.id,
      });
      const known = findSnapshotByCandidates(this.msgIndex, candidates);
      const recent =
        typeof msg.t === "number" && Date.now() - msg.t * 1000 <= 48 * 60 * 60_000;
      if (known || recent) this.processStoreRevoke(msg);
      return;
    }

    this.indexMessage(msg);
    const fresh =
      Boolean(msg.isNewMsg) ||
      (typeof msg.t === "number" && Date.now() - msg.t * 1000 < 10 * 60_000);
    if (fresh) this.startMediaCapture(msg, MEDIA_CAPTURE_WINDOW_MS);
  };

  private handleStoreChangeType = (raw: unknown): void => {
    const msg = raw as WppMsg;
    if (msg?.type === "revoked") this.processStoreRevoke(msg);
  };

  private snapshotMessage(msg: WppMsg): MessageSnapshot | null {
    if (!this.wpp || !msg || msg.type === "revoked" || msg.type === "protocol") return null;
    const id = msgKeyToId(msg.id);
    if (!id) return null;
    const chatId = chatIdOfMessage(msg);
    if (!chatId) return null;
    const stanzaId = String(msg.id?.id ?? extractStanzaId(id));
    const senderRaw = senderIdOfMessage(msg, engineInfo(this.wpp).me);
    const mediaType = normalizeMediaKind(msg.type);
    return {
      id,
      stanzaId: stanzaId || extractStanzaId(id),
      chatId,
      chatName: chatDisplayName(this.wpp, chatId),
      sender: phoneFromChatId(senderRaw) || senderRaw,
      senderName: String(msg.notifyName ?? ""),
      text: messageText(msg),
      messageType: String(msg.type ?? "text"),
      timestamp: typeof msg.t === "number" ? msg.t * 1000 : Date.now(),
      isGroup: isGroupChat(chatId),
      fromMe: Boolean(msg.id?.fromMe ?? msg.fromMe),
      previewDataUrl: messagePreview(msg),
      caption: String(msg.caption ?? "").trim(),
      hasFullMedia: mediaType ? this.mediaCompleted.has(id) : false,
      mediaType: mediaType || undefined,
      mimetype: String(msg.mimetype ?? ""),
      filename: String(msg.filename ?? ""),
      fileSize: typeof msg.size === "number" ? msg.size : 0,
      duration: typeof msg.duration === "number" ? msg.duration : 0,
      width: typeof msg.width === "number" ? msg.width : 0,
      height: typeof msg.height === "number" ? msg.height : 0,
    };
  }

  private indexMessage(msg: WppMsg): MessageSnapshot | null {
    const snapshot = this.snapshotMessage(msg);
    if (!snapshot) return null;
    this.msgIndex.set(snapshot.id, snapshot);
    if (snapshot.stanzaId) this.msgIndex.set(snapshot.stanzaId, snapshot);
    while (this.msgIndex.size > 4000) {
      const oldest = this.msgIndex.keys().next().value as string | undefined;
      if (!oldest) break;
      this.msgIndex.delete(oldest);
    }
    return snapshot;
  }

  /**
   * Existing revoked store models carry the original key in
   * `protocolMessageKey` while WhatsApp's DOM uses the revoked stanza as
   * `data-id`. This index lets the content script reconnect old vault entries
   * to the rows that are already on screen after a reload.
   */
  private revokedRowIndex(): RevokedRowIndexEntry[] {
    try {
      const models = this.wpp?.whatsapp?.MsgStore?.getModelsArray?.() ?? [];
      const rows: RevokedRowIndexEntry[] = [];
      for (const model of models.slice(-2000)) {
        if (model?.type !== "revoked" && model?.type !== "protocol") continue;
        const protocol = model.protocolMessageKey;
        const revokeFull = msgKeyToId(model.id);
        const revokeStanza = String(model.id?.id ?? extractStanzaId(revokeFull));
        // Some builds turn the original model into the placeholder in place:
        // then the model's own key is the original message's key.
        const originalFull = msgKeyToId(protocol) || (model.type === "revoked" ? revokeFull : "");
        const originalStanza = String(protocol?.id ?? extractStanzaId(originalFull));
        const chatId =
          widToId(model.id?.remote) || widToId(model.from) || widToId(protocol?.remote);
        if (!revokeFull || (!originalFull && !originalStanza)) continue;
        rows.push({
          revokeFull,
          revokeStanza,
          originalFull,
          originalStanza,
          chatId,
          timestamp: typeof model.t === "number" ? model.t * 1000 : 0,
        });
      }
      return rows.slice(-1000);
    } catch {
      return [];
    }
  }

  private getIndexedSnapshots(limit: number): MessageSnapshot[] {
    const seen = new Set<string>();
    const messages: MessageSnapshot[] = [];
    for (const snapshot of this.msgIndex.values()) {
      if (seen.has(snapshot.id)) continue;
      seen.add(snapshot.id);
      messages.push(snapshot);
    }
    return messages.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /** Starts a bounded decrypted download before the sender can revoke. */
  private startMediaCapture(msg: WppMsg, maxAgeMs = 0): Promise<MediaVaultRecord | null> | null {
    if (!this.wpp || !this.antiDeleteEnabled || !msg) return null;
    const kind = normalizeMediaKind(msg.type);
    if (!kind) return null;
    if (typeof msg.t === "number" && maxAgeMs > 0 && Date.now() - msg.t * 1000 > maxAgeMs) return null;

    const id = msgKeyToId(msg.id);
    if (!id) return null;
    if (this.mediaCompleted.has(id)) return null;
    const existing = this.mediaTasks.get(id);
    if (existing) return existing;

    const chatId = chatIdOfMessage(msg);
    if (!chatId || isIgnoredChat(chatId)) return null;
    if (typeof this.wpp.chat.downloadMedia !== "function") return null;
    if (typeof msg.size === "number" && msg.size > MAX_MEDIA_BYTES) return null;

    const task = this.withMediaSlot(() => this.captureMedia(msg, id, kind, chatId))
      .catch(() => null)
      .finally(() => {
        this.mediaTasks.delete(id);
      });
    this.mediaTasks.set(id, task);
    return task;
  }

  private async captureMedia(
    msg: WppMsg,
    id: string,
    kind: ReturnType<typeof normalizeMediaKind>,
    chatId: string,
  ): Promise<MediaVaultRecord | null> {
    const wpp = this.wpp;
    if (!wpp?.chat.downloadMedia || !kind) return null;

    const blob = await wpp.chat.downloadMedia(id);
    if (!blob || blob.size === 0 || blob.size > MAX_MEDIA_BYTES) return null;

    const metadata = await inspectMediaBlob(blob, kind);
    const stanzaId = String(msg.id?.id ?? extractStanzaId(id));
    const mimetype = String(msg.mimetype || blob.type || guessMimetype(kind));
    const record = await this.mediaVault.put({
      id,
      stanzaId,
      chatId,
      kind,
      mimetype,
      filename: String(msg.filename ?? ""),
      fileSize: blob.size,
      duration: Number(msg.duration ?? 0) || metadata.duration,
      width: Number(msg.width ?? 0) || metadata.width,
      height: Number(msg.height ?? 0) || metadata.height,
      blob,
      previewDataUrl: messagePreview(msg),
      caption: String(msg.caption ?? "").trim(),
    });

    this.mediaCompleted.add(id);
    while (this.mediaCompleted.size > 2000) {
      const oldest = this.mediaCompleted.values().next().value as string | undefined;
      if (!oldest) break;
      this.mediaCompleted.delete(oldest);
    }

    for (const key of [id, stanzaId, record.id]) {
      const snapshot = key ? this.msgIndex.get(key) : undefined;
      if (!snapshot) continue;
      snapshot.hasFullMedia = true;
      snapshot.mediaType = kind;
      snapshot.mimetype = record.mimetype;
      snapshot.filename = record.filename;
      snapshot.fileSize = record.fileSize;
      snapshot.duration = record.duration;
      snapshot.width = record.width;
      snapshot.height = record.height;
    }

    return record;
  }

  private async withMediaSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.mediaActive >= MEDIA_CONCURRENCY) {
      await new Promise<void>((resolve) => this.mediaWaiters.push(resolve));
    } else {
      this.mediaActive += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.mediaWaiters.shift();
      if (next) next();
      else this.mediaActive = Math.max(0, this.mediaActive - 1);
    }
  }

  private async resolveMediaForRevoke(
    original: MessageSnapshot | undefined,
    candidates: RevokeKeyCandidates,
    beforeMsg?: WppMsg,
  ): Promise<MediaVaultRecord | null> {
    if (beforeMsg) this.startMediaCapture(beforeMsg);

    const keys = [
      original?.id,
      original?.stanzaId,
      ...candidates.fullIds,
      ...candidates.stanzaIds,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    const deadline = Date.now() + 6000;
    for (const key of [...new Set(keys)]) {
      const pending = this.mediaTasks.get(key);
      if (pending) {
        const remaining = Math.max(0, deadline - Date.now());
        await Promise.race([pending.catch(() => null), delay(remaining)]);
      }
      const record = await this.mediaVault.get(key);
      if (record) return record;
    }

    return null;
  }

  private processStoreRevoke(msg: WppMsg): void {
    if (!this.wpp || !msg) return;
    const protocol = msg.protocolMessageKey;
    const candidates = resolveRevokeCandidates({
      protocolFull: msgKeyToId(protocol),
      protocolStanza: protocol?.id,
      afterFull: msgKeyToId(msg.id),
      afterStanza: msg.id?.id,
    });
    const chatId =
      widToId(protocol?.remote) || widToId(msg.id?.remote) || widToId(msg.from) || widToId(msg.to);
    const authorRaw = widToId(msg.author) || widToId(msg.from) || widToId(protocol?.participant);
    void this.processRevoke({
      candidates,
      chatId,
      authorRaw,
      revokeType: String(msg.subtype ?? "revoke"),
      revokeMessageId: msgKeyToId(msg.id),
      // A revoked placeholder keeps the original message's place and time.
      messageAt: typeof msg.t === "number" ? msg.t * 1000 : 0,
    });
  }

  private handleConnectionChange = (): void => {
    if (!this.wpp) return;
    this.bridge.emit("engine.state", this.info());
  };

  /** Engine state shared by ping replies and pushed `engine.state` events. */
  private info(): EngineInfo {
    return { ...engineInfo(this.wpp), slow: this.slow, bootId: this.bootId };
  }

  private handleNewMessage = (raw: unknown): void => {
    if (!this.wpp) return;
    const msg = raw as WppMsg;
    if (!msg) return;

    // Index before any filtering: store/history messages must be recoverable
    // even if they were not emitted as a live chat event.
    const snapshot = this.indexMessage(msg);
    if (!snapshot || msg.type === "revoked" || msg.type === "protocol") return;
    this.startMediaCapture(msg, MEDIA_CAPTURE_WINDOW_MS);

    const timestamp = snapshot.timestamp;
    if (typeof msg.t === "number" && Date.now() - timestamp > 5 * 60_000) return;
    if (!snapshot.chatId || isIgnoredChat(snapshot.chatId)) return;

    const event: IncomingMessageEvent = {
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
      fromMe: snapshot.fromMe,
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
    };

    this.bridge.emit("message.new", event);

    if (!snapshot.fromMe && snapshot.text) {
      const contactId = snapshot.isGroup ? snapshot.sender : snapshot.chatId;
      void this.autoReply
        .maybeReply(this.wpp, {
          chatId: snapshot.chatId,
          contactId,
          senderName: snapshot.senderName,
          text: snapshot.text,
          isGroup: snapshot.isGroup,
          phone: snapshot.sender,
          fromMe: snapshot.fromMe,
        })
        .then((outcome) => {
          if (outcome) this.bridge.emit("autoreply.sent", outcome);
        })
        .catch((error: unknown) => {
          this.bridge.emit("autoreply.error", {
            chatId: snapshot.chatId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
  };

  private handleRevoke = (raw: unknown, beforeRaw?: unknown): void => {
    if (!this.wpp || !this.antiDeleteEnabled) return;
    const data = raw as WppRevokeEvent;
    if (!data) return;

    const before = beforeRaw as WppMsg | undefined;
    const protocol = data.protocolMessageKey;
    const candidates = resolveRevokeCandidates({
      beforeFull: msgKeyToId(before?.id),
      beforeStanza: before?.id?.id,
      protocolFull: msgKeyToId(protocol),
      protocolStanza: protocol?.id,
      afterFull: msgKeyToId(data.id),
      afterStanza: data.id?.id,
      refFull: msgKeyToId(data.refId),
      refStanza: data.refId?.id,
    });

    const chatId =
      widToId(data.refId?.remote) ||
      widToId(data.from) ||
      widToId(before?.id?.remote) ||
      widToId(data.id?.remote);
    const authorRaw =
      widToId(data.author) ||
      widToId(data.refId?.participant) ||
      widToId(data.from) ||
      widToId(before?.author) ||
      widToId(before?.from);

    void this.processRevoke({
      candidates,
      chatId,
      authorRaw,
      revokeType: String(data.type ?? "revoke"),
      revokeMessageId: msgKeyToId(data.id),
      beforeMsg: before,
      messageAt: typeof before?.t === "number" ? before.t * 1000 : 0,
    });
  };

  private async processRevoke(request: {
    candidates: RevokeKeyCandidates;
    chatId: string;
    authorRaw: string;
    revokeType: string;
    revokeMessageId: string;
    beforeMsg?: WppMsg;
    /** When the deleted message was sent (ms), from the store model; 0 if unknown. */
    messageAt?: number;
  }): Promise<void> {
    if (!this.wpp || !this.antiDeleteEnabled) return;

    if (request.beforeMsg) this.indexMessage(request.beforeMsg);
    const original =
      findSnapshotByCandidates(this.msgIndex, request.candidates) ??
      (request.beforeMsg ? this.snapshotMessage(request.beforeMsg) ?? undefined : undefined);

    const refId = original?.id || request.candidates.primary;
    if (!refId) return;

    const dedupeKey = original?.stanzaId || extractStanzaId(refId);
    if (this.processedRevokes.has(dedupeKey)) return;
    this.processedRevokes.add(dedupeKey);
    while (this.processedRevokes.size > 5000) {
      const oldest = this.processedRevokes.values().next().value as string | undefined;
      if (!oldest) break;
      this.processedRevokes.delete(oldest);
    }

    const chatId = original?.chatId || request.chatId;
    if (!chatId || isIgnoredChat(chatId)) return;

    const isGroup = original?.isGroup ?? isGroupChat(chatId);
    const originalRaw =
      original?.sender ||
      widToId(request.beforeMsg?.author) ||
      widToId(request.beforeMsg?.from) ||
      widToId(request.beforeMsg?.id?.participant);
    const authorRaw = request.authorRaw || originalRaw;

    const [revokedBy, senderName, originalPhone, originalName] = await Promise.all([
      authorRaw ? resolvePhone(this.wpp, authorRaw) : Promise.resolve(""),
      authorRaw ? resolveContactName(this.wpp, authorRaw) : Promise.resolve(""),
      originalRaw ? resolvePhone(this.wpp, originalRaw) : Promise.resolve(""),
      originalRaw ? resolveContactName(this.wpp, originalRaw) : Promise.resolve(""),
    ]);

    const media = await this.resolveMediaForRevoke(original, request.candidates, request.beforeMsg);
    const mediaType =
      media?.kind ||
      original?.mediaType ||
      (request.beforeMsg ? normalizeMediaKind(request.beforeMsg.type) : "") ||
      "";
    const mimetype =
      media?.mimetype || original?.mimetype || String(request.beforeMsg?.mimetype ?? "");
    const filename =
      media?.filename || original?.filename || String(request.beforeMsg?.filename ?? "");
    const fileSize =
      media?.fileSize || original?.fileSize || Number(request.beforeMsg?.size ?? 0) || 0;
    const duration =
      media?.duration || original?.duration || Number(request.beforeMsg?.duration ?? 0) || 0;
    const width = media?.width || original?.width || Number(request.beforeMsg?.width ?? 0) || 0;
    const height = media?.height || original?.height || Number(request.beforeMsg?.height ?? 0) || 0;
    const previewDataUrl =
      original?.previewDataUrl ||
      media?.previewDataUrl ||
      (request.beforeMsg ? messagePreview(request.beforeMsg) : "");
    const caption =
      original?.caption || media?.caption || String(request.beforeMsg?.caption ?? "").trim();
    const originalText = original?.text || (request.beforeMsg ? messageText(request.beforeMsg) : "");
    const hasFullMedia = Boolean(media);

    const normalizedOriginal: MessageSnapshot | undefined = original
      ? {
          ...original,
          chatId,
          chatName: original.chatName || chatDisplayName(this.wpp, chatId),
          sender: originalPhone || original.sender,
          senderName: original.senderName || originalName,
          mediaType: mediaType || original.mediaType,
          mimetype: mimetype || original.mimetype,
          filename: filename || original.filename,
          fileSize: fileSize || original.fileSize,
          duration: duration || original.duration,
          width: width || original.width,
          height: height || original.height,
          hasFullMedia,
          caption,
        }
      : undefined;

    const event: RevokedMessageEvent = {
      refId,
      stanzaId: original?.stanzaId || request.candidates.stanzaIds[0] || extractStanzaId(refId),
      revokeMessageId: request.revokeMessageId,
      chatId,
      chatName: normalizedOriginal?.chatName || chatDisplayName(this.wpp, chatId),
      author: authorRaw,
      revokedBy: revokedBy || phoneFromChatId(authorRaw),
      revokeType: request.revokeType,
      timestamp: Date.now(),
      messageTimestamp: original?.timestamp || request.messageAt || 0,
      isGroup,
      senderName,
      originalSenderPhone: originalPhone || normalizedOriginal?.sender || "",
      originalSenderName: normalizedOriginal?.senderName || originalName,
      previewDataUrl,
      caption,
      originalText,
      hasFullMedia,
      mediaType: mediaType || undefined,
      mimetype: mimetype || undefined,
      filename: filename || undefined,
      fileSize,
      duration,
      width,
      height,
      original: normalizedOriginal,
    };

    this.bridge.emit("message.revoked", event);
  }

  private handlePresence = (raw: unknown): void => {
    if (!this.wpp) return;
    const data = raw as WppPresenceEvent;
    const chatId = widToId(data?.id);
    if (!chatId) return;
    const event: PresenceEvent = {
      chatId,
      isOnline: Boolean(data.isOnline),
      state: String(data.state ?? ""),
      shortName: String(data.shortName ?? ""),
      isGroup: Boolean(data.isGroup),
    };
    this.bridge.emit("presence.change", event);
  };

  private requireWpp(): WppApi {
    if (!this.wpp) {
      throw new EngineError("WPP_NOT_READY", "WhatsApp Web engine is not ready yet. Reload the page if this persists.");
    }
    return this.wpp;
  }

  private async handleCommand(cmd: string, rawParams: unknown): Promise<unknown> {
    const params = rawParams === undefined || rawParams === null ? {} : asRecord(rawParams);

    switch (cmd) {
      case BRIDGE_COMMANDS.ping:
        return this.ping();

      case BRIDGE_COMMANDS.privacyApply: {
        const wpp = this.requireWpp();
        const settings = mergeSettings({ privacy: params }).privacy;
        return this.privacy.apply(wpp, settings);
      }

      case BRIDGE_COMMANDS.sendText: {
        const wpp = this.requireWpp();
        const chatId = normalizeChatId(strParam(params, "chatId", { required: true, max: 120 }));
        if (!chatId) throw new EngineError("INVALID_CHAT", "Invalid chat id");
        const text = strParam(params, "text", { required: true, max: UI_LIMITS.maxMessageLength });
        const result = await wpp.chat.sendTextMessage(chatId, text, { createChat: true, markIsRead: false });
        return serializeSend(result);
      }

      case BRIDGE_COMMANDS.sendFile: {
        const wpp = this.requireWpp();
        const chatId = normalizeChatId(strParam(params, "chatId", { required: true, max: 120 }));
        if (!chatId) throw new EngineError("INVALID_CHAT", "Invalid chat id");
        const dataUrl = strParam(params, "dataUrl", { required: true, max: 7_500_000 });
        if (!dataUrl.startsWith("data:")) throw new EngineError("INVALID_FILE", "Attachment must be a data URL");
        const type = strParam(params, "type", { max: 20 }) || "document";
        const allowed = new Set(["image", "video", "audio", "document", "sticker"]);
        if (!allowed.has(type)) throw new EngineError("INVALID_FILE", "Unsupported attachment type");
        const caption = strParam(params, "caption", { max: 1024 });
        const filename = strParam(params, "filename", { max: 180 });
        const mimetype = strParam(params, "mimetype", { max: 120 });
        const result = await wpp.chat.sendFileMessage(chatId, dataUrl, {
          type,
          caption,
          filename,
          mimetype,
          createChat: true,
        });
        return serializeSend(result);
      }

      case BRIDGE_COMMANDS.validateContact: {
        const wpp = this.requireWpp();
        const input = strParam(params, "chatId", { required: true, max: 120 });
        const chatId = normalizeChatId(input);
        if (!chatId) throw new EngineError("INVALID_CHAT", "Invalid chat id");
        const result = await wpp.contact.queryWidExists(chatId);
        const validation: ValidationResult = {
          input,
          exists: Boolean(result),
          chatId: widToId(result?.wid) || chatId,
          error: result ? "" : "not-found",
        };
        return validation;
      }

      case BRIDGE_COMMANDS.openChat: {
        const wpp = this.requireWpp();
        const chatId = normalizeChatId(strParam(params, "chatId", { required: true, max: 120 }));
        if (!chatId) throw new EngineError("INVALID_CHAT", "Invalid chat id");
        const opened = await wpp.chat.openChatBottom(chatId);
        return { opened: Boolean(opened), chatId };
      }

      case BRIDGE_COMMANDS.setTyping: {
        const wpp = this.requireWpp();
        const chatId = normalizeChatId(strParam(params, "chatId", { required: true, max: 120 }));
        const duration = Math.min(30_000, Math.max(0, Number(params.duration ?? 2000)));
        await wpp.chat.markIsComposing(chatId, duration);
        return { ok: true };
      }

      case BRIDGE_COMMANDS.activeChat: {
        const wpp = this.requireWpp();
        const chat = wpp.chat.getActiveChat();
        const chatId = widToId(chat?.id);
        return { chatId, name: chat?.name || chat?.formattedTitle || chatId || "" };
      }

      case BRIDGE_COMMANDS.setInput: {
        const wpp = this.requireWpp();
        const text = strParam(params, "text", { required: true, max: 4096 });
        const chatId = strParam(params, "chatId", { max: 120 });
        await wpp.chat.setInputText(text, chatId || undefined);
        return { ok: true };
      }

      case BRIDGE_COMMANDS.listGroups: {
        const wpp = this.requireWpp();
        const groups: GroupSummary[] = await listGroups(wpp);
        return { groups };
      }

      case BRIDGE_COMMANDS.groupParticipants: {
        const wpp = this.requireWpp();
        const groupId = strParam(params, "groupId", { required: true, max: 120 });
        if (!isGroupChatId(groupId)) throw new EngineError("INVALID_GROUP", "Invalid group id");
        const participants: GroupParticipantRow[] = await listGroupParticipants(wpp, groupId);
        return { participants };
      }

      case BRIDGE_COMMANDS.listContacts: {
        const wpp = this.requireWpp();
        const onlyMyContacts = boolParam(params, "onlyMyContacts", true);
        const contacts: ContactRow[] = await listContacts(wpp, onlyMyContacts);
        return { contacts };
      }

      case BRIDGE_COMMANDS.listChats: {
        const wpp = this.requireWpp();
        const chats: ContactRow[] = await listChats(wpp);
        return { chats };
      }

      case BRIDGE_COMMANDS.startChat: {
        const wpp = this.requireWpp();
        const phoneInput = strParam(params, "phone", { required: true, max: 40 });
        const countryCode = strParam(params, "countryCode", { max: 5 }).replace(/\D/g, "");
        const sanitized = sanitizePhone(phoneInput, countryCode);
        if (!sanitized.valid) {
          throw new EngineError("INVALID_PHONE", `Invalid phone number (${sanitized.reason})`);
        }
        const query = await wpp.contact.queryWidExists(sanitized.chatId);
        if (!query) throw new EngineError("CONTACT_NOT_FOUND", "This number is not registered on WhatsApp");
        const chatId = widToId(query.wid) || sanitized.chatId;
        const opened = await wpp.chat.openChatBottom(chatId);
        const message = strParam(params, "message", { max: UI_LIMITS.maxMessageLength });
        let sent = false;
        if (message) {
          await wpp.chat.sendTextMessage(chatId, message, { createChat: true, markIsRead: false });
          sent = true;
        }
        return { chatId, opened: Boolean(opened), sent };
      }

      case BRIDGE_COMMANDS.configureAutoReply: {
        const config = mergeSettings({ autoReply: params }).autoReply;
        this.autoReply.configure(config);
        return { enabled: config.enabled, rules: config.rules.length };
      }

      case BRIDGE_COMMANDS.preindexMessages: {
        this.requireWpp();
        const limit = Math.min(
          2000,
          Math.max(100, Number.isFinite(Number(params.limit)) ? Math.round(Number(params.limit)) : 1000),
        );
        this.indexExistingMessages();
        return { messages: this.getIndexedSnapshots(limit) };
      }

      case BRIDGE_COMMANDS.revokedIndex: {
        this.requireWpp();
        return { rows: this.revokedRowIndex() };
      }

      case BRIDGE_COMMANDS.configureAntiDelete: {
        this.antiDeleteEnabled = boolParam(params, "enabled", true);
        return { enabled: this.antiDeleteEnabled };
      }

      default:
        throw new EngineError("UNKNOWN_COMMAND", `Unknown command: ${cmd}`);
    }
  }

  private ping(): EnginePingResult {
    return {
      ...this.info(),
      engineVersion: ENGINE_VERSION,
      supportedWhatsappWeb: SUPPORTED_WA_JS,
    };
  }

  private meId(): string {
    return this.wpp ? engineInfo(this.wpp).me : "";
  }

  // Exposed for diagnostics/debugging in the page console.
  describe(): { ready: boolean; me: string; eventsAttached: boolean } {
    return { ready: Boolean(this.wpp), me: this.meId(), eventsAttached: this.eventsAttached };
  }
}

const engine = new MadarEngine();
window.__MADARWA_ENGINE__ = { version: ENGINE_VERSION, ready: false };

// Keep a reference alive for the page lifetime and expose a read-only diagnostic.
Object.defineProperty(window, "__MADARWA_DIAGNOSTICS__", {
  configurable: true,
  get: () => engine.describe(),
});
