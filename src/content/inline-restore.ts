import type { DeletedMessage, Language } from "../shared/types";
import { formatTime } from "../shared/format";
import { tFor } from "../shared/i18n";
import { extractStanzaId } from "../shared/utils/revoke";

export interface InlineRestorerOptions {
  getLanguage?: () => Language;
  onOpenVault?: () => void;
}

const RESTORE_ATTR = "data-madarwa-inline-restore";
const ROW_ATTR = "data-madarwa-restored-id";
const RESTORE_ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 5v5h5"/></svg>';

/**
 * Restores a deleted message inside WhatsApp's own message row. The block is
 * inserted once per row and re-created after WhatsApp re-renders a chat; the
 * matching key is the original stanza id, not the DOM position or the revoke
 * event id.
 */
export class InlineRestorer {
  private readonly getLanguage: () => Language;
  private readonly onOpenVault: () => void;
  private readonly byId = new Map<string, DeletedMessage>();
  private readonly byStanza = new Map<string, DeletedMessage>();
  private enabled = true;
  private observer: MutationObserver | null = null;
  private interval = 0;
  private timer = 0;
  private language: Language = "ar";

  constructor(options: InlineRestorerOptions = {}) {
    this.getLanguage = options.getLanguage ?? (() => this.language);
    this.onOpenVault = options.onOpenVault ?? (() => undefined);
    this.language = this.getLanguage();
  }

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.interval = window.setInterval(() => this.scan(), 4000);
    this.scan();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.interval) window.clearInterval(this.interval);
    this.interval = 0;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      if (enabled) this.scan();
      return;
    }
    this.enabled = enabled;
    if (!enabled) {
      this.clearBlocks();
      this.stop();
      return;
    }
    this.start();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setLanguage(language: Language): void {
    if (this.language === language) return;
    this.language = language;
    this.clearBlocks();
    this.scan();
  }

  setRecords(vault: DeletedMessage[]): void {
    this.byId.clear();
    this.byStanza.clear();
    for (const entry of vault) {
      if (entry.id) this.byId.set(entry.id, entry);
      const stanza = entry.stanzaId || extractStanzaId(entry.id);
      if (stanza) this.byStanza.set(stanza, entry);
    }
    if (this.enabled) this.scan();
  }

  register(entry: DeletedMessage): void {
    if (entry.id) this.byId.set(entry.id, entry);
    const stanza = entry.stanzaId || extractStanzaId(entry.id);
    if (stanza) this.byStanza.set(stanza, entry);
  }

  restoreForRevoke(entry: DeletedMessage, revokeMessageId = ""): void {
    this.register(entry);
    if (!this.enabled) return;

    const rows = this.messageRows();
    let injected = false;
    for (const row of rows) {
      if (this.rowMatches(row, entry, revokeMessageId)) {
        this.inject(row, entry);
        injected = true;
      }
    }
    if (!injected) this.schedule(500);
  }

  scan(): void {
    if (!this.enabled) return;
    const rows = this.messageRows();
    for (const row of rows) {
      if (row.querySelector(`[${RESTORE_ATTR}]`)) continue;
      const entry = this.entryForRow(row);
      if (entry) this.inject(row, entry);
    }
  }

  clearBlocks(): void {
    document.querySelectorAll(`[${RESTORE_ATTR}]`).forEach((node) => node.remove());
    document.querySelectorAll(`[${ROW_ATTR}]`).forEach((node) => node.removeAttribute(ROW_ATTR));
  }

  dispose(): void {
    this.stop();
    this.clearBlocks();
    this.byId.clear();
    this.byStanza.clear();
  }

  private schedule(delay = 500): void {
    if (!this.enabled || this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.scan();
    }, delay);
  }

  private messageRows(): HTMLElement[] {
    const main = document.querySelector("#main");
    if (!main) return [];
    return Array.from(main.querySelectorAll<HTMLElement>("div[data-id]")).slice(-500);
  }

  private entryForRow(row: HTMLElement): DeletedMessage | undefined {
    const dataId = row.getAttribute("data-id") ?? "";
    if (!dataId) return undefined;
    const direct = this.byId.get(dataId);
    if (direct) return direct;
    const stanza = extractStanzaId(dataId);
    if (stanza) {
      const byStanza = this.byStanza.get(stanza);
      if (byStanza) return byStanza;
    }
    const tagged = row.getAttribute(ROW_ATTR);
    return tagged ? this.byId.get(tagged) : undefined;
  }

  private rowMatches(row: HTMLElement, entry: DeletedMessage, revokeMessageId: string): boolean {
    const dataId = row.getAttribute("data-id") ?? "";
    if (!dataId) return false;
    if (dataId === entry.id) return true;
    if (revokeMessageId && dataId === revokeMessageId) return true;
    const stanza = entry.stanzaId || extractStanzaId(entry.id);
    if (stanza && (dataId === stanza || dataId.endsWith(`_${stanza}`))) return true;
    return row.getAttribute(ROW_ATTR) === entry.id;
  }

  private inject(row: HTMLElement, entry: DeletedMessage): void {
    if (!this.enabled || row.querySelector(`[${RESTORE_ATTR}]`)) return;

    const textContainer =
      row.querySelector<HTMLElement>('[data-testid="msg-text"]') ??
      row.querySelector<HTMLElement>(".copyable-text") ??
      row;
    const bubble =
      row.querySelector<HTMLElement>('[data-testid="msg-container"]') ??
      textContainer.parentElement ??
      row;

    const language = this.getLanguage();
    const t = tFor(language);
    const dir = language === "ar" ? "rtl" : "ltr";

    const block = document.createElement("div");
    block.className = "madarwa-inline-restore";
    block.setAttribute(RESTORE_ATTR, entry.id);
    block.setAttribute("dir", dir);
    block.setAttribute("lang", language);
    block.setAttribute("role", "note");
    block.setAttribute("aria-label", t("inlineRestored.title"));

    const head = document.createElement("div");
    head.className = "madarwa-inline-head";
    const icon = document.createElement("span");
    icon.className = "madarwa-inline-icon";
    icon.innerHTML = RESTORE_ARROW;
    const title = document.createElement("span");
    title.className = "madarwa-inline-title";
    title.textContent = t("inlineRestored.title");
    const time = document.createElement("span");
    time.className = "madarwa-inline-time";
    time.textContent = formatTime(entry.timestamp, language);
    head.append(icon, title, time);

    block.appendChild(head);

    if (entry.previewDataUrl) {
      const image = document.createElement("img");
      image.className = "madarwa-inline-preview";
      image.src = entry.previewDataUrl;
      image.alt = t("inlineRestored.media");
      image.loading = "lazy";
      block.appendChild(image);
    }

    if (entry.text) {
      const body = document.createElement("div");
      body.className = "madarwa-inline-text";
      body.textContent = entry.text;
      block.appendChild(body);
    } else if (!entry.previewDataUrl) {
      const body = document.createElement("div");
      body.className = "madarwa-inline-text madarwa-inline-muted";
      body.textContent = t("inlineRestored.media");
      block.appendChild(body);
    }

    const senderValue = entry.senderName || entry.sender || entry.revokedBy;
    if (senderValue) {
      const sender = document.createElement("div");
      sender.className = "madarwa-inline-sender";
      sender.textContent = `${t("inlineRestored.sender")}: ${senderValue}`;
      block.appendChild(sender);
    }

    const footer = document.createElement("div");
    footer.className = "madarwa-inline-footer";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "madarwa-inline-open";
    open.textContent = t("inlineRestored.viewVault");
    open.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onOpenVault();
    });
    footer.appendChild(open);
    block.appendChild(footer);

    row.setAttribute(ROW_ATTR, entry.id);
    bubble.appendChild(block);
  }
}
