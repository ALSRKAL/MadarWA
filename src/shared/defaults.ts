import type { AppSettings } from "./types";

export const SETTINGS_VERSION = 1;

export function createDefaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    language: "ar",
    theme: "auto",
    privacy: {
      blurPreview: false,
      blurNames: false,
      blurAvatars: false,
      blurMessages: false,
      blurMedia: false,
      hidePresence: false,
      hideTyping: false,
      disableReadReceipts: false,
      disableAudioReceipts: false,
    },
    antiDelete: {
      enabled: true,
      inChatToast: true,
      desktopNotification: false,
      inlineRestore: true,
      maxCache: 800,
    },
    autoReply: {
      enabled: false,
      rules: [
        {
          id: "rule-welcome",
          name: "رسالة الترحيب",
          enabled: false,
          matchType: "fallback",
          pattern: "",
          response: "أهلاً بك {{name}}، كيف يمكننا مساعدتك؟",
          scope: "private",
          cooldownMinutes: 240,
          typingSeconds: 2,
        },
      ],
      templates: [
        {
          id: "tpl-1",
          label: "ترحيب",
          text: "أهلاً وسهلاً {{name}}، سعداء بتواصلك معنا.",
        },
        {
          id: "tpl-2",
          label: "شكراً",
          text: "شكراً لتواصلك، سيتم الرد عليك في أقرب وقت.",
        },
        {
          id: "tpl-3",
          label: "الأسعار",
          text: "يمكنك إرسال تفاصيل طلبك وسنوافيك بالأسعار فوراً.",
        },
      ],
    },
    broadcaster: {
      minDelaySec: 6,
      maxDelaySec: 15,
      batchSize: 30,
      batchCooldownSec: 120,
      randomizeWithSpintax: true,
      validateNumbers: true,
      defaultCountryCode: "",
    },
    webhook: {
      enabled: false,
      url: "",
      token: "",
      forwardMessages: true,
      forwardRevoked: true,
    },
    pin: {
      enabled: false,
      hash: "",
      salt: "",
      idleMinutes: 30,
    },
    defaultCountryCode: "",
    updatedAt: Date.now(),
  };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function str(value: unknown, fallback: string, maxLength = 5000): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function mergeObject<T extends JsonRecord>(base: T, incoming: unknown): T {
  if (!isRecord(incoming)) return base;
  return { ...base, ...incoming } as T;
}

/**
 * Defensive merge of persisted settings. Storage is user-writable through
 * DevTools, so every nested value is clamped and type-checked before use.
 */
