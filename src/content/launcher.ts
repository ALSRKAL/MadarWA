import { tFor } from "../shared/i18n";
import { useAppStore } from "./store";

const HOST_ID = "madarwa-launcher-host";

const LAUNCHER_CSS = `
:host { all: initial; }
.host { display: flex; align-items: center; justify-content: center; }
button {
  width: 40px; height: 40px; border: 0; padding: 0; cursor: pointer;
  border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: #00a884; position: relative; outline: none;
  transition: background .12s ease, color .12s ease;
}
button:hover { background: rgba(134, 150, 160, .18); }
button[data-active="true"] { background: rgba(0, 168, 132, .12); }
button:focus-visible { outline: 2px solid #00a884; outline-offset: 2px; }
svg { width: 20px; height: 20px; display: block; }
.dot {
  position: absolute; inset-inline-end: 8px; bottom: 7px; width: 6px; height: 6px;
  border-radius: 999px; background: #8696a0; box-shadow: 0 0 0 2px #202c33;
}
button[data-theme="light"] .dot { box-shadow: 0 0 0 2px #f0f2f5; }
button[data-state="live"] .dot { background: #06cf9c; }
button[data-state="waiting"] .dot { background: #f59e0b; }
button[data-state="offline"] .dot { background: #f15c6d; }
button[data-state="live"] .dot::after {
  content: ""; position: absolute; inset: -3px; border-radius: 999px;
  border: 1px solid rgba(0, 168, 132, .55); animation: madar-live 2.4s ease-out infinite;
}
@keyframes madar-live {
  0% { transform: scale(.7); opacity: .8; }
  70% { transform: scale(1.35); opacity: 0; }
  100% { transform: scale(1.35); opacity: 0; }
}
.badge {
  position: absolute; top: 1px; inset-inline-end: 1px; min-width: 14px; height: 14px;
  border-radius: 999px; background: #f15c6d; color: #1b1013;
  font: 700 9px/14px Inter, "Segoe UI", sans-serif; text-align: center; padding: 0 3px;
  box-sizing: border-box; display: none;
}
.badge[data-visible="true"] { display: block; }
@media (prefers-reduced-motion: reduce) {
  button, .dot, .dot::after { transition: none !important; animation: none !important; }
}
`;

const ORBIT_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
  <ellipse cx="12" cy="12" rx="9.1" ry="4.1" stroke="currentColor" stroke-width="1.75" transform="rotate(-28 12 12)"/>
  <circle cx="12" cy="12" r="2.8" fill="currentColor"/>
  <circle cx="19.1" cy="7.4" r="1.5" fill="currentColor"/>
</svg>`;

function findHeaderMount(): HTMLElement | null {
  const headers = Array.from(document.querySelectorAll<HTMLElement>("#side header, header"))
    .map((header) => ({ header, rect: header.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);

  // WhatsApp's new shell has a narrow full-height app rail plus a wide chat-list
  // header. The launcher belongs in the wide top header, not in the rail.
  const wide = headers
    .filter(({ rect }) => rect.width >= 180 && rect.height <= 140)
    .sort((a, b) => b.rect.width - a.rect.width)[0];
  if (!wide) return null;

  const target = wide.header;
  const buttons = Array.from(target.querySelectorAll<HTMLElement>('[role="button"], button'));
  const last = buttons[buttons.length - 1];
  const toolbar = last?.parentElement;
  if (toolbar && toolbar !== target) {
    const rect = toolbar.getBoundingClientRect();
    if (rect.width >= 60 && rect.height > 0) return toolbar;
  }
  return target;
}

/**
 * Mounts the launcher inside WhatsApp's own sidebar header. The host is a
 * single 40px circular icon button so it inherits the native rhythm; a
 * floating draggable fallback is rendered by React only when the header is
 * absent (QR/login screens).
 */
export class LauncherManager {
  private host: HTMLElement | null = null;
  private interval = 0;
  private unsubscribe: (() => void) | null = null;
  private button: HTMLButtonElement | null = null;
  private badge: HTMLSpanElement | null = null;
  private mountTarget: HTMLElement | null = null;

  start(): void {
    if (this.interval) return;
    this.ensureMounted();
    this.interval = window.setInterval(() => this.ensureMounted(), 1500);
    this.unsubscribe = useAppStore.subscribe(() => this.syncState());
  }

  private ensureMounted(): void {
    const mount = findHeaderMount();

    if (this.host?.isConnected) {
      if (mount && (this.mountTarget === mount || this.mountTarget?.contains(this.host))) {
        useAppStore.getState().setLauncherFallback(false);
        this.syncState();
        return;
      }
      this.host.remove();
      this.host = null;
      this.button = null;
      this.badge = null;
      this.mountTarget = null;
    }

    if (!mount) {
      useAppStore.getState().setLauncherFallback(true);
      return;
    }

    this.host?.remove();
    const host = document.createElement("span");
    host.id = HOST_ID;
    host.setAttribute("data-madarwa-launcher", "1");
    host.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "flex:0 0 auto",
      "align-self:center",
      "margin-inline-start:2px",
      "z-index:5",
      "pointer-events:auto",
    ].join(";");

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = LAUNCHER_CSS;

    const wrap = document.createElement("div");
    wrap.className = "host";
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `${ORBIT_SVG}<span class="dot"></span><span class="badge"></span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const state = useAppStore.getState();
      if (state.panelOpen) state.closePanel();
      else state.openPanel();
    });

    wrap.appendChild(button);
    shadow.append(style, wrap);
    mount.appendChild(host);

    const rect = host.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) {
      host.remove();
      this.host = null;
      this.button = null;
      this.badge = null;
      this.mountTarget = null;
      useAppStore.getState().setLauncherFallback(true);
      return;
    }

    this.host = host;
    this.button = button;
    this.badge = button.querySelector<HTMLSpanElement>(".badge");
    this.mountTarget = mount;
    useAppStore.getState().setLauncherFallback(false);
    this.syncState();
  }

  private syncState(): void {
    const state = useAppStore.getState();
    if (!this.button) return;

    const language = state.settings.language;
    const label = tFor(language)("launcher.open");
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    this.button.dataset.active = String(state.panelOpen);
    this.button.dataset.theme = state.theme;
    this.button.dataset.state = !state.bridgeConnected
      ? "offline"
      : state.engine.ready && state.engine.connected
        ? "live"
        : "waiting";

    if (this.badge) {
      const count = state.vault.length;
      this.badge.textContent = count > 99 ? "99+" : String(count);
      this.badge.dataset.visible = String(count > 0);
    }
  }

  stop(): void {
    window.clearInterval(this.interval);
    this.interval = 0;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.host?.remove();
    this.host = null;
    this.button = null;
    this.badge = null;
    this.mountTarget = null;
  }
}
