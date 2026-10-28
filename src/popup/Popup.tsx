import { useEffect, useState } from "react";
import {
  ExternalLink,
  LayoutDashboard,
  Lock,
  MessageCircle,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { EXTENSION_VERSION, RUNTIME_MESSAGES, STORAGE_KEYS } from "../shared/constants";
import { createDefaultSettings, mergeSettings } from "../shared/defaults";
import { initI18n, tFor, dirFor } from "../shared/i18n";
import type { AppSettings, EngineInfo } from "../shared/types";

interface ContentStatus {
  ok?: boolean;
  bridgeConnected?: boolean;
  engine?: EngineInfo;
}

function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <ellipse cx="12" cy="12" rx="9.2" ry="4.1" stroke="currentColor" strokeWidth="1.75" transform="rotate(-28 12 12)" />
      <circle cx="12" cy="12" r="2.8" fill="currentColor" />
      <circle cx="19.2" cy="7.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function Popup() {
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings);
  const [vaultCount, setVaultCount] = useState(0);
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabFound, setTabFound] = useState(false);
  const [status, setStatus] = useState<ContentStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lockNote, setLockNote] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.vault]);
        const merged = mergeSettings(stored[STORAGE_KEYS.settings]);
        initI18n(merged.language);
        setSettings(merged);
        const vault = stored[STORAGE_KEYS.vault];
        setVaultCount(Array.isArray(vault) ? vault.length : 0);

        const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
        const tab = tabs[0];
        if (tab?.id) {
          setTabId(tab.id);
          setTabFound(true);
          try {
            const result = (await chrome.tabs.sendMessage(tab.id, {
              type: RUNTIME_MESSAGES.status,
            })) as ContentStatus;
            setStatus(result);
          } catch {
            setStatus(null);
          }
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      const settingsChange = changes[STORAGE_KEYS.settings];
      if (settingsChange) {
        const next = mergeSettings(settingsChange.newValue);
        initI18n(next.language);
        setSettings(next);
      }
      const vaultChange = changes[STORAGE_KEYS.vault];
      if (vaultChange) {
        const vault = vaultChange.newValue;
        setVaultCount(Array.isArray(vault) ? vault.length : 0);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const t = tFor(settings.language);
  const dir = dirFor(settings.language);
  const rulesCount = settings.autoReply.rules.filter((rule) => rule.enabled).length;

  const sendToTab = async (payload: Record<string, unknown>): Promise<ContentStatus | null> => {
    if (!tabId) return null;
    try {
      return (await chrome.tabs.sendMessage(tabId, payload)) as ContentStatus;
    } catch {
      return null;
    }
  };

  const openDashboard = async () => {
    if (tabId) {
      const result = await sendToTab({ type: RUNTIME_MESSAGES.openPanel });
      if (result?.ok) {
        window.close();
        return;
      }
    }
    await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    window.close();
  };

  const openWhatsApp = async () => {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    const tab = tabs[0];
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: "https://web.whatsapp.com/" });
    }
    window.close();
  };

  const lockPanel = async () => {
    const result = await sendToTab({ type: RUNTIME_MESSAGES.lockPanel });
    if (result?.ok) {
      setLockNote(t("popup.locked"));
      window.setTimeout(() => setLockNote(""), 2500);
    } else {
      setLockNote(t("privacy.lockEnableHint"));
      window.setTimeout(() => setLockNote(""), 3000);
    }
  };

  const switchLanguage = async () => {
    const next: AppSettings = {
      ...settings,
      language: settings.language === "ar" ? "en" : "ar",
      updatedAt: Date.now(),
    };
    initI18n(next.language);
    setSettings(next);
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  };

  const statusState =
    status?.engine?.ready && status.engine.connected
      ? "live"
      : status?.bridgeConnected
        ? "waiting"
        : "offline";
  const statusLabel = !tabFound
    ? t("popup.notOnWhatsapp")
    : status?.engine?.ready && status.engine.connected
      ? t("status.connected")
      : status?.engine?.ready
        ? t("status.waitingLogin")
        : status?.bridgeConnected
          ? t("status.engineWaiting")
          : t("status.disconnected");

  return (
    <div className={`min-h-[398px] ${!loaded ? "opacity-90" : ""}`} dir={dir} lang={settings.language}>
      <header className="flex h-12 items-center gap-2 px-4">
        <span className="flex h-6 w-6 items-center justify-center text-wa-brand">
          <OrbitMark className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold leading-5">{t("popup.title")}</h1>
          <p className="truncate text-[9.5px] leading-4 text-wa-muted">{t("popup.subtitle")}</p>
        </div>
        <div className="flex h-6 items-center rounded-md bg-wa-input p-0.5" role="group" aria-label="Language">
          {(["ar", "en"] as const).map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => {
                if (language !== settings.language) void switchLanguage();
              }}
              aria-pressed={settings.language === language}
              className={`h-5 rounded px-1.5 text-[9.5px] font-bold uppercase ${
                settings.language === language ? "bg-wa-brand/10 text-wa-brand" : "text-wa-muted"
              }`}
            >
              {language === "ar" ? "AR" : "EN"}
            </button>
          ))}
        </div>
      </header>

      <div className="flex h-9 items-center justify-between border-y border-wa-line px-4">
        <div className="flex items-center gap-2">
          <span className="popup-status-dot" data-state={statusState} />
          <span className="text-[10.5px] font-medium">{statusLabel}</span>
        </div>
        <span className="text-[9px] text-wa-muted">{t("popup.engineStatus")}</span>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between border-b border-wa-line py-2">
          <span className="flex items-center gap-1.5 text-[10.5px] text-wa-muted">
            <Trash2 className="h-3.5 w-3.5" />
            {t("popup.vaultCount")}
          </span>
          <span className="tabular-nums text-[15px] font-bold leading-5">{vaultCount}</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="flex items-center gap-1.5 text-[10.5px] text-wa-muted">
            <Users className="h-3.5 w-3.5" />
            {t("popup.rulesCount")}
          </span>
          <span className="tabular-nums text-[15px] font-bold leading-5">{rulesCount}</span>
        </div>
      </div>

      <div className="space-y-2 px-4 pb-3">
        <button
          type="button"
          onClick={() => void openDashboard()}
          className="popup-primary flex h-9 w-full items-center justify-center gap-2 rounded-md text-[12px] font-semibold"
        >
          <LayoutDashboard className="h-4 w-4" />
          {t("popup.openDashboard")}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void openWhatsApp()}
            className="popup-secondary flex h-8 items-center justify-center gap-1.5 rounded-md text-[10.5px] font-medium"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {t("popup.openWhatsapp")}
          </button>
          <button
            type="button"
            onClick={() => void lockPanel()}
            disabled={!settings.pin.enabled}
            className="popup-secondary flex h-8 items-center justify-center gap-1.5 rounded-md text-[10.5px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Lock className="h-3.5 w-3.5" />
            {t("popup.lock")}
          </button>
        </div>
      </div>

      {lockNote ? (
        <p className="mx-4 mb-2 rounded-md border border-wa-line bg-wa-surface px-2 py-1.5 text-center text-[9.5px] text-wa-text">
          {lockNote}
        </p>
      ) : null}

      {!tabFound ? (
        <p className="mx-4 mb-2 rounded-md border border-wa-warning/25 bg-wa-warning/10 px-2 py-1.5 text-center text-[9.5px] leading-4 text-wa-warning">
          {t("errors.bridgeUnavailable")}
        </p>
      ) : null}

      <footer className="mx-4 flex h-7 items-center justify-between border-t border-wa-line">
        <span className="flex items-center gap-1 text-[8.5px] text-wa-muted">
          <ShieldCheck className="h-3 w-3" />
          {t("popup.version", { version: EXTENSION_VERSION })}
        </span>
        <a
          href="https://github.com/ALSRKAL/MadarWA"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[8.5px] text-wa-muted hover:text-wa-text"
        >
          GitHub
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </footer>
    </div>
  );
}