export function mergeSettings(input: unknown): AppSettings {
  const base = createDefaultSettings();
  if (!isRecord(input)) return base;

  const privacy = mergeObject(base.privacy as unknown as JsonRecord, input.privacy);
  const antiDelete = mergeObject(base.antiDelete as unknown as JsonRecord, input.antiDelete);
  const autoReply = mergeObject(base.autoReply as unknown as JsonRecord, input.autoReply);
  const broadcaster = mergeObject(base.broadcaster as unknown as JsonRecord, input.broadcaster);
  const webhook = mergeObject(base.webhook as unknown as JsonRecord, input.webhook);
  const pin = mergeObject(base.pin as unknown as JsonRecord, input.pin);

  const rulesRaw: unknown[] = Array.isArray((autoReply as JsonRecord).rules)
    ? ((autoReply as JsonRecord).rules as unknown[])
    : base.autoReply.rules;
  const templatesRaw: unknown[] = Array.isArray((autoReply as JsonRecord).templates)
    ? ((autoReply as JsonRecord).templates as unknown[])
    : base.autoReply.templates;

  return {
    version: SETTINGS_VERSION,
    language: input.language === "en" ? "en" : "ar",
    theme: input.theme === "light" || input.theme === "dark" ? input.theme : "auto",
    privacy: {
      blurPreview: bool(privacy.blurPreview, base.privacy.blurPreview),
      blurNames: bool(privacy.blurNames, base.privacy.blurNames),
      blurAvatars: bool(privacy.blurAvatars, base.privacy.blurAvatars),
      blurMessages: bool(privacy.blurMessages, base.privacy.blurMessages),
      blurMedia: bool(privacy.blurMedia, base.privacy.blurMedia),
      hidePresence: bool(privacy.hidePresence, base.privacy.hidePresence),
      hideTyping: bool(privacy.hideTyping, base.privacy.hideTyping),
      disableReadReceipts: bool(privacy.disableReadReceipts, base.privacy.disableReadReceipts),
      disableAudioReceipts: bool(privacy.disableAudioReceipts, base.privacy.disableAudioReceipts),
    },
    antiDelete: {
      enabled: bool(antiDelete.enabled, base.antiDelete.enabled),
      inChatToast: bool(antiDelete.inChatToast, base.antiDelete.inChatToast),
      desktopNotification: bool(antiDelete.desktopNotification, base.antiDelete.desktopNotification),
      inlineRestore: bool(antiDelete.inlineRestore, base.antiDelete.inlineRestore),
      maxCache: Math.round(num(antiDelete.maxCache, base.antiDelete.maxCache, 50, 3000)),
    },
    autoReply: {
      enabled: bool(autoReply.enabled, base.autoReply.enabled),
      rules: rulesRaw
        .filter(isRecord)
        .slice(0, 100)
        .map((rule, index) => ({
          id: str(rule.id, `rule-${index}`, 80),
          name: str(rule.name, `Rule ${index + 1}`, 120),
          enabled: bool(rule.enabled, true),
          matchType:
            rule.matchType === "exact" ||
            rule.matchType === "contains" ||
            rule.matchType === "startsWith" ||
            rule.matchType === "regex" ||
            rule.matchType === "fallback"
              ? rule.matchType
              : "contains",
          pattern: str(rule.pattern, "", 200),
          response: str(rule.response, "", 4096),
          scope: rule.scope === "groups" || rule.scope === "all" ? rule.scope : "private",
          cooldownMinutes: Math.round(num(rule.cooldownMinutes, 30, 0, 10080)),
          typingSeconds: Math.round(num(rule.typingSeconds, 2, 0, 30)),
        })),
      templates: templatesRaw
        .filter(isRecord)
        .slice(0, 60)
        .map((tpl, index) => ({
          id: str(tpl.id, `tpl-${index}`, 80),
          label: str(tpl.label, `Template ${index + 1}`, 80),
          text: str(tpl.text, "", 4096),
        })),
    },
    broadcaster: {
      minDelaySec: Math.round(num(broadcaster.minDelaySec, 6, 1, 600)),
      maxDelaySec: Math.round(num(broadcaster.maxDelaySec, 15, 1, 900)),
      batchSize: Math.round(num(broadcaster.batchSize, 30, 1, 1000)),
      batchCooldownSec: Math.round(num(broadcaster.batchCooldownSec, 120, 0, 3600)),
      randomizeWithSpintax: bool(broadcaster.randomizeWithSpintax, true),
      validateNumbers: bool(broadcaster.validateNumbers, true),
      defaultCountryCode: str(broadcaster.defaultCountryCode, "", 5).replace(/\D/g, ""),
    },
    webhook: {
      enabled: bool(webhook.enabled, false),
      url: str(webhook.url, "", 2000),
      token: str(webhook.token, "", 256),
      forwardMessages: bool(webhook.forwardMessages, true),
      forwardRevoked: bool(webhook.forwardRevoked, true),
    },
    pin: {
      enabled: bool(pin.enabled, false),
      hash: str(pin.hash, "", 256),
      salt: str(pin.salt, "", 256),
      idleMinutes: Math.round(num(pin.idleMinutes, 30, 1, 480)),
    },
    defaultCountryCode: str(input.defaultCountryCode, "", 5).replace(/\D/g, ""),
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : Date.now(),
  };
}
