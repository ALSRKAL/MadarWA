import { useEffect, useRef, useState } from "react";
import { Bot, Lock, Megaphone, RotateCw, ShieldCheck, Trash2, Users, Webhook, X } from "lucide-react";
import {
  connectionHintKey,
  connectionLabelKey,
  connectionNeedsReload,
  connectionTone,
} from "../../shared/connection";
import { LANGUAGE_LABELS } from "../../shared/constants";
import { dirFor } from "../../shared/i18n";
import type { Language } from "../../shared/types";
import { contentController } from "../controller";
import { useAppStore, useConnectionPhase, useT, useUnseenVault, type TabId } from "../store";
import { Button, cn, IconButton, useDialogFocus } from "./components";
import { LockScreen } from "./LockScreen";
import { OrbitMark } from "./OrbitMark";
import { AutoReplyTab } from "./tabs/AutoReplyTab";
import { BroadcasterTab } from "./tabs/BroadcasterTab";
import { ExporterTab } from "./tabs/ExporterTab";
import { PrivacyTab } from "./tabs/PrivacyTab";
import { ToolsTab } from "./tabs/ToolsTab";
import { VaultTab } from "./tabs/VaultTab";
import { Toasts } from "./Toasts";

const TABS: Array<{ id: TabId; key: string; icon: typeof ShieldCheck }> = [
  { id: "privacy", key: "nav.privacy", icon: ShieldCheck },
  { id: "broadcaster", key: "nav.broadcaster", icon: Megaphone },
  { id: "autoreply", key: "nav.autoreply", icon: Bot },
  { id: "exporter", key: "nav.exporter", icon: Users },
  { id: "vault", key: "nav.vault", icon: Trash2 },
  { id: "tools", key: "nav.tools", icon: Webhook },
];

const LANGUAGES: Language[] = ["ar", "en"];
const FAB_POSITION_KEY = "madarwa:fab-position";

