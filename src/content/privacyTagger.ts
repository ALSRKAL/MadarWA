import type { PrivacySettings } from "../shared/types";
import { hasAnyBlur } from "./privacy-runtime";

export const ELEMENT_ATTR = "data-madarwa-el";
export const HOVER_ATTR = "data-madarwa-hover-at";
export const REVEALED_ATTR = "data-madarwa-revealed";

export type PrivacyElementTag =
  | "chat-item"
  | "contact-name"
  | "phone-number"
  | "chat-preview"
  | "avatar"
  | "message-text"
  | "media-box";

const MAX_ROWS = 120;
const MAX_MESSAGE_ROWS = 320;
const MAX_MEDIA_PER_ROW = 8;
const GUARD_WINDOW_MS = 400;

const PHONE_TEXT = /^[+(\d][\d\s().\-]{6,24}$/;

export function looksLikePhone(value: string): boolean {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 25) return false;
  if (!PHONE_TEXT.test(text)) return false;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 16;
}

function mediaBoxFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(`[${ELEMENT_ATTR}="media-box"]`);
  return element ?? null;
}

/**
 * Tags stable semantic targets in WhatsApp's volatile DOM so one precise CSS
 * selector can blur (and hover-reveal) each item without blurring its
 * neighbours. Runs only while at least one blur is active.
 */
export class PrivacyTagger {
  private active = false;
  private blurMedia = false;
  private observer: MutationObserver | null = null;
  private interval = 0;
  private timer = 0;
  private guardAttached = false;

  private readonly onPointerOver = (event: Event): void => {
    const element = mediaBoxFrom(event.target);
    if (!element) return;
    if (!element.hasAttribute(HOVER_ATTR)) element.setAttribute(HOVER_ATTR, String(Date.now()));
  };

  private readonly onPointerOut = (event: Event): void => {
    const element = mediaBoxFrom(event.target);
    if (!element) return;
    const next = event instanceof PointerEvent ? event.relatedTarget : null;
    if (next instanceof Node && element.contains(next)) return;
    element.removeAttribute(HOVER_ATTR);
    element.removeAttribute(REVEALED_ATTR);
  };

  private readonly onClick = (event: Event): void => {
    if (document.body?.getAttribute("data-madarwa-blur-media") !== "1") return;
    const element = mediaBoxFrom(event.target);
    if (!element) return;
    if (element.hasAttribute(REVEALED_ATTR)) return;

    const hoveredAt = Number(element.getAttribute(HOVER_ATTR) ?? 0);
    if (hoveredAt > 0 && Date.now() - hoveredAt > GUARD_WINDOW_MS) return;

    // The pointer just arrived (or this is a touch): reveal in place instead of
    // letting WhatsApp open its full-screen viewer for still-blurred content.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    element.setAttribute(REVEALED_ATTR, "1");
  };

  setActive(settings: PrivacySettings): void {
    this.blurMedia = settings.blurMedia;
    const active = hasAnyBlur(settings);
    if (active && !this.active) {
      this.start();
    } else if (!active && this.active) {
      this.stop();
    } else if (active) {
      this.schedule();
    }
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.attachGuard();
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.interval = window.setInterval(() => this.scan(), 5000);
    this.scan();
  }

  stop(): void {
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
    if (this.interval) window.clearInterval(this.interval);
    this.interval = 0;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
    this.detachGuard();
    document.querySelectorAll(`[${ELEMENT_ATTR}]`).forEach((element) => {
      element.removeAttribute(ELEMENT_ATTR);
      element.removeAttribute(HOVER_ATTR);
      element.removeAttribute(REVEALED_ATTR);
    });
  }

