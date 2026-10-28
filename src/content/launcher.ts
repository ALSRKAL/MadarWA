import { useAppStore } from "./store";

const HOST_ID = "madarwa-launcher-host";

const LAUNCHER_CSS = `
:host { all: initial; }
.host { display: flex; align-items: center; justify-content: center; }
button {
  width: 34px; height: 34px; border: 0; padding: 0; cursor: pointer;
  border-radius: 11px; display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(145deg, #10b981 0%, #047857 100%);
  box-shadow: 0 6px 18px -6px rgba(4, 120, 87, .8), inset 0 1px 0 rgba(255,255,255,.25);
  transition: transform .16s ease, box-shadow .16s ease, filter .16s ease;
  position: relative; outline: none;
}
button:hover { transform: translateY(-1px) scale(1.05); filter: brightness(1.06); }
button:active { transform: scale(.96); }
button:focus-visible { box-shadow: 0 0 0 3px rgba(16,185,129,.45), 0 6px 18px -6px rgba(4,120,87,.8); }
button[data-active="true"] { box-shadow: 0 0 0 3px rgba(16,185,129,.38), 0 8px 24px -6px rgba(4,120,87,.95); }
svg { width: 20px; height: 20px; display: block; }
.dot {
  position: absolute; inset-inline-end: -2px; inset-block-start: -2px; width: 9px; height: 9px;
  border-radius: 999px; background: #64748b; border: 2px solid #0b1220; box-sizing: content-box;
  transition: background .2s ease;
}
button[data-connected="true"] .dot { background: #34d399; }
button[data-engine="false"] .dot { background: #f59e0b; }
`;

const ORBIT_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <ellipse cx="12" cy="12" rx="9.1" ry="4.2" fill="none" stroke="#ffffff" stroke-width="1.7" transform="rotate(-28 12 12)" opacity="0.92"/>
  <circle cx="12" cy="12" r="3.1" fill="#ffffff"/>
  <circle cx="19.1" cy="7.5" r="1.9" fill="#a7f3d0"/>
</svg>`;

function findHeaderMount(): HTMLElement | null {
  const headers = Array.from(document.querySelectorAll<HTMLElement>("#side header, header"));
  const visible = headers.find((header) => {
    const rect = header.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (!visible) return null;

  const buttons = Array.from(visible.querySelectorAll<HTMLElement>('[role="button"], button'));
  const last = buttons[buttons.length - 1];
  const toolbar = last?.parentElement;
  if (toolbar && toolbar !== visible && toolbar.getBoundingClientRect().width > 0) {
    return toolbar;
  }
  return visible;
}

/**
 * Mounts the launcher inside WhatsApp's top navigation bar when the DOM allows
 * it, and falls back to a floating action button (rendered by React) otherwise.
 */
export class LauncherManager {
  private host: HTMLElement | null = null;
  private interval = 0;
  private unsubscribe: (() => void) | null = null;
  private button: HTMLButtonElement | null = null;
  private dot: HTMLSpanElement | null = null;

  start(): void {
    if (this.interval) return;
    this.ensureMounted();
    this.interval = window.setInterval(() => this.ensureMounted(), 1500);
    this.unsubscribe = useAppStore.subscribe(() => this.syncState());
  }

  private ensureMounted(): void {
    if (this.host?.isConnected) {
      useAppStore.getState().setLauncherFallback(false);
      this.syncState();
      return;
    }

    const mount = findHeaderMount();
    if (!mount) {
      if (this.host) {
        this.host.remove();
        this.host = null;
      }
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
      "margin-inline-start:6px",
      "margin-inline-end:2px",
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
    button.title = "MadarWA";
    button.setAttribute("aria-label", "MadarWA — فتح لوحة التحكم");
    button.innerHTML = `${ORBIT_SVG}<span class="dot"></span>`;
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
      this.dot = null;
      useAppStore.getState().setLauncherFallback(true);
      return;
    }

    this.host = host;
    this.button = button;
    this.dot = button.querySelector<HTMLSpanElement>(".dot");
    useAppStore.getState().setLauncherFallback(false);
    this.syncState();
  }

  private syncState(): void {
    const state = useAppStore.getState();
    if (this.button) {
      this.button.dataset.active = String(state.panelOpen);
      this.button.dataset.connected = String(state.bridgeConnected && state.engine.connected);
      this.button.dataset.engine = String(state.engine.ready);
    }
    if (this.dot) {
      this.dot.style.display = state.bridgeConnected ? "block" : "none";
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
    this.dot = null;
  }
}
