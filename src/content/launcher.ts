import { connectionLabelKey, connectionTone } from "../shared/connection";
import { BRAND_COLORS } from "../shared/constants";
import { UI_FONT_FAMILY } from "../shared/fonts";
import { tFor } from "../shared/i18n";
import { selectConnectionPhase, selectUnseenVault, useAppStore } from "./store";

const HOST_ID = "madarwa-launcher-host";

// The launcher sits in WhatsApp's own header, so it borrows WhatsApp's icon
// colour (--mw-ink, read from the neighbouring icon button) instead of a brand
// colour. The dot appears only when MadarWA is not working; the badge only
// for deleted messages the user has not looked at yet.
const LAUNCHER_CSS = `
:host { all: initial; }
.host { display: flex; align-items: center; justify-content: center; }
button {
  width: 40px; height: 40px; border: 0; padding: 0; cursor: pointer;
  border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--mw-ink, #54656f); position: relative; outline: none;
  transition: background .12s ease;
}
button[data-theme="dark"] { color: var(--mw-ink, #e9edef); }
button:hover, button[data-active="true"] { background: rgba(11, 20, 26, .08); }
button[data-theme="dark"]:hover, button[data-theme="dark"][data-active="true"] { background: rgba(255, 255, 255, .1); }
button:focus-visible { outline: 2px solid ${BRAND_COLORS.accent}; outline-offset: 2px; }
svg { width: 22px; height: 22px; display: block; }
.dot {
  position: absolute; inset-inline-end: 7px; bottom: 7px; width: 8px; height: 8px;
  border-radius: 999px; box-shadow: 0 0 0 2px var(--mw-ring, #ffffff); display: none;
}
button[data-state="waiting"] .dot { display: block; background: ${BRAND_COLORS.waiting}; }
button[data-state="offline"] .dot { display: block; background: ${BRAND_COLORS.offline}; }
.badge {
  position: absolute; top: 1px; inset-inline-end: 0; min-width: 18px; height: 18px;
  border-radius: 999px; background: ${BRAND_COLORS.accent}; color: ${BRAND_COLORS.onAccent};
  box-shadow: 0 0 0 2px var(--mw-ring, #ffffff);
  font: 600 11px/18px "${UI_FONT_FAMILY}", "Segoe UI", system-ui, sans-serif; text-align: center; padding: 0 5px;
  box-sizing: border-box; display: none; font-variant-numeric: tabular-nums;
}
.badge[data-visible="true"] { display: block; }
@media (prefers-reduced-motion: reduce) {
  button { transition: none !important; }
}
`;

const ORBIT_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
  <ellipse cx="12" cy="12" rx="9.1" ry="4.1" stroke="currentColor" stroke-width="1.75" transform="rotate(-28 12 12)"/>
  <circle cx="12" cy="12" r="2.8" fill="currentColor"/>
  <circle cx="19.1" cy="7.4" r="1.5" fill="currentColor"/>
</svg>`;

const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function iconButtons(scope: Element): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('[role="button"], button')).filter(
    (button) => !button.closest(`#${HOST_ID}`) && isVisible(button),
  );
}

function isRow(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display.includes("flex") && !style.flexDirection.startsWith("column");
}

/**
 * WhatsApp's chat-list title row (the "WhatsApp" heading with the menu and
 * new-chat buttons). Its icon buttons share one flex row; the launcher joins
 * that row. Returns null on screens without it (QR, loading), where React
 * renders the floating launcher instead.
 */
function findToolbar(): HTMLElement | null {
  const headers = Array.from(document.querySelectorAll<HTMLElement>("#side header, header")).filter((header) => {
    if (header.closest("#main")) return false; // the open conversation's header
    const rect = header.getBoundingClientRect();
    return rect.width >= 180 && rect.height > 0 && rect.height <= 140 && iconButtons(header).length > 0;
  });
  // The innermost header is the title row; an outer one also wraps the search box.
  const titleRow = headers.find((header) => !headers.some((other) => other !== header && header.contains(other)));
  if (!titleRow) return null;

  const buttons = iconButtons(titleRow);
  if (buttons.length === 0) return null;
  let toolbar: HTMLElement | null = buttons[0]?.parentElement ?? null;
  while (toolbar && toolbar !== titleRow && !buttons.every((button) => toolbar?.contains(button))) {
    toolbar = toolbar.parentElement;
  }
  while (toolbar && toolbar !== titleRow && !isRow(toolbar)) toolbar = toolbar.parentElement;
  if (!toolbar || toolbar === titleRow) return null;
  return toolbar;
}

