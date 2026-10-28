import { EXTENSION_VERSION, RUNTIME_MESSAGES, STORAGE_KEYS } from "../shared/constants";
import { mergeSettings } from "../shared/defaults";
import { buildWebhookHeaders, validateWebhookUrl } from "../shared/utils/security";
import type { AppSettings, WebhookLogEntry, WebhookPayload } from "../shared/types";

const MAINTENANCE_ALARM = "madarwa:maintenance";
const MAX_WEBHOOK_BODY = 512_000;
const WEBHOOK_TIMEOUT_MS = 20_000;

let logChain: Promise<void> = Promise.resolve();

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `log-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Delivery logs keep the endpoint but drop credentials, query values and hash. */
function redactUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().slice(0, 500);
  } catch {
    return String(raw ?? "").slice(0, 500);
  }
}

async function appendWebhookLog(entry: WebhookLogEntry): Promise<void> {
  logChain = logChain.catch(() => undefined).then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.webhookLog);
    const existing = Array.isArray(stored[STORAGE_KEYS.webhookLog]) ? (stored[STORAGE_KEYS.webhookLog] as WebhookLogEntry[]) : [];
    await chrome.storage.local.set({ [STORAGE_KEYS.webhookLog]: [entry, ...existing].slice(0, 60) });
  });
  await logChain;
}

async function loadSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return mergeSettings(stored[STORAGE_KEYS.settings]);
}

async function updateBadge(count: number): Promise<void> {
  const text = count > 99 ? "99+" : count > 0 ? String(count) : "";
  await chrome.action.setBadgeText({ text });
  if (count > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: "#059669" });
  }
}

async function refreshBadge(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.vault);
  const raw = stored[STORAGE_KEYS.vault];
  const vault = Array.isArray(raw) ? raw : [];
  await updateBadge(vault.length);
}

async function postWebhook(
  settings: AppSettings,
  payload: WebhookPayload,
): Promise<{ ok: boolean; status: number; error: string }> {
  const check = validateWebhookUrl(settings.webhook.url);
  if (!check.ok) {
    const result = { ok: false, status: 0, error: check.reason };
    if (payload.event !== "test") {
      await appendWebhookLog({
        id: uid(),
        at: Date.now(),
        url: redactUrl(settings.webhook.url),
        ok: false,
        status: 0,
        error: check.reason,
        event: payload.event,
      });
    }
    return result;
  }

  const body = JSON.stringify(payload);
  if (body.length > MAX_WEBHOOK_BODY) {
    const result = { ok: false, status: 0, error: "Payload too large" };
    await appendWebhookLog({
      id: uid(),
      at: Date.now(),
      url: redactUrl(check.url),
      ok: false,
      status: 0,
      error: result.error,
      event: payload.event,
    });
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(check.url, {
      method: "POST",
      headers: buildWebhookHeaders(settings.webhook.token),
      body,
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    void response.body?.cancel();
    const result = {
      ok: response.ok,
      status: response.status,
      error: response.ok ? "" : `HTTP ${response.status}`,
    };
    await appendWebhookLog({
      id: uid(),
      at: Date.now(),
      url: redactUrl(check.url),
      ok: result.ok,
      status: result.status,
      error: result.error,
      event: payload.event,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = {
      ok: false,
      status: 0,
      error: message.toLowerCase().includes("abort") ? "Request timed out" : message,
    };
    await appendWebhookLog({
      id: uid(),
      at: Date.now(),
      url: redactUrl(check.url),
      ok: false,
      status: 0,
      error: result.error.slice(0, 300),
      event: payload.event,
    });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function handleDeliver(message: Record<string, unknown>): Promise<unknown> {
  const settings = await loadSettings();
  if (!settings.webhook.enabled) return { skipped: true, reason: "disabled" };

  const payload = message.payload as WebhookPayload | undefined;
  if (!payload || (payload.event !== "message" && payload.event !== "revoked")) {
    return { skipped: true, reason: "invalid-payload" };
  }
  if (payload.event === "message" && !settings.webhook.forwardMessages) {
    return { skipped: true, reason: "messages-disabled" };
  }
  if (payload.event === "revoked" && !settings.webhook.forwardRevoked) {
    return { skipped: true, reason: "revoked-disabled" };
  }

  return postWebhook(settings, {
    event: payload.event,
    source: "madarwa",
    at: Date.now(),
    data: payload.data && typeof payload.data === "object" ? payload.data : {},
  });
}

async function handleTest(): Promise<{ ok: boolean; status: number; error: string }> {
  const settings = await loadSettings();
  if (!settings.webhook.url.trim()) {
    return { ok: false, status: 0, error: "Webhook URL is empty" };
  }
  return postWebhook(settings, {
    event: "test",
    source: "madarwa",
    at: Date.now(),
    data: {
      message: "MadarWA webhook test",
      version: EXTENSION_VERSION,
    },
  });
}

async function focusWhatsApp(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  const tab = tabs[0];
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
  }
}

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(MAINTENANCE_ALARM);
  if (!existing) {
    chrome.alarms.create(MAINTENANCE_ALARM, { periodInMinutes: 1440 });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
  void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
  void refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== MAINTENANCE_ALARM) return;
  void (async () => {
    const settings = await loadSettings();
    const stored = await chrome.storage.local.get([STORAGE_KEYS.messageCache, STORAGE_KEYS.webhookLog]);
    const cache = stored[STORAGE_KEYS.messageCache];
    if (Array.isArray(cache)) {
      const limit = Math.max(50, settings.antiDelete.maxCache);
      await chrome.storage.local.set({ [STORAGE_KEYS.messageCache]: cache.slice(-limit) });
    }
    const log = stored[STORAGE_KEYS.webhookLog];
    if (Array.isArray(log) && log.length > 60) {
      await chrome.storage.local.set({ [STORAGE_KEYS.webhookLog]: log.slice(0, 60) });
    }
    await refreshBadge();
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEYS.vault]) {
    const vault = changes[STORAGE_KEYS.vault]?.newValue;
    void updateBadge(Array.isArray(vault) ? vault.length : 0);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("madarwa-")) return;
  void focusWhatsApp();
  void chrome.notifications.clear(notificationId);
});

type MessageType = (typeof RUNTIME_MESSAGES)[keyof typeof RUNTIME_MESSAGES];

const HANDLED_TYPES = new Set<string>([
  RUNTIME_MESSAGES.webhookDeliver,
  RUNTIME_MESSAGES.webhookTest,
  RUNTIME_MESSAGES.badgeSet,
  RUNTIME_MESSAGES.notify,
  RUNTIME_MESSAGES.ping,
]);

function isMessageType(value: unknown): value is MessageType {
  return typeof value === "string" && HANDLED_TYPES.has(value);
}

async function handleMessage(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (sender.id !== chrome.runtime.id) return { ok: false, error: "Untrusted sender" };
  const type = message.type;

  if (type === RUNTIME_MESSAGES.ping) {
    return { ok: true, version: EXTENSION_VERSION };
  }

  if (type === RUNTIME_MESSAGES.badgeSet) {
    const count = Number(message.count ?? 0);
    await updateBadge(Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0);
    return { ok: true };
  }

  if (type === RUNTIME_MESSAGES.notify) {
    const title = String(message.title ?? "MadarWA").slice(0, 120);
    const text = String(message.message ?? "").slice(0, 500);
    const id = `madarwa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title,
      message: text || "MadarWA",
      priority: 2,
    });
    return { ok: true, id };
  }

  if (type === RUNTIME_MESSAGES.webhookDeliver) {
    return handleDeliver(message);
  }

  if (type === RUNTIME_MESSAGES.webhookTest) {
    return handleTest();
  }

  return { ok: false, error: "Unknown message" };
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined => {
    if (typeof message !== "object" || message === null) return undefined;
    const type = (message as { type?: unknown }).type;
    if (!isMessageType(type)) return undefined;

    void handleMessage(message as Record<string, unknown>, sender)
      .then((result) => sendResponse(result))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 300) : "Background error",
        });
      });
    return true;
  },
);
