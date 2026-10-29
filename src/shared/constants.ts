export const EXTENSION_NAME = "MadarWA";
export const EXTENSION_VERSION = "1.0.0";
export const ENGINE_VERSION = "1.0.0";

export const WHATSAPP_ORIGIN = "https://web.whatsapp.com";
export const WHATSAPP_URL = `${WHATSAPP_ORIGIN}/`;
export const WHATSAPP_TAB_PATTERN = `${WHATSAPP_ORIGIN}/*`;

export const PROJECT_URL = "https://github.com/ALSRKAL/MadarWA";
export const PROJECT_DOCS_URL = `${PROJECT_URL}#readme`;

/** Language names are shown in their own script and never translated. */
export const LANGUAGE_LABELS = { ar: "عربي", en: "EN" } as const;

export const STORAGE_KEYS = {
  settings: "madarwa:settings",
  vault: "madarwa:vault",
  /** When the user last looked at the vault; newer entries count as unseen. */
  vaultSeenAt: "madarwa:vault-seen-at",
  /** When MadarWA started (or restarted) keeping copies in this browser. */
  captureSince: "madarwa:capture-since",
  /** When the user last cleared the vault. */
  vaultClearedAt: "madarwa:vault-cleared-at",
  messageCache: "madarwa:message-cache",
  webhookLog: "madarwa:webhook-log",
  campaignReport: "madarwa:campaign-report",
} as const;

/**
 * Colours needed outside the panel's CSS tokens (src/content/styles/shadow.css):
 * the mark (src/shared/brand.ts), the toolbar badge and the launcher inside
 * WhatsApp's header. Same values as --wa-accent, --wa-satellite and the state
 * tokens.
 */
export const BRAND_COLORS = {
  /** The mark's tile. */
  accent: "#19694f",
  /** The planet and ring on the tile. */
  onAccent: "#ffffff",
  /** The mark's satellite, and the unseen count, which often sits on the tile. */
  satellite: "#f2b33d",
  onSatellite: "#131416",
  waiting: "#b45309",
  offline: "#c4242a",
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
  /** Heartbeat interval while connected; the probe itself is synchronous. */
  steadyHandshakeMs: 3000,
  /** A connection is only declared lost when a probe fails AND no ack arrived for this long. */
  staleAfterMs: 15_000,
  /** How long a command waits for a momentarily lost connection before failing. */
  connectGraceMs: 4000,
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
  revokedIndex: "antidelete.revokedIndex",
} as const;

/** Webhook delivery policy (service worker). */
export const WEBHOOK = {
  timeoutMs: 20_000,
  maxBodyBytes: 512_000,
  /** Waits before each retry of a transient failure; two retries after the first attempt. */
  retryDelaysMs: [1000, 4000],
  /** Upper bound for a receiver's Retry-After hint. */
  maxRetryAfterMs: 10_000,
  /** Same id on every retry so receivers can drop duplicates. */
  deliveryHeader: "X-MadarWA-Delivery",
} as const;

/** Campaign safety policy. */
export const CAMPAIGN = {
  /** Per-recipient failures in a row before the campaign pauses itself for review. */
  maxConsecutiveFailures: 5,
  /** Retries of a send that never reached WhatsApp (safe: nothing was sent). */
  maxTransportRetries: 3,
  /** Safety-net poll while waiting for WhatsApp to come back. */
  connectionPollMs: 2000,
  /** Bridge envelope limit for attachments. */
  maxAttachmentBytes: 4 * 1024 * 1024,
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