/** WhatsApp's own icon colour and header ground, so the launcher looks native in either theme. */
function readNativeColours(toolbar: HTMLElement): { ink: string; ring: string } {
  const plain = iconButtons(toolbar).find((button) => TRANSPARENT.test(getComputedStyle(button).backgroundColor));
  const ink = plain ? getComputedStyle(plain).color : "";
  let ring = "";
  for (let node: HTMLElement | null = toolbar; node && !ring; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    if (!TRANSPARENT.test(background)) ring = background;
  }
  return { ink, ring };
}

/**
 * Mounts the launcher as one more 40px icon button in WhatsApp's chat-list
 * toolbar, before the menu, so WhatsApp's own new-chat button keeps the end.
 */
export class LauncherManager {
  private host: HTMLElement | null = null;
  private interval = 0;
  private unsubscribe: (() => void) | null = null;
  private button: HTMLButtonElement | null = null;
  private badge: HTMLSpanElement | null = null;
  private mountTarget: HTMLElement | null = null;
  private colourTheme = "";

  start(): void {
    if (this.interval) return;
    this.ensureMounted();
    this.interval = window.setInterval(() => this.ensureMounted(), 1500);
    this.unsubscribe = useAppStore.subscribe(() => this.syncState());
  }

  private detach(): void {
    this.host?.remove();
    this.host = null;
    this.button = null;
    this.badge = null;
    this.mountTarget = null;
    this.colourTheme = "";
  }

  private ensureMounted(): void {
    const toolbar = findToolbar();

    if (this.host?.isConnected && toolbar && this.mountTarget === toolbar && toolbar.contains(this.host)) {
      useAppStore.getState().setLauncherFallback(false);
      this.syncState();
      return;
    }
    this.detach();

    if (!toolbar) {
      useAppStore.getState().setLauncherFallback(true);
      return;
    }

    const host = document.createElement("span");
    host.id = HOST_ID;
    host.setAttribute("data-madarwa-launcher", "1");
    host.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "flex:0 0 auto",
      "align-self:center",
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
    toolbar.insertBefore(host, toolbar.firstChild);

    const rect = host.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) {
      host.remove();
      useAppStore.getState().setLauncherFallback(true);
      return;
    }

    this.host = host;
    this.button = button;
    this.badge = button.querySelector<HTMLSpanElement>(".badge");
    this.mountTarget = toolbar;
    useAppStore.getState().setLauncherFallback(false);
    this.syncState();
  }

  private syncColours(theme: string): void {
    if (!this.host || !this.mountTarget || this.colourTheme === theme) return;
    const { ink, ring } = readNativeColours(this.mountTarget);
    if (ink) this.host.style.setProperty("--mw-ink", ink);
    else this.host.style.removeProperty("--mw-ink");
    if (ring) this.host.style.setProperty("--mw-ring", ring);
    else this.host.style.removeProperty("--mw-ring");
    this.colourTheme = theme;
  }

  private syncState(): void {
    const state = useAppStore.getState();
    if (!this.button) return;

    const t = tFor(state.settings.language);
    const phase = selectConnectionPhase(state);
    const label = `${t("launcher.open")} · ${t(connectionLabelKey(phase))}`;
    if (this.button.title !== label) {
      this.button.title = label;
      this.button.setAttribute("aria-label", label);
    }
    this.button.dataset.active = String(state.panelOpen);
    this.button.dataset.theme = state.theme;
    this.button.dataset.state = connectionTone(phase);
    this.syncColours(state.theme);

    if (this.badge) {
      const count = selectUnseenVault(state);
      this.badge.textContent = count > 99 ? "99+" : String(count);
      this.badge.dataset.visible = String(count > 0);
    }
  }

  stop(): void {
    window.clearInterval(this.interval);
    this.interval = 0;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.detach();
  }
}