function UnseenCount({ count, className }: { count: number; className?: string }) {
  const t = useT();
  if (count <= 0) return null;
  return (
    <span className={cn("mw-count", className)} title={t("vault.unseen", { count })}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function FloatingLauncher() {
  const t = useT();
  const openPanel = useAppStore((state) => state.openPanel);
  const unseen = useUnseenVault();
  const phase = useConnectionPhase();
  const tone = connectionTone(phase);
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
  const label = `${t("launcher.open")} · ${t(connectionLabelKey(phase))}`;

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
        title={label}
        aria-label={label}
        className={cn(
          "mw-fab relative flex h-12 w-12 items-center justify-center rounded-full transition-transform",
          dragging ? "scale-105 cursor-grabbing" : "cursor-grab hover:scale-[1.03]",
        )}
      >
        <OrbitMark className="h-6 w-6" />
        {/* The dot only appears when something is wrong; the label carries the state. */}
        {tone !== "live" ? (
          <span className="mw-status-dot absolute bottom-2 end-2" data-state={tone} aria-hidden="true" />
        ) : null}
        <UnseenCount count={unseen} className="absolute -end-1 -top-1" />
      </button>
    </div>
  );
}

function NavRail() {
  const t = useT();
  const activeTab = useAppStore((state) => state.activeTab);
  const setTab = useAppStore((state) => state.setTab);
  const unseen = useUnseenVault();
  const campaignStatus = useAppStore((state) => state.campaign.status);
  const campaignBusy = campaignStatus === "running" || campaignStatus === "paused";

  return (
    <nav className="mw-rail" aria-label={t("common.sections")}>
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
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate text-start leading-5">{t(key)}</span>
            {id === "vault" ? <UnseenCount count={unseen} className="ms-auto" /> : null}
            {id === "broadcaster" && campaignBusy ? (
              <span
                className="mw-status-dot ms-auto"
                data-state={campaignStatus === "running" ? "live" : "waiting"}
                title={t(`status.${campaignStatus}`)}
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Shown only when something is not fully working: what is happening, in one
 * line, and the single action that fixes it when there is one.
 */
function ConnectionBanner() {
  const t = useT();
  const phase = useConnectionPhase();
  const campaignBusy = useAppStore((state) => state.campaign.status === "running" || state.campaign.status === "paused");
  if (phase === "live") return null;

  const reload = connectionNeedsReload(phase);
  const holdReload = phase === "updated" && campaignBusy;
  return (
    <div className="mw-banner" role="status">
      <span className="mw-status-dot" data-state={connectionTone(phase)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-mw-sm font-semibold leading-5">{t(connectionLabelKey(phase))}</p>
        <p className="text-mw-xs leading-5 text-wa-muted">{t(connectionHintKey(phase))}</p>
        {holdReload ? <p className="mt-0.5 text-mw-xs leading-5 text-wa-warning">{t("connection.campaignRunning")}</p> : null}
      </div>
      {reload ? (
        <Button
          size="sm"
          variant={holdReload ? "secondary" : "primary"}
          icon={<RotateCw className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => contentController.reloadPage()}
          className="shrink-0"
        >
          {t("connection.reload")}
        </Button>
      ) : null}
    </div>
  );
}

function Drawer() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const settings = useAppStore((state) => state.settings);
  const activeTab = useAppStore((state) => state.activeTab);
  const closePanel = useAppStore((state) => state.closePanel);
  const setSettings = useAppStore((state) => state.setSettings);
  const wppVersion = useAppStore((state) => state.engine.wppVersion);
  const phase = useConnectionPhase();
  useDialogFocus(ref, true);

  const setLanguage = (language: Language) => {
    if (language !== settings.language) setSettings({ ...settings, language });
  };

  return (
    <div className="fixed inset-0 z-[2147483000]" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-wa-brand/25" onClick={closePanel} aria-hidden="true" />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("app.name")}
        tabIndex={-1}
        className="mw-drawer mw-drawer-in absolute inset-y-0 end-0 flex w-[min(720px,100vw)] flex-col overflow-hidden outline-none"
        onKeyDown={(event) => {
          // Dialogs inside handle Escape first and mark it handled.
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            closePanel();
          }
          // Bubble phase, so our own key handlers have already run; this only
          // keeps WhatsApp's page shortcuts from reacting to typing here.
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mw-header flex h-12 shrink-0 items-center gap-2.5 pe-2 ps-4">
          <OrbitMark className="h-5 w-5 shrink-0 text-wa-accent" />
          <h1 className="min-w-0 truncate text-mw-base font-semibold leading-6">{t("app.name")}</h1>

          <div className="ms-auto flex items-center gap-1">
            <span
              className="mw-status-chip"
              title={[t(connectionLabelKey(phase)), wppVersion ? `wa-js ${wppVersion}` : ""].filter(Boolean).join(" · ")}
            >
              <span className="mw-status-dot" data-state={connectionTone(phase)} aria-hidden="true" />
              {/* When not live, the banner below already says it in full. */}
              {phase === "live" ? <span className="truncate">{t(connectionLabelKey(phase))}</span> : null}
            </span>

            <div className="mw-segmented" role="group" aria-label={t("common.languageSwitch")}>
              {LANGUAGES.map((language) => (
                <button
                  key={language}
                  type="button"
                  lang={language}
                  aria-pressed={settings.language === language}
                  onClick={() => setLanguage(language)}
                >
                  {LANGUAGE_LABELS[language]}
                </button>
              ))}
            </div>

            {settings.pin.enabled ? (
              <IconButton label={t("privacy.lockNow")} onClick={() => contentController.lockNow()}>
                <Lock className="h-4 w-4" />
              </IconButton>
            ) : null}
            <IconButton label={t("common.close")} onClick={closePanel}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </header>

        {/* Framed sheet: header and rail share the frame; the work sits on one white sheet. */}
        <div className="mw-workspace">
          <NavRail />
          <section className="mw-sheet">
            <ConnectionBanner />
            <main className="mw-scroll min-w-0 flex-1 overflow-y-auto px-5 pb-6 pt-5">
              <div key={activeTab} className="mw-fade-enter">
                {activeTab === "privacy" ? <PrivacyTab /> : null}
                {activeTab === "broadcaster" ? <BroadcasterTab /> : null}
                {activeTab === "autoreply" ? <AutoReplyTab /> : null}
                {activeTab === "exporter" ? <ExporterTab /> : null}
                {activeTab === "vault" ? <VaultTab /> : null}
                {activeTab === "tools" ? <ToolsTab /> : null}
              </div>
            </main>
          </section>
        </div>
      </aside>
    </div>
  );
}

export function App() {
  const settings = useAppStore((state) => state.settings);
  const panelOpen = useAppStore((state) => state.panelOpen);
  const locked = useAppStore((state) => state.locked);
  const launcherFallback = useAppStore((state) => state.launcherFallback);
  const closePanel = useAppStore((state) => state.closePanel);

  const dir = dirFor(settings.language);

  useEffect(() => {
    if (locked) closePanel();
  }, [closePanel, locked]);

  return (
    <div className="mw-app" dir={dir} lang={settings.language}>
      {locked ? <LockScreen /> : null}
      {launcherFallback && !panelOpen ? <FloatingLauncher /> : null}
      {panelOpen ? <Drawer /> : null}
      <Toasts />
    </div>
  );
}
