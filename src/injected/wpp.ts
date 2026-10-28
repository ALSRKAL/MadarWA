import type { EngineInfo } from "../shared/types";
import { phoneFromChatId, sanitizePhone } from "../shared/utils/phone";

/* Minimal, explicit typing of the @wppconnect/wa-js 4.7.x surface we call. */

export interface WppWid {
  _serialized?: string;
  user?: string;
  server?: string;
  toString(): string;
}

export interface WppMsgKey {
  _serialized?: string;
  id?: string;
  remote?: WppWid;
  participant?: WppWid;
  fromMe?: boolean;
}

export interface WppMsg {
  id?: WppMsgKey;
  body?: string;
  caption?: string;
  type?: string;
  subtype?: string | null;
  t?: number;
  notifyName?: string;
  filename?: string;
  from?: WppWid;
  to?: WppWid;
  author?: WppWid;
  fromMe?: boolean;
  isNewMsg?: boolean;
  isMedia?: boolean;
  ack?: number;
  protocolMessageKey?: WppMsgKey;
  mediaData?: { preview?: unknown };
}

export interface WppChat {
  id?: WppWid;
  name?: string;
  formattedTitle?: string;
  isGroup?: boolean;
  isUser?: boolean;
  unreadCount?: number;
  groupMetadata?: {
    subject?: string;
    participants?: { length?: number } | unknown[];
  };
}

export interface WppContact {
  id?: WppWid;
  name?: string;
  pushname?: string;
  shortName?: string;
  formattedName?: string;
  isMyContact?: boolean;
  isWAContact?: boolean;
}

export interface WppParticipant {
  id?: WppWid;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

export interface WppSendResult {
  id?: string | WppMsgKey;
  ack?: number;
  t?: number;
}

export interface WppRevokeEvent {
  author?: WppWid;
  from?: WppWid;
  to?: WppWid;
  id?: WppMsgKey;
  refId?: WppMsgKey;
  protocolMessageKey?: WppMsgKey;
  type?: string;
}

export interface WppPresenceEvent {
  id?: WppWid;
  isOnline?: boolean;
  isGroup?: boolean;
  isUser?: boolean;
  shortName?: string;
  state?: string;
  t?: number;
  isContact?: boolean;
}

export interface WppFileOptions {
  type?: string;
  caption?: string;
  filename?: string;
  mimetype?: string;
  isViewOnce?: boolean;
  isPtt?: boolean;
  isGif?: boolean;
}

export interface WppApi {
  version?: string;
  supportedWhatsappWeb?: string;
  loader?: {
    isReady?: boolean;
    isFullReady?: boolean;
    loaderType?: string;
    onReady?: (listener: () => void, delay?: number) => void;
  };
  webpack?: {
    isReady?: boolean;
    onReady?: (listener: () => void, delay?: number) => void;
  };
  chat: {
    sendTextMessage: (chatId: string, content: string, options?: Record<string, unknown>) => Promise<WppSendResult>;
    sendFileMessage: (chatId: string, content: string, options: WppFileOptions) => Promise<WppSendResult>;
    openChatBottom: (chatId: string) => Promise<boolean>;
    markIsComposing: (chatId: string, duration?: number) => Promise<void>;
    setInputText: (text: string, chatId?: string) => Promise<unknown>;
    get: (chatId: string) => WppChat | undefined;
    getActiveChat: () => WppChat | undefined;
    list: (options?: Record<string, unknown>) => Promise<WppChat[]>;
    markPlayed?: (messageId: unknown) => Promise<unknown>;
    markIsRead?: (chatId: unknown) => Promise<unknown>;
    markMessageAsRead?: (message: unknown) => Promise<unknown>;
  };
  contact: {
    queryWidExists: (chatId: string) => Promise<{ wid?: WppWid } | null>;
    get: (contactId: string) => Promise<WppContact | undefined>;
    list: (options?: { onlyMyContacts?: boolean }) => Promise<WppContact[]>;
    getPnLidEntry?: (contactId: string | WppWid) => Promise<{
      phoneNumber?: WppWid;
      contact?: { name?: string; pushname?: string; shortName?: string };
    }>;
  };
  group: {
    getAllGroups: () => Promise<Array<WppChat | undefined>>;
    getParticipants: (groupId: string) => Promise<WppParticipant[]>;
  };
  privacy: {
    get: () => Promise<Record<string, string>>;
    setReadReceipts: (value: "all" | "none") => Promise<string>;
    setOnline: (value: "all" | "match_last_seen") => Promise<string>;
  };
  conn: {
    isAuthenticated: () => boolean;
    getMyUserWid: () => WppWid;
    isOnline?: () => boolean;
  };
  whatsapp?: {
    functions?: Record<string, unknown>;
    MsgStore?: {
      getModelsArray?: () => WppMsg[];
      on?: (event: string, listener: (...args: any[]) => void) => unknown;
      off?: (event: string, listener: (...args: any[]) => void) => unknown;
      length?: number;
    };
  };
  on: (event: string, listener: (...args: any[]) => void) => unknown;
}

declare global {
  interface Window {
    WPP?: WppApi;
    __MADARWA_ENGINE__?: { version: string; ready: boolean };
    __MADARWA_DIAGNOSTICS__?: { ready: boolean; me: string; eventsAttached: boolean };
  }
}

export function widToId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const wid = value as WppWid;
  if (typeof wid._serialized === "string" && wid._serialized) return wid._serialized;
  try {
    const text = wid.toString();
    if (text && text !== "[object Object]") return text;
  } catch {
    // ignore
  }
  if (wid.user) return `${wid.user}@${wid.server ?? "c.us"}`;
  return "";
}

