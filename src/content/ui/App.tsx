import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Lock,
  Megaphone,
  ShieldCheck,
  Trash2,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { EXTENSION_VERSION } from "../../shared/constants";
import { dirFor } from "../../shared/i18n";
import { contentController } from "../controller";
import { useAppStore, useT, type TabId } from "../store";
import { cn } from "./components";
import { AutoReplyTab } from "./tabs/AutoReplyTab";
import { BroadcasterTab } from "./tabs/BroadcasterTab";
import { ExporterTab } from "./tabs/ExporterTab";
import { PrivacyTab } from "./tabs/PrivacyTab";
import { ToolsTab } from "./tabs/ToolsTab";
import { VaultTab } from "./tabs/VaultTab";
import { LockScreen } from "./LockScreen";
import { Toasts } from "./Toasts";

function OrbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <ellipse
        cx="12"
        cy="12"
        rx="9.2"
        ry="4.1"
        stroke="currentColor"
        strokeWidth="1.75"
        transform="rotate(-28 12 12)"
      />
      <circle cx="12" cy="12" r="2.8" fill="currentColor" />
      <circle cx="19.2" cy="7.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

const TABS: Array<{ id: TabId; key: string; icon: typeof ShieldCheck }> = [
  { id: "privacy", key: "nav.privacy", icon: ShieldCheck },
  { id: "broadcaster", key: "nav.broadcaster", icon: Megaphone },
  { id: "autoreply", key: "nav.autoreply", icon: Bot },
  { id: "exporter", key: "nav.exporter", icon: Users },
  { id: "vault", key: "nav.vault", icon: Trash2 },
  { id: "tools", key: "nav.tools", icon: Webhook },
];

const FAB_POSITION_KEY = "madarwa:fab-position";

