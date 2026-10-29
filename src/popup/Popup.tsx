import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Lock,
  MessageCircle,
  RotateCw,
  ShieldCheck,
  Trash2,
  Bot,
} from "lucide-react";
import {
  connectionHintKey,
  connectionLabelKey,
  connectionPhase,
  connectionTone,
  type ConnectionPhase,
} from "../shared/connection";
import {
  EXTENSION_VERSION,
  LANGUAGE_LABELS,
  PROJECT_URL,
  RUNTIME_MESSAGES,
  STORAGE_KEYS,
  WHATSAPP_TAB_PATTERN,
  WHATSAPP_URL,
} from "../shared/constants";
import { createDefaultSettings, mergeSettings } from "../shared/defaults";
import { dirFor, initI18n, tFor } from "../shared/i18n";
import type { AppSettings, EngineInfo, Language } from "../shared/types";
import { BrandMark } from "../content/ui/BrandMark";

interface ContentStatus {
  ok?: boolean;
  bridgeConnected?: boolean;
  everConnected?: boolean;
  engine?: EngineInfo;
}

/** `checking` covers the first probe so the popup never flashes a wrong state. */
type PopupPhase = ConnectionPhase | "checking";

const STATUS_POLL_MS = 1500;
const LANGUAGES: Language[] = ["ar", "en"];

async function findWhatsAppTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ url: WHATSAPP_TAB_PATTERN });
  return tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
}

async function focusTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

async function queryStatus(tabId: number): Promise<ContentStatus | null> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: RUNTIME_MESSAGES.status })) as ContentStatus | undefined;
    return response?.ok ? response : null;
  } catch {
    // No receiver: the page loaded before the extension, or the extension was updated.
    return null;
  }
}

/** The interface is light-only; only language and direction vary. */
function applyDocumentLanguage(settings: AppSettings): void {
  const root = document.documentElement;
  root.classList.add("mw-app");
  root.lang = settings.language;
  root.dir = dirFor(settings.language);
}