export function msgKeyToId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const key = value as WppMsgKey;
  if (typeof key._serialized === "string" && key._serialized) return key._serialized;
  const remote = widToId(key.remote);
  if (key.id && remote) return `${key.fromMe ? "true" : "false"}_${remote}_${key.id}`;
  return "";
}

export function chatIdOfMessage(msg: WppMsg): string {
  const remote = widToId(msg.id?.remote);
  if (remote) return remote;
  const from = widToId(msg.from);
  if (from && !from.endsWith("@c.us")) return from;
  const to = widToId(msg.to);
  return msg.id?.fromMe || msg.fromMe ? to : from;
}

export function senderIdOfMessage(msg: WppMsg, meId: string): string {
  if (msg.id?.fromMe || msg.fromMe) return meId;
  return widToId(msg.author) || widToId(msg.from) || widToId(msg.id?.participant);
}

export function messageText(msg: WppMsg): string {
  const type = String(msg.type ?? "chat");
  const body = String(msg.body ?? "");
  const caption = String(msg.caption ?? "").trim();

  // For media, `body` may be a base64 thumbnail (especially image/video/sticker).
  // Never ship that as the message text.
  if (type !== "chat" && type !== "text") {
    if (caption) return caption;
    if (body.startsWith("data:")) return "";
    if (type === "document") return String(msg.filename ?? "").trim() || body.trim();
    return "";
  }
  return (body || caption).trim();
}