  schedule(delay = 400): void {
    if (!this.active || this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.scan();
    }, delay);
  }

  scanNow(): void {
    this.scan();
  }

  private scan(): void {
    if (!this.active) return;
    try {
      this.tagChatItems();
      this.tagPreviews();
      this.tagAvatars();
      this.cleanupPhones();
      this.tagPhones();
      this.tagNames();
      this.tagMessageText();
      this.tagMedia();
    } catch {
      // WhatsApp re-rendered mid-scan; the next mutation schedules another pass.
    }
  }

  private mark(element: Element | null | undefined, tag: PrivacyElementTag): void {
    if (!element) return;
    const current = element.getAttribute(ELEMENT_ATTR);
    if (current === tag) return;
    // A phone number inside a name keeps the more specific tag.
    if (current === "phone-number" && tag === "contact-name") return;
    element.setAttribute(ELEMENT_ATTR, tag);
  }

  private paneRows(): HTMLElement[] {
    const pane = document.querySelector("#pane-side");
    if (!pane) return [];
    return Array.from(
      pane.querySelectorAll<HTMLElement>(
        '[role="listitem"], [role="row"], [data-testid="cell-frame-container"]',
      ),
    ).slice(0, MAX_ROWS);
  }

  private tagChatItems(): void {
    for (const row of this.paneRows()) this.mark(row, "chat-item");
  }

  private tagPreviews(): void {
    const pane = document.querySelector("#pane-side");
    if (!pane) return;
    const previews = pane.querySelectorAll<HTMLElement>('[data-testid="cell-frame-secondary"]');
    for (const preview of Array.from(previews).slice(0, MAX_ROWS)) this.mark(preview, "chat-preview");
  }

  private tagAvatars(): void {
    const avatars = document.querySelectorAll<HTMLElement>(
      '#pane-side [data-testid="avatar"], #pane-side img, #main header [data-testid="avatar"], #main header img',
    );
    for (const holder of Array.from(avatars).slice(0, 160)) {
      const image = holder.tagName === "IMG" ? holder : holder.querySelector("img");
      if (image) this.mark(image, "avatar");
      else if (holder.tagName !== "IMG") this.mark(holder, "avatar");
    }

    const backgrounds = document.querySelectorAll<HTMLElement>(
      '#pane-side div[style*="background-image"], #main header div[style*="background-image"]',
    );
    for (const background of Array.from(backgrounds).slice(0, 160)) {
      if (!background.querySelector("img")) this.mark(background, "avatar");
    }
  }

  private displayNameHolders(): HTMLElement[] {
    const holders = document.querySelectorAll<HTMLElement>(
      '#pane-side [data-testid="cell-frame-title"], #main header [data-testid="conversation-info-header-chat-title"], #main header span[dir="auto"][title]',
    );
    return Array.from(holders).slice(0, MAX_ROWS);
  }

  private phoneCandidates(): HTMLElement[] {
    const nodes = document.querySelectorAll<HTMLElement>(
      [
        '#pane-side [data-testid="cell-frame-title"] span',
        '#main header span[dir="auto"]',
        '#main [data-testid="contact-info-drawer"] span',
        '#main [data-testid="drawer-right"] span',
      ].join(", "),
    );
    return Array.from(nodes).slice(0, 200);
  }

  private cleanupPhones(): void {
    document.querySelectorAll<HTMLElement>(`[${ELEMENT_ATTR}="phone-number"]`).forEach((element) => {
      if (!looksLikePhone(element.textContent ?? "")) element.removeAttribute(ELEMENT_ATTR);
    });
  }

  private tagPhones(): void {
    for (const element of this.phoneCandidates()) {
      if (element.closest(`[${ELEMENT_ATTR}="chat-preview"]`)) continue;
      const text = element.textContent ?? "";
      if (looksLikePhone(text)) this.mark(element, "phone-number");
    }
  }

  private tagNames(): void {
    for (const holder of this.displayNameHolders()) {
      const span = holder.querySelector<HTMLElement>('span[dir="auto"]');
      this.mark(span ?? holder, "contact-name");
    }

    const senderHeaders = document.querySelectorAll<HTMLElement>(
      '#main div[data-id] span[dir="auto"][title]',
    );
    for (const header of Array.from(senderHeaders).slice(0, MAX_MESSAGE_ROWS)) {
      if (looksLikePhone(header.textContent ?? "")) continue;
      if (header.closest(`[${ELEMENT_ATTR}="message-text"]`)) continue;
      this.mark(header, "contact-name");
    }
  }

  private messageRows(): HTMLElement[] {
    const main = document.querySelector("#main");
    if (!main) return [];
    return Array.from(main.querySelectorAll<HTMLElement>("div[data-id]")).slice(-MAX_MESSAGE_ROWS);
  }

  private tagMessageText(): void {
    for (const row of this.messageRows()) {
      const target =
        row.querySelector<HTMLElement>('[data-testid="msg-text"]') ??
        row.querySelector<HTMLElement>(".copyable-text");
      if (target) this.mark(target, "message-text");
    }
  }

  private tagMedia(): void {
    for (const row of this.messageRows()) {
      const media = row.querySelectorAll<HTMLElement>(
        'img, video, canvas, [data-testid="media-url"], [data-testid="sticker"]',
      );
      let count = 0;
      for (const element of media) {
        if (count >= MAX_MEDIA_PER_ROW) break;
        if (element.closest('[data-testid="avatar"]')) continue;
        if (element.closest(`[${ELEMENT_ATTR}="avatar"]`)) continue;

        if (element.tagName === "IMG") {
          const image = element as HTMLImageElement;
          const width = image.clientWidth || image.naturalWidth || 0;
          if (width > 0 && width < 48) continue;
          this.mark(element, "media-box");
          count += 1;
          continue;
        }
        if (element.tagName === "VIDEO" || element.tagName === "CANVAS") {
          this.mark(element, "media-box");
          count += 1;
          continue;
        }
        // Wrappers are tagged only when no concrete media element exists, so a
        // hovered child never leaves a blurred parent behind.
        if (!element.querySelector("img, video, canvas")) {
          this.mark(element, "media-box");
          count += 1;
        }
      }
    }
  }

  private attachGuard(): void {
    if (this.guardAttached) return;
    document.addEventListener("pointerover", this.onPointerOver, true);
    document.addEventListener("pointerout", this.onPointerOut, true);
    document.addEventListener("click", this.onClick, true);
    this.guardAttached = true;
  }

  private detachGuard(): void {
    if (!this.guardAttached) return;
    document.removeEventListener("pointerover", this.onPointerOver, true);
    document.removeEventListener("pointerout", this.onPointerOut, true);
    document.removeEventListener("click", this.onClick, true);
    this.guardAttached = false;
  }

  isActive(): boolean {
    return this.active;
  }

  isMediaBlurEnabled(): boolean {
    return this.blurMedia;
  }
}