export function Popup() {
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings);
  const [vaultCount, setVaultCount] = useState(0);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [phase, setPhase] = useState<PopupPhase>("checking");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const noteTimer = useRef(0);

  const t = tFor(settings.language);

  const refresh = useCallback(async () => {
    try {
      const found = await findWhatsAppTab();
      setTab(found);
      if (!found?.id) {
        setPhase("absent");
        return;
      }
      const status = await queryStatus(found.id);
      if (!status) {
        setPhase("unreachable");
        return;
      }
      setPhase(
        connectionPhase({
          bridgeConnected: Boolean(status.bridgeConnected),
          everConnected: Boolean(status.everConnected),
          engine: status.engine ?? { ready: false, connected: false },
        }),
      );
    } catch {
      setPhase("unreachable");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.vault]);
        const merged = mergeSettings(stored[STORAGE_KEYS.settings]);
        initI18n(merged.language);
        setSettings(merged);
        const vault = stored[STORAGE_KEYS.vault];
        setVaultCount(Array.isArray(vault) ? vault.length : 0);
      } catch {
        // Defaults stay in place; the status probe below still runs.
      }
      await refresh();
    })();
    // Live status while the popup is open: login, reconnects and reloads show up without reopening it.
    const timer = window.setInterval(() => void refresh(), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    applyDocumentLanguage(settings);
  }, [settings]);

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

  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const showNote = (text: string) => {
    window.clearTimeout(noteTimer.current);
    setNote(text);
    noteTimer.current = window.setTimeout(() => setNote(""), 3000);
  };

  const rulesCount = useMemo(() => settings.autoReply.rules.filter((rule) => rule.enabled).length, [settings]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      showNote(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const openWhatsApp = () =>
    run(async () => {
      const current = tab ?? (await findWhatsAppTab());
      // Never open a second WhatsApp tab: WhatsApp would show "Use here" and drop the first.
      if (current?.id) await focusTab(current);
      else await chrome.tabs.create({ url: WHATSAPP_URL });
      window.close();
    });

  const openPanel = () =>
    run(async () => {
      const current = tab ?? (await findWhatsAppTab());
      if (!current?.id) {
        await chrome.tabs.create({ url: WHATSAPP_URL });
        window.close();
        return;
      }
      await focusTab(current);
      const result = (await chrome.tabs.sendMessage(current.id, { type: RUNTIME_MESSAGES.openPanel }).catch(() => null)) as
        | { ok?: boolean }
        | null;
      if (result?.ok) {
        window.close();
        return;
      }
      setPhase("unreachable");
    });

  const reloadWhatsApp = () =>
    run(async () => {
      const current = tab ?? (await findWhatsAppTab());
      if (!current?.id) return;
      await chrome.tabs.reload(current.id);
      await focusTab(current);
      window.close();
    });

  const lockPanel = () =>
    run(async () => {
      if (!tab?.id) return;
      const result = (await chrome.tabs.sendMessage(tab.id, { type: RUNTIME_MESSAGES.lockPanel }).catch(() => null)) as
        | { ok?: boolean }
        | null;
      showNote(result?.ok ? t("popup.locked") : t("privacy.lockEnableHint"));
    });

  const switchLanguage = async (language: Language) => {
    if (language === settings.language) return;
    const next: AppSettings = { ...settings, language, updatedAt: Date.now() };
    initI18n(language);
    setSettings(next);
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
    } catch {
      showNote(t("errors.saveFailed"));
    }
  };

  const tone = phase === "checking" ? "waiting" : connectionTone(phase);
  const primary =
    phase === "absent"
      ? { label: t("connection.open"), icon: <MessageCircle className="h-4 w-4" aria-hidden="true" />, onClick: openWhatsApp }
      : phase === "unreachable" || phase === "updated"
        ? { label: t("connection.reload"), icon: <RotateCw className="h-4 w-4" aria-hidden="true" />, onClick: reloadWhatsApp }
        : { label: t("popup.openDashboard"), icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />, onClick: openPanel };

  return (
    <div className="flex flex-col" aria-busy={phase === "checking"}>
      <header className="mw-header flex h-12 items-center gap-2 px-4">
        <BrandMark className="h-6 w-6 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate text-mw-base font-semibold">{t("popup.title")}</h1>
        <div className="mw-segmented" role="group" aria-label={t("common.languageSwitch")}>
          {LANGUAGES.map((language) => (
            <button
              key={language}
              type="button"
              lang={language}
              aria-pressed={settings.language === language}
              onClick={() => void switchLanguage(language)}
            >
              {LANGUAGE_LABELS[language]}
            </button>
          ))}
        </div>
      </header>

      <section className="flex items-start gap-2.5 border-b border-wa-line px-4 py-3" role="status">
        {phase === "checking" ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-wa-muted" aria-hidden="true" />
        ) : (
          <span className="mw-status-dot mt-[7px]" data-state={tone} aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-mw-sm font-semibold leading-5">
            {phase === "checking" ? t("connection.connecting") : t(connectionLabelKey(phase))}
          </p>
          {phase !== "checking" ? (
            <p className="mt-0.5 text-mw-xs leading-5 text-wa-muted">{t(connectionHintKey(phase))}</p>
          ) : null}
        </div>
      </section>

      <dl className="px-4 py-1">
        <div className="flex items-center justify-between border-b border-wa-line py-2.5">
          <dt className="flex items-center gap-2 text-mw-sm text-wa-muted">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("popup.vaultCount")}
          </dt>
          <dd className="mw-num text-mw-base font-semibold">{vaultCount}</dd>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <dt className="flex items-center gap-2 text-mw-sm text-wa-muted">
            <Bot className="h-4 w-4" aria-hidden="true" />
            {t("popup.rulesCount")}
          </dt>
          <dd className="mw-num text-mw-base font-semibold">{rulesCount}</dd>
        </div>
      </dl>

      <div className="space-y-2 px-4 pb-3 pt-1">
        <button
          type="button"
          onClick={() => void primary.onClick()}
          disabled={busy || phase === "checking"}
          className="mw-btn mw-btn-primary h-9 w-full"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : primary.icon}
          {primary.label}
        </button>
        {phase !== "absent" && phase !== "checking" ? (
          // "Lock" only exists once a PIN is set, instead of a button that is always disabled.
          <div className={settings.pin.enabled ? "grid grid-cols-2 gap-2" : "grid"}>
            <button type="button" onClick={() => void openWhatsApp()} disabled={busy} className="mw-btn mw-btn-secondary w-full">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t("popup.openWhatsapp")}
            </button>
            {settings.pin.enabled ? (
              <button
                type="button"
                onClick={() => void lockPanel()}
                disabled={busy || phase === "unreachable"}
                className="mw-btn mw-btn-secondary w-full"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                {t("popup.lock")}
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="min-h-[20px] text-center text-mw-xs leading-5 text-wa-muted" aria-live="polite">
          {note}
        </p>
      </div>

      <footer className="flex h-10 items-center justify-between border-t border-wa-line px-4">
        <span className="flex items-center gap-1.5 text-mw-2xs text-wa-muted">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {t("popup.version", { version: EXTENSION_VERSION })}
        </span>
        <a
          href={PROJECT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded text-mw-2xs text-wa-muted hover:text-wa-text"
        >
          GitHub
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
