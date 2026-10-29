/**
 * Shared domain types for every MadarWA execution context.
 * These types are serialization contracts across the bridge, storage and UI.
 */

export type Language = "ar" | "en";

export interface PrivacySettings {
  blurPreview: boolean;
  blurNames: boolean;
  blurPhoneNumbers: boolean;
  blurAvatars: boolean;
  blurMessages: boolean;
  blurMedia: boolean;
  blurComposer: boolean;
  hidePresence: boolean;
  hideTyping: boolean;
  hideRecording: boolean;
  disableReadReceipts: boolean;
  privateStatusView: boolean;
  suppressDeliveryReceipts: boolean;
  disableAudioReceipts: boolean;
}

export type InlineRestoreMode = "interactive" | "expanded";

export interface AntiDeleteSettings {
  enabled: boolean;
  inChatToast: boolean;
  desktopNotification: boolean;
  inlineRestore: boolean;
  inlineMode: InlineRestoreMode;
  maxCache: number;
}

export type RuleMatchType = "exact" | "contains" | "startsWith" | "regex" | "fallback";
export type RuleScope = "private" | "groups" | "all";

export interface AutoReplyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: RuleMatchType;
  pattern: string;
  response: string;
  scope: RuleScope;
  cooldownMinutes: number;
  typingSeconds: number;
}

export interface QuickTemplate {
  id: string;
  label: string;
  text: string;
}

export interface AutoReplySettings {
  enabled: boolean;
  rules: AutoReplyRule[];
  templates: QuickTemplate[];
}

export interface BroadcasterSettings {
  minDelaySec: number;
  maxDelaySec: number;
  batchSize: number;
  batchCooldownSec: number;
  randomizeWithSpintax: boolean;
  validateNumbers: boolean;
  defaultCountryCode: string;
}

export interface WebhookSettings {
  enabled: boolean;
  url: string;
  token: string;
  forwardMessages: boolean;
  forwardRevoked: boolean;
}

export interface PinSettings {
  enabled: boolean;
  hash: string;
  salt: string;
  idleMinutes: number;
}

export interface AppSettings {
  version: number;
  language: Language;
  privacy: PrivacySettings;
  antiDelete: AntiDeleteSettings;
  autoReply: AutoReplySettings;
  broadcaster: BroadcasterSettings;
  webhook: WebhookSettings;
  pin: PinSettings;
  defaultCountryCode: string;
  updatedAt: number;
}

/** Media metadata shared by snapshots, cache entries and revoke events. */
export interface MediaMetadata {
  hasFullMedia?: boolean;
  mediaType?: string;
  mimetype?: string;
  filename?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  caption?: string;
}

export interface MessageSnapshot extends MediaMetadata {
  id: string;
  stanzaId: string;
  chatId: string;
  chatName: string;
  sender: string;
  senderName: string;
  text: string;
  messageType: string;
  timestamp: number;
  isGroup: boolean;
  fromMe: boolean;
  previewDataUrl: string;
}

export interface CachedMessage extends MediaMetadata {
  id: string;
  stanzaId?: string;
  chatId: string;
  chatName: string;
  sender: string;
  senderName: string;
  text: string;
  messageType: string;
  timestamp: number;
  isGroup?: boolean;
  previewDataUrl?: string;
}

export interface DeletedMessage extends CachedMessage {
  revokedAt: number;
  revokedBy: string;
  revokeType: string;
  recoveredFromCache: boolean;
  /** Full id of the revoke placeholder; its stanza is the real DOM data-id. */
  revokeMessageId?: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  participantsCount: number;
}

export interface ContactRow {
  id: string;
  phone: string;
  formattedPhone: string;
  name: string;
  isMyContact: boolean;
}

export interface GroupParticipantRow extends ContactRow {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  groupId: string;
  groupName: string;
}

export type RecipientStatus = "pending" | "sending" | "sent" | "failed" | "invalid" | "skipped";

export interface CampaignRecipient {
  phone: string;
  chatId: string;
  name: string;
  custom1: string;
  custom2: string;
  status: RecipientStatus;
  reason: string;
}

export type CampaignStatus = "idle" | "running" | "paused" | "stopped" | "completed";

export interface CampaignLogEntry {
  index: number;
  phone: string;
  status: RecipientStatus;
  detail: string;
  at: number;
}

export interface CampaignState {
  id: string;
  status: CampaignStatus;
  total: number;
  processed: number;
  sent: number;
  failed: number;
  invalid: number;
  startedAt: number;
  finishedAt: number;
  logs: CampaignLogEntry[];
  /** Auto-paused because WhatsApp is unreachable; resumes by itself when it is back. */
  waitingForConnection?: boolean;
}

export interface WebhookLogEntry {
  id: string;
  at: number;
  url: string;
  ok: boolean;
  status: number;
  error: string;
  event: string;
  /** Delivery attempts including retries of transient failures. */
  attempts?: number;
}

export interface PrivacyGuardStatus {
  active: boolean;
  patched: number;
  unsupported: number;
  audioActive?: boolean;
  statusActive?: boolean;
  deliveryActive?: boolean;
  deliveryPatched?: number;
  deliveryUnsupported?: number;
  deliveryModules?: string[];
}

export interface EngineInfo {
  ready: boolean;
  wppVersion: string;
  me: string;
  connected: boolean;
  /** WhatsApp Web has been loading for longer than expected; the engine keeps waiting. */
  slow?: boolean;
  /** Random id of the MAIN-world engine instance; changes only when the engine restarts. */
  bootId?: string;
}

export interface IncomingMessageEvent extends MediaMetadata {
  id: string;
  stanzaId?: string;
  chatId: string;
  chatName: string;
  sender: string;
  senderName: string;
  text: string;
  messageType: string;
  timestamp: number;
  isGroup: boolean;
  fromMe: boolean;
  previewDataUrl?: string;
}

export interface RevokedRowIndexEntry {
  revokeFull: string;
  revokeStanza: string;
  originalFull: string;
  originalStanza: string;
  chatId: string;
  timestamp: number;
}

export interface RevokedMessageEvent extends MediaMetadata {
  refId: string;
  stanzaId?: string;
  revokeMessageId?: string;
  chatId: string;
  chatName: string;
  author: string;
  revokedBy: string;
  revokeType: string;
  /** When the engine saw the deletion. */
  timestamp: number;
  /** When the deleted message was sent, if known (also for deletions whose text never arrived). */
  messageTimestamp?: number;
  isGroup: boolean;
  senderName?: string;
  originalSenderPhone?: string;
  originalSenderName?: string;
  previewDataUrl?: string;
  originalText?: string;
  original?: MessageSnapshot;
}

export interface PresenceEvent {
  chatId: string;
  isOnline: boolean;
  state: string;
  shortName: string;
  isGroup: boolean;
}

export interface AutoReplySentEvent {
  chatId: string;
  ruleId: string;
  ruleName: string;
  text: string;
  at: number;
}

export interface EngineReadyEvent {
  ready: boolean;
  wppVersion: string;
  me: string;
}

export interface BridgeErrorShape {
  code: string;
  message: string;
}

export interface EnginePingResult extends EngineInfo {
  engineVersion: string;
  supportedWhatsappWeb: string;
}

export interface SendResult {
  id: string;
  ack?: number;
  timestamp?: number;
}

export interface ValidationResult {
  input: string;
  exists: boolean;
  chatId: string;
  error: string;
}

export interface WebhookPayload {
  event: "message" | "revoked" | "test";
  source: "madarwa";
  at: number;
  data: Record<string, unknown>;
}
