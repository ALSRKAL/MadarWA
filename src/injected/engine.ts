import { BRIDGE_COMMANDS, ENGINE_VERSION, UI_LIMITS } from "../shared/constants";
import { BridgeEngine } from "../shared/bridge/bridge";
import { mergeSettings } from "../shared/defaults";
import type {
  ContactRow,
  EnginePingResult,
  GroupParticipantRow,
  GroupSummary,
  IncomingMessageEvent,
  MessageSnapshot,
  PresenceEvent,
  RevokedMessageEvent,
  SendResult,
  ValidationResult,
} from "../shared/types";
import { isGroupChatId, normalizeChatId, phoneFromChatId, sanitizePhone } from "../shared/utils/phone";
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
  private wpp: WppApi | null = null;
  private eventsAttached = false;
  private eventRetries = 0;
  private storeAttached = false;
  private antiDeleteEnabled = true;
  private readonly msgIndex = new Map<string, MessageSnapshot>();
  private readonly processedRevokes = new Set<string>();
  private readonly privacy = new PrivacyController();
  private readonly autoReply = new AutoReplyController();

  constructor() {
    this.bridge = new BridgeEngine({ commandHandler: (cmd, params) => this.handleCommand(cmd, params) });
    this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    try {
      const wpp = await waitForWpp();
      this.wpp = wpp;
      this.attachEvents();
      this.attachStoreEvents();
      this.indexExistingMessages();
      window.setTimeout(() => this.indexExistingMessages(), 4000);
      const info = engineInfo(wpp);
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
      for (const msg of models.slice(-500)) this.indexMessage(msg);
    } catch {
      // Store may be unavailable during a WhatsApp reload; live add events cover it.
    }
  }

  private handleStoreAdd = (raw: unknown): void => {
    this.indexMessage(raw as WppMsg);
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
    });
  }

  private handleConnectionChange = (): void => {
    if (!this.wpp) return;
    this.bridge.emit("engine.state", engineInfo(this.wpp));
  };

  private handleNewMessage = (raw: unknown): void => {
    if (!this.wpp) return;
    const msg = raw as WppMsg;
    if (!msg) return;

    // Index before any filtering: store/history messages must be recoverable
    // even if they were not emitted as a live chat event.
    const snapshot = this.indexMessage(msg);
    if (!snapshot || msg.type === "revoked" || msg.type === "protocol") return;

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
    });
  };

  private async processRevoke(request: {
    candidates: RevokeKeyCandidates;
    chatId: string;
    authorRaw: string;
    revokeType: string;
    revokeMessageId: string;
    beforeMsg?: WppMsg;
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

    const normalizedOriginal: MessageSnapshot | undefined = original
      ? {
          ...original,
          chatId,
          chatName: original.chatName || chatDisplayName(this.wpp, chatId),
          sender: originalPhone || original.sender,
          senderName: original.senderName || originalName,
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
      isGroup,
      senderName,
      originalSenderPhone: originalPhone || normalizedOriginal?.sender || "",
      originalSenderName: normalizedOriginal?.senderName || originalName,
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

      case BRIDGE_COMMANDS.configureAntiDelete: {
        this.antiDeleteEnabled = boolParam(params, "enabled", true);
        return { enabled: this.antiDeleteEnabled };
      }

      default:
        throw new EngineError("UNKNOWN_COMMAND", `Unknown command: ${cmd}`);
    }
  }

  private ping(): EnginePingResult {
    const info = engineInfo(this.wpp);
    return {
      ...info,
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