export function messagePreview(msg: WppMsg): string {
  const type = String(msg.type ?? "");
  if (!["image", "video", "sticker"].includes(type)) return "";
  const mediaPreview = typeof msg.mediaData?.preview === "string" ? msg.mediaData.preview : "";
  const body = String(msg.body ?? "");
  const raw = mediaPreview || (body.startsWith("data:image") ? body : "");
  if (!raw) return "";
  if (raw.startsWith("data:image")) return raw.slice(0, 180_000);
  if (raw.length > 80 && /^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    const mime = type === "sticker" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${raw.replace(/\s+/g, "")}`.slice(0, 180_000);
  }
  return "";
}

export function isGroupChat(chatId: string): boolean {
  return /@g\.us$/i.test(chatId);
}

export function isIgnoredChat(chatId: string): boolean {
  return /@(broadcast|newsletter|status)$/i.test(chatId) || chatId === "status@broadcast";
}

export function waitForWpp(timeoutMs = 120_000): Promise<WppApi> {
  const ready = (wpp: WppApi | undefined): wpp is WppApi => {
    if (!wpp) return false;
    if (wpp.loader?.isReady === true) return true;
    if (wpp.webpack?.isReady === true) return true;
    return false;
  };

  if (ready(window.WPP)) return Promise.resolve(window.WPP);

  return new Promise<WppApi>((resolve, reject) => {
    let finished = false;
    let interval = 0;
    let timeout = 0;

    const finish = () => {
      if (finished) return;
      const wpp = window.WPP;
      if (!ready(wpp)) return;
      finished = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      resolve(wpp);
    };

    const fail = () => {
      if (finished) return;
      finished = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      reject(new Error("WPP_READY_TIMEOUT"));
    };

    const loader = window.WPP?.loader ?? window.WPP?.webpack;
    if (loader?.onReady) {
      try {
        loader.onReady(finish);
      } catch {
        // polling below covers builds without loader hooks
      }
    }

    interval = window.setInterval(finish, 350);
    timeout = window.setTimeout(fail, timeoutMs);
    finish();
  });
}

export function engineInfo(wpp: WppApi | null): EngineInfo {
  if (!wpp) {
    return { ready: false, wppVersion: "", me: "", connected: false };
  }
  let connected = false;
  let me = "";
  try {
    connected = wpp.conn.isAuthenticated();
  } catch {
    connected = false;
  }
  try {
    me = widToId(wpp.conn.getMyUserWid());
  } catch {
    me = "";
  }
  return {
    ready: true,
    wppVersion: wpp.version ?? "unknown",
    me,
    connected,
  };
}

export function chatDisplayName(wpp: WppApi, chatId: string): string {
  try {
    const chat = wpp.chat.get(chatId);
    return chat?.name || chat?.formattedTitle || chat?.groupMetadata?.subject || chatId;
  } catch {
    return chatId;
  }
}

export async function resolvePhone(wpp: WppApi, rawId: string): Promise<string> {
  const id = String(rawId ?? "");
  if (!id) return "";
  if (id.includes("@lid") && wpp.contact.getPnLidEntry) {
    try {
      const entry = await wpp.contact.getPnLidEntry(id);
      const phone = widToId(entry.phoneNumber);
      if (phone) return phoneFromChatId(phone);
    } catch {
      // LID resolution is best-effort; fall through to the numeric id.
    }
  }
  return phoneFromChatId(id);
}

export async function resolveContactName(wpp: WppApi, rawId: string): Promise<string> {
  const id = String(rawId ?? "");
  if (!id) return "";
  try {
    const contact = await wpp.contact.get(id);
    return contact?.name || contact?.pushname || contact?.shortName || contact?.formattedName || "";
  } catch {
    return "";
  }
}

export async function resolveCanonicalChatId(wpp: WppApi, raw: string): Promise<string> {
  const sanitized = sanitizePhone(raw);
  const candidate = sanitized.valid ? sanitized.chatId : raw;
  if (!candidate.includes("@")) return candidate;
  try {
    const result = await wpp.contact.queryWidExists(candidate);
    const resolved = widToId(result?.wid);
    return resolved || candidate;
  } catch {
    return candidate;
  }
}

export function groupParticipantsCount(chat: WppChat | undefined): number {
  const participants = chat?.groupMetadata?.participants;
  if (Array.isArray(participants)) return participants.length;
  if (participants && typeof participants === "object") {
    const length = (participants as { length?: number }).length;
    return typeof length === "number" ? length : 0;
  }
  return 0;
}

export async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await mapper(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}
