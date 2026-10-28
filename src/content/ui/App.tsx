import { useEffect } from "react";
import {
  Bot,
  Globe2,
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
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <ellipse
        cx="12"
        cy="12"
        rx="9.2"
        ry="4.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        transform="rotate(-28 12 12)"
        opacity="0.9"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="19.2" cy="7.4" r="1.7" fill="#a7f3d0" />
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

function FloatingLauncher() {
  const t = useT();
  const openPanel = useAppStore((state) => state.openPanel);
  const vaultCount = useAppStore((state) => state.vault.length);

  return (
    <div className="fixed bottom-5 end-5 z-[2147482500]" style={{ pointerEvents: "auto" }}>
      <button
        type="button"
        onClick={() => openPanel()}
        title={t("launcher.open")}
        aria-label={t("launcher.open")}
        className="mw-hero-orbit animate-madar-pulse-ring relative flex h-14 w-14 items-center justify-center rounded-2xl text-white transition-transform hover:scale-105 active:scale-95"
      >
        <OrbitMark className="h-7 w-7" />
        {vaultCount > 0 ? (
          <span className="absolute -end-1.5 -top-1.5 min-w-5 rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-5 text-white shadow">
            {vaultCount > 99 ? "99+" : vaultCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function TabsNav() {
  const t = useT();
  const activeTab = useAppStore((state) => state.activeTab);
  const setTab = useAppStore((state) => state.setTab);
  const vaultCount = useAppStore((state) => state.vault.length);
  const campaign = useAppStore((state) => state.campaign);

  return (
    <nav className="grid grid-cols-3 gap-1.5 px-4 py-3" aria-label="MadarWA sections">
      {TABS.map(({ id, key, icon: Icon }) => {
        const active = activeTab === id;
        const badge =
          id === "vault" && vaultCount > 0
            ? vaultCount > 99
              ? "99+"
              : String(vaultCount)
            : id === "broadcaster" && (campaign.status === "running" || campaign.status === "paused")
              ? "•"
              : "";
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60",
              active
                ? "bg-brand-500/14 text-brand-300 ring-1 ring-brand-500/30"
                : "mw-muted hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)]",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="line-clamp-1 text-[10.5px] font-semibold leading-4">{t(key)}</span>
            {badge ? (
              <span className="absolute end-1.5 top-1 min-w-4 rounded-full bg-rose-500/90 px-1 text-center text-[9px] font-bold leading-4 text-white">
                {badge}
              </span>
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

  const statusTone = !bridgeConnected
    ? "bg-rose-400"
    : engine.ready && engine.connected
      ? "bg-emerald-400"
      : "bg-amber-400";
  const statusLabel = !bridgeConnected
    ? t("status.disconnected")
    : engine.ready && engine.connected
      ? t("status.connected")
      : engine.ready
        ? t("status.waitingLogin")
        : t("status.engineWaiting");

  const switchLanguage = () => {
    setSettings({ ...settings, language: settings.language === "ar" ? "en" : "ar" });
  };

  return (
    <div className="fixed inset-0 z-[2147483000]" style={{ pointerEvents: "auto" }}>
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" onClick={closePanel} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("app.name")}
        className="mw-drawer animate-madar-slide-in absolute inset-y-0 end-0 flex w-[min(560px,100vw)] flex-col overflow-hidden border-s border-[color:var(--mw-border)] rounded-s-[26px]"
        onKeyDownCapture={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 px-4 pb-3 pt-4">
          <div className="flex items-start gap-3">
            <div className="mw-hero-orbit flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white">
              <OrbitMark className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[17px] font-bold leading-6">{t("app.name")}</h1>
                <span className="mw-muted mw-lang-pill rounded-md border border-[color:var(--mw-border)] px-1.5 py-0.5 text-[9px] font-semibold">
                  v{EXTENSION_VERSION}
                </span>
              </div>
              <p className="mw-muted truncate text-[11px]">{t("app.tagline")}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className={cn("relative flex h-2 w-2 rounded-full", statusTone)}>
                  {bridgeConnected && engine.ready ? (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  ) : null}
                </span>
                <span className="mw-muted text-[10px] font-semibold">{statusLabel}</span>
                {engine.wppVersion ? (
                  <span className="mw-muted mw-lang-pill text-[9px] opacity-70">· WA {engine.wppVersion.split(" ")[0]}</span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={switchLanguage}
                title={t("popup.language")}
                className="mw-lang-pill h-8 rounded-lg border border-[color:var(--mw-border)] px-2 text-[10px] font-bold text-[color:var(--mw-text)] transition-colors hover:bg-[color:var(--mw-hover)]"
              >
                {settings.language === "ar" ? "EN" : "ع"}
              </button>
              {settings.pin.enabled ? (
                <button
                  type="button"
                  onClick={() => contentController.lockNow()}
                  title={t("privacy.lockNow")}
                  aria-label={t("privacy.lockNow")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--mw-muted)] transition-colors hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)]"
                >
                  <Lock className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={closePanel}
                title={t("common.close")}
                aria-label={t("common.close")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--mw-muted)] transition-colors hover:bg-[color:var(--mw-hover)] hover:text-[color:var(--mw-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <TabsNav />

        {!engine.ready ? (
          <div className="mx-4 mb-1 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-200">
            {t("status.engineWaiting")}
          </div>
        ) : null}

        <main className="mw-scroll flex-1 overflow-y-auto px-4 pb-8 pt-2">
          <div key={activeTab} className="mw-fade-enter">
            {activeTab === "privacy" ? <PrivacyTab /> : null}
            {activeTab === "broadcaster" ? <BroadcasterTab /> : null}
            {activeTab === "autoreply" ? <AutoReplyTab /> : null}
            {activeTab === "exporter" ? <ExporterTab /> : null}
            {activeTab === "vault" ? <VaultTab /> : null}
            {activeTab === "tools" ? <ToolsTab /> : null}
          </div>
        </main>

        <footer className="flex shrink-0 items-center justify-between border-t border-[color:var(--mw-border)] px-4 py-2.5">
          <span className="mw-muted flex items-center gap-1.5 text-[10px]">
            <Globe2 className="h-3 w-3" />
            {t("app.poweredBy")}
          </span>
          <span className="mw-muted mw-lang-pill text-[9px]">MadarWA · {EXTENSION_VERSION}</span>
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
