export const EXTENSION_NAME = "MadarWA";
export const EXTENSION_VERSION = "1.0.0";
export const ENGINE_VERSION = "1.0.0";

export const WHATSAPP_ORIGIN = "https://web.whatsapp.com";

export const STORAGE_KEYS = {
  settings: "madarwa:settings",
  vault: "madarwa:vault",
  messageCache: "madarwa:message-cache",
  webhookLog: "madarwa:webhook-log",
  campaignReport: "madarwa:campaign-report",
} as const;

export const RUNTIME_MESSAGES = {
  webhookDeliver: "MADARWA_WEBHOOK_DELIVER",
  webhookTest: "MADARWA_WEBHOOK_TEST",
  badgeSet: "MADARWA_BADGE_SET",
  notify: "MADARWA_NOTIFY",
  ping: "MADARWA_PING",
  openPanel: "MADARWA_OPEN_PANEL",
  lockPanel: "MADARWA_LOCK_PANEL",
  status: "MADARWA_STATUS",
} as const;

export const BRIDGE = {
  namespace: "madarwa",
  version: 1,
  handshake: "madarwa:handshake",
  handshakeAck: "madarwa:handshake:ack",
  engineReady: "MADARWA_ENGINE_READY",
  commandRequest: "MADARWA_CMD_REQUEST",
  commandResponse: "MADARWA_CMD_RESPONSE",
  eventStream: "MADARWA_EVENT_STREAM",
  handshakeRetryMs: 500,
  requestTimeoutMs: 30_000,
  longRequestTimeoutMs: 120_000,
  maxEnvelopeBytes: 8_000_000,
} as const;

export const BRIDGE_COMMANDS = {
  ping: "engine.ping",
  privacyApply: "privacy.apply",
  sendText: "message.sendText",
  sendFile: "message.sendFile",
  validateContact: "contact.validate",
  openChat: "chat.open",
  setTyping: "chat.setTyping",
  setInput: "chat.setInput",
  activeChat: "chat.active",
  listGroups: "exporter.groups",
  groupParticipants: "exporter.groupParticipants",
  listContacts: "exporter.contacts",
  listChats: "exporter.chats",
  startChat: "tools.startChat",
  configureAutoReply: "autoreply.configure",
  configureAntiDelete: "antidelete.configure",
  preindexMessages: "antidelete.preindex",
} as const;

export const QUICK_TOOLS = {
  sessionIdleMinutes: 15,
  maxVaultEntries: 1000,
  maxWebhookLog: 60,
  maxCacheMessages: 800,
} as const;

export const UI_LIMITS = {
  maxCampaignRecipients: 20_000,
  maxMessageLength: 4096,
  maxPatternLength: 200,
  maxWebhookTokenLength: 256,
} as const;
