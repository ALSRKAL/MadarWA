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
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <ellipse cx="12" cy="12" rx="9.2" ry="4.1" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-28 12 12)" opacity="0.9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="19.2" cy="7.4" r="1.7" fill="#a7f3d0" />
    </svg>
  );
}

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
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
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
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

  const statusTone =
    status?.engine?.ready && status.engine.connected
      ? "bg-emerald-400"
      : status?.bridgeConnected
        ? "bg-amber-400"
        : "bg-rose-400";
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
    <div className={cn("popup-bg min-h-[430px] p-4", !loaded && "opacity-90")} dir={dir} lang={settings.language}>
      <header className="flex items-start gap-3">
        <div className="popup-hero flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white">
          <OrbitMark className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-bold leading-6">{t("popup.title")}</h1>
          <p className="text-[11px] text-slate-400">{t("popup.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void switchLanguage()}
          className="h-7 rounded-lg border border-slate-700 px-2 text-[10px] font-bold text-slate-200 transition-colors hover:bg-slate-800"
        >
          {t("popup.language")}
        </button>
      </header>

      <div className="popup-card mt-4 flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", statusTone)} />
          <span className="text-[11px] font-semibold">{statusLabel}</span>
        </div>
        <span className="text-[9px] text-slate-500">{t("popup.engineStatus")}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="popup-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-[10px]">{t("popup.vaultCount")}</span>
          </div>
          <p className="mt-1 text-xl font-bold leading-7 text-rose-300">{vaultCount}</p>
        </div>
        <div className="popup-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Users className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[10px]">{t("popup.rulesCount")}</span>
          </div>
          <p className="mt-1 text-xl font-bold leading-7 text-emerald-300">{rulesCount}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => void openDashboard()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-[13px] font-bold text-white shadow-lg shadow-emerald-950/40 transition hover:brightness-110 active:scale-[0.99]"
        >
          <LayoutDashboard className="h-4 w-4" />
          {t("popup.openDashboard")}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void openWhatsApp()}
            className="popup-card flex h-9 items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors hover:bg-slate-800/60"
          >
            <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
            {t("popup.openWhatsapp")}
          </button>
          <button
            type="button"
            onClick={() => void lockPanel()}
            disabled={!settings.pin.enabled}
            className="popup-card flex h-9 items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Lock className="h-3.5 w-3.5 text-amber-400" />
            {t("popup.lock")}
          </button>
        </div>
      </div>

      {lockNote ? (
        <p className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-center text-[10px] text-emerald-200">
          {lockNote}
        </p>
      ) : null}

      {!tabFound ? (
        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-center text-[10px] leading-5 text-amber-200">
          {t("errors.bridgeUnavailable")}
        </p>
      ) : null}

      <footer className="mt-4 flex items-center justify-between border-t border-slate-800 pt-2.5">
        <span className="flex items-center gap-1 text-[9px] text-slate-500">
          <ShieldCheck className="h-3 w-3 text-emerald-500" />
          {t("popup.version", { version: EXTENSION_VERSION })}
        </span>
        <a
          href="https://github.com/ALSRKAL/MadarWA"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[9px] text-slate-500 transition-colors hover:text-emerald-400"
        >
          GitHub
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </footer>
    </div>
  );
}
