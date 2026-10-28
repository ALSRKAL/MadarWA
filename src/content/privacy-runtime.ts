import type { PrivacySettings } from "../shared/types";
import type { ThemeName } from "./store";

const ATTRS = {
  blurPreview: "data-madarwa-blur-preview",
  blurNames: "data-madarwa-blur-names",
  blurAvatars: "data-madarwa-blur-avatars",
  blurMessages: "data-madarwa-blur-messages",
  blurMedia: "data-madarwa-blur-media",
  hidePresence: "data-madarwa-hide-presence",
  hideTyping: "data-madarwa-hide-typing",
} as const;

const PRESENCE_HIDDEN = "data-madarwa-hidden-presence";

export function applyPrivacyAttributes(settings: PrivacySettings): void {
  const body = document.body;
  if (!body) return;
  for (const [key, attribute] of Object.entries(ATTRS) as Array<[keyof typeof ATTRS, string]>) {
    if (settings[key]) body.setAttribute(attribute, "1");
    else body.removeAttribute(attribute);
  }
}

function parseRgb(color: string): [number, number, number, number] | null {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match || !match[1]) return null;
  const parts = match[1].split(/[, /]+/).filter(Boolean).map((part) => Number.parseFloat(part));
  if (parts.length < 3) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

export function detectTheme(): ThemeName {
  try {
    const html = document.documentElement;
    const body = document.body;
    if (html.classList.contains("dark") || body.classList.contains("dark")) return "dark";
    if (html.getAttribute("data-theme") === "dark") return "dark";

    const candidates = [body, document.querySelector("#app"), html].filter(Boolean) as HTMLElement[];
    for (const element of candidates) {
      const style = getComputedStyle(element);
      const parsed = parseRgb(style.backgroundColor);
      if (!parsed || parsed[3] === 0) continue;
      const [r = 0, g = 0, b = 0] = parsed;
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return luminance < 0.45 ? "dark" : "light";
    }
  } catch {
    // Fall through to the dark default, which matches WhatsApp's default theme.
  }
  return "dark";
}

export function watchTheme(onChange: (theme: ThemeName) => void): () => void {
  let current = detectTheme();
  onChange(current);

  const check = () => {
    const next = detectTheme();
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };

  const observer = new MutationObserver(() => check());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  if (document.body) {
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  }
  const interval = window.setInterval(check, 2500);

  return () => {
    observer.disconnect();
    window.clearInterval(interval);
  };
}

const HEADER_PRESENCE =
  /^(متصل الآن|متصل الان|متصل|آخر ظهور.*|اخر ظهور.*|online|last seen.*|يكتب.*|typing.*|is typing.*|recording.*|يسجل.*)(\s*\.{2,}|…)?$/i;

const ROW_PRESENCE =
  /^(متصل الآن|متصل الان|متصل|online|يكتب الآن|يكتب|typing|is typing|recording|يسجل مقطعاً صوتياً)(\s*\.{2,}|…)?$/i;

/**
 * Presence/typing cannot be disabled server-side for incoming indicators, so
 * this scrubber hides the indicator elements in the WhatsApp UI. It only
 * targets short presence strings — never message previews.
 */
export class PresenceScrubber {
  private hidePresence = false;
  private hideTyping = false;
  private observer: MutationObserver | null = null;
  private interval = 0;
  private timer = 0;
  private readonly marked = new Set<HTMLElement>();

  setEnabled(hidePresence: boolean, hideTyping: boolean): void {
    const wasEnabled = this.hidePresence || this.hideTyping;
    this.hidePresence = hidePresence;
    this.hideTyping = hideTyping;
    const enabled = hidePresence || hideTyping;

    if (enabled && !wasEnabled) this.start();
    if (!enabled && wasEnabled) this.stop();
    if (enabled) this.schedule(60);
  }

  private start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => this.schedule(700));
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.interval = window.setInterval(() => this.scan(), 4000);
  }

  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.clearInterval(this.interval);
    this.interval = 0;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
    for (const element of this.marked) element.removeAttribute(PRESENCE_HIDDEN);
    this.marked.clear();
  }

  schedule(delay = 500): void {
    if (!this.hidePresence && !this.hideTyping) return;
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.scan();
    }, delay);
  }

  private scan(): void {
    if (!this.hidePresence && !this.hideTyping) return;
    const nextMarked = new Set<HTMLElement>();

    const consider = (element: HTMLElement | null, matcher: RegExp) => {
      if (!element) return;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 90) return;
      if (!matcher.test(text)) return;
      element.setAttribute(PRESENCE_HIDDEN, "1");
      nextMarked.add(element);
    };

    try {
      const header = document.querySelector<HTMLElement>("#main header");
      if (header) {
        const spans = header.querySelectorAll<HTMLElement>("span");
        for (let i = 0; i < Math.min(spans.length, 30); i += 1) {
          const span = spans[i];
          if (!span) continue;
          const text = (span.textContent ?? "").trim();
          const isTyping = /يكتب|typing|recording|يسجل/i.test(text);
          if (this.hidePresence && !isTyping) consider(span, HEADER_PRESENCE);
          if (this.hideTyping && isTyping) consider(span, HEADER_PRESENCE);
        }
      }

      const rows = document.querySelectorAll<HTMLElement>(
        '#pane-side [role="listitem"], #pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
      );
      for (let i = 0; i < Math.min(rows.length, 80); i += 1) {
        const row = rows[i];
        if (!row) continue;
        const spans = row.querySelectorAll<HTMLElement>("span");
        for (let j = 0; j < Math.min(spans.length, 12); j += 1) {
          const span = spans[j];
          if (!span) continue;
          const text = (span.textContent ?? "").trim();
          if (!text || text.length > 60) continue;
          const isTyping = /يكتب|typing|recording|يسجل/i.test(text);
          if (this.hidePresence && !isTyping) consider(span, ROW_PRESENCE);
          if (this.hideTyping && isTyping) consider(span, ROW_PRESENCE);
        }
      }
    } catch {
      // DOM changed mid-scan; the next mutation triggers another pass.
    }

    for (const element of this.marked) {
      if (!nextMarked.has(element)) element.removeAttribute(PRESENCE_HIDDEN);
    }
    this.marked.clear();
    for (const element of nextMarked) this.marked.add(element);
  }
}