function FloatingLauncher() {
  const t = useT();
  const openPanel = useAppStore((state) => state.openPanel);
  const vaultCount = useAppStore((state) => state.vault.length);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = sessionStorage.getItem(FAB_POSITION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { x?: unknown; y?: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") return { x: parsed.x, y: parsed.y };
    } catch {
      // No saved position.
    }
    return null;
  });
  const [dragging, setDragging] = useState(false);
  const positionRef = useRef<{ x: number; y: number } | null>(position);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  const clamp = (value: number, max: number) => Math.max(8, Math.min(max, value));

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    const next = {
      x: clamp(event.clientX - drag.offsetX, window.innerWidth - 56),
      y: clamp(event.clientY - drag.offsetY, window.innerHeight - 56),
    };
    positionRef.current = next;
    setPosition(next);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;
    if (drag.moved && positionRef.current) {
      suppressClickRef.current = true;
      try {
        sessionStorage.setItem(FAB_POSITION_KEY, JSON.stringify(positionRef.current));
      } catch {
        // Position is cosmetic.
      }
    }
  };

  return (
    <div
      className="fixed z-[2147482500]"
      style={
        position
          ? { left: position.x, top: position.y, pointerEvents: "auto" }
          : { insetInlineEnd: 20, bottom: 20, pointerEvents: "auto" }
      }
    >
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          openPanel();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        title={t("launcher.open")}
        aria-label={t("launcher.open")}
        className={cn(
          "mw-fab relative flex h-12 w-12 items-center justify-center rounded-full transition-transform",
          dragging ? "scale-105 cursor-grabbing" : "cursor-grab hover:scale-[1.03]",
        )}
      >
        <OrbitMark className="h-6 w-6" />
        {vaultCount > 0 ? (
          <span className="mw-num absolute -end-1 -top-1 min-w-[18px] rounded-full bg-wa-danger px-1 text-center text-[9px] font-bold leading-[18px] text-[#1b1013]">
            {vaultCount > 99 ? "99+" : vaultCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function NavRail() {
  const t = useT();
  const activeTab = useAppStore((state) => state.activeTab);
  const setTab = useAppStore((state) => state.setTab);
  const vaultCount = useAppStore((state) => state.vault.length);
  const campaign = useAppStore((state) => state.campaign);

  return (
    <nav className="mw-rail" aria-label="MadarWA sections">
      {TABS.map(({ id, key, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={active ? "page" : undefined}
            className="mw-nav-item"
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="line-clamp-2 text-start leading-4">{t(key)}</span>
            {id === "vault" && vaultCount > 0 ? (
              <span className="mw-nav-count">{vaultCount > 99 ? "99+" : vaultCount}</span>
            ) : null}
            {id === "broadcaster" && (campaign.status === "running" || campaign.status === "paused") ? (
              <span className="ms-auto h-1.5 w-1.5 shrink-0 rounded-full bg-wa-brand" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function Drawer() {
  const t = useT();
  const settings = useAppStore((state) => state.settings);
  const activeTab = useAppStore((state) => state.activeTab);
  const closePanel = useAppStore((state) => state.closePanel);
  const setSettings = useAppStore((state) => state.setSettings);
  const bridgeConnected = useAppStore((state) => state.bridgeConnected);
  const engine = useAppStore((state) => state.engine);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closePanel]);

  const statusState = !bridgeConnected ? "offline" : engine.ready && engine.connected ? "live" : "waiting";
  const statusLabel = !bridgeConnected
    ? t("status.disconnected")
    : engine.ready && engine.connected
      ? t("status.connected")
      : engine.ready
        ? t("status.waitingLogin")
        : t("status.engineWaiting");

  const setLanguage = (language: "ar" | "en") => {
    if (language !== settings.language) setSettings({ ...settings, language });
  };

  return (
    <div className="fixed inset-0 z-[2147483000]" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-black/55" onClick={closePanel} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("app.name")}
        className="mw-drawer mw-drawer-in absolute inset-y-0 end-0 flex w-[min(660px,100vw)] flex-col overflow-hidden"
        onKeyDownCapture={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mw-header flex h-10 shrink-0 items-center gap-2 px-2.5">
          <span className="flex h-6 w-6 items-center justify-center text-wa-brand">
            <OrbitMark className="h-[18px] w-[18px]" />
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[12.5px] font-semibold leading-4">{t("app.name")}</h1>
            <span className="mw-num hidden text-[9px] font-medium text-wa-muted sm:inline">v{EXTENSION_VERSION}</span>
          </div>

          <div className="ms-auto flex items-center gap-1.5">
            <span
              className="flex items-center gap-1.5 rounded-md border border-wa-line px-1.5 py-1"
              title={engine.wppVersion ? `WA ${engine.wppVersion}` : undefined}
            >
              <span className="mw-status-dot" data-state={statusState} />
              <span className="max-w-[124px] truncate text-[9.5px] font-medium text-wa-muted">{statusLabel}</span>
            </span>

            <div className="flex h-6 items-center rounded-md bg-wa-input p-0.5" role="group" aria-label="Language">
              {(["ar", "en"] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  aria-pressed={settings.language === language}
                  onClick={() => setLanguage(language)}
                  className={cn(
                    "h-5 rounded px-1.5 text-[9.5px] font-bold uppercase",
                    settings.language === language
                      ? "bg-wa-brand/10 text-wa-brand"
                      : "text-wa-muted hover:text-wa-text",
                  )}
                >
                  {language === "ar" ? "AR" : "EN"}
                </button>
              ))}
            </div>

            {settings.pin.enabled ? (
              <button
                type="button"
                onClick={() => contentController.lockNow()}
                title={t("privacy.lockNow")}
                aria-label={t("privacy.lockNow")}
                className="mw-icon-btn h-7 w-7"
              >
                <Lock className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={closePanel}
              title={t("common.close")}
              aria-label={t("common.close")}
              className="mw-icon-btn h-7 w-7"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {!engine.ready ? (
          <div className="mx-3 mt-2 rounded-md border border-wa-warning/25 bg-wa-warning/10 px-2 py-1.5 text-[10px] leading-4 text-wa-warning">
            {t("status.engineWaiting")}
          </div>
        ) : null}

        <div className="mw-workspace">
          <NavRail />
          <main className="mw-scroll min-w-0 flex-1 overflow-y-auto px-3 py-2.5">
            <div key={activeTab} className="mw-fade-enter">
              {activeTab === "privacy" ? <PrivacyTab /> : null}
              {activeTab === "broadcaster" ? <BroadcasterTab /> : null}
              {activeTab === "autoreply" ? <AutoReplyTab /> : null}
              {activeTab === "exporter" ? <ExporterTab /> : null}
              {activeTab === "vault" ? <VaultTab /> : null}
              {activeTab === "tools" ? <ToolsTab /> : null}
            </div>
          </main>
        </div>

        <footer className="flex h-7 shrink-0 items-center justify-between border-t border-wa-line px-3">
          <span className="truncate text-[8.5px] text-wa-muted">{t("app.poweredBy")}</span>
          <span className="mw-num shrink-0 text-[8.5px] text-wa-muted">MadarWA · {EXTENSION_VERSION}</span>
        </footer>
      </aside>
    </div>
  );
}

export function App() {
  const settings = useAppStore((state) => state.settings);
  const theme = useAppStore((state) => state.theme);
  const panelOpen = useAppStore((state) => state.panelOpen);
  const locked = useAppStore((state) => state.locked);
  const launcherFallback = useAppStore((state) => state.launcherFallback);
  const closePanel = useAppStore((state) => state.closePanel);

  const effectiveTheme = settings.theme === "auto" ? theme : settings.theme;
  const dir = dirFor(settings.language);

  useEffect(() => {
    if (locked) closePanel();
  }, [closePanel, locked]);

  return (
    <div className="mw-app" data-madarwa-theme={effectiveTheme} dir={dir} lang={settings.language}>
      {locked ? <LockScreen /> : null}
      {launcherFallback && !panelOpen ? <FloatingLauncher /> : null}
      {panelOpen ? <Drawer /> : null}
      <Toasts />
    </div>
  );
}
