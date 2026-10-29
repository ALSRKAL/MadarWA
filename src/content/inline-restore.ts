import type { DeletedMessage, InlineRestoreMode, Language, RevokedRowIndexEntry } from "../shared/types";
import { formatDate, formatTime } from "../shared/format";
import { tFor } from "../shared/i18n";
import { MediaVaultCache, type MediaVaultRecord } from "../shared/media-vault";
import {
  extensionForMimetype,
  formatBytes,
  formatDuration,
  normalizeMediaKind,
  type MediaKind,
} from "../shared/utils/media";
import { extractStanzaId } from "../shared/utils/revoke";

/** What the note under an unrecoverable deleted message can say about it. */
export interface CaptureInfo {
  /** When MadarWA started keeping copies in this browser (ms; 0 = unknown). */
  since: number;
  /** When the vault was last cleared (ms; 0 = never). */
  clearedAt: number;
}

export interface InlineRestorerOptions {
  getLanguage?: () => Language;
  getMode?: () => InlineRestoreMode;
  onOpenVault?: () => void;
  /** New message rows appeared in the open chat, so the revoke index may be stale. */
  onRowsAdded?: () => void;
  getCaptureInfo?: () => CaptureInfo;
  mediaVault?: MediaVaultCache;
}

/** Why no copy exists for a deleted message shown in the chat. */
export type MissingReason = "notReceived" | "beforeCapture" | "cleared";

type RowPlan =
  | { kind: "pill"; entry: DeletedMessage }
  | { kind: "missing"; reason: MissingReason; date: number }
  | null;

const RESTORE_ATTR = "data-madarwa-inline-restore";
const MISSING_ATTR = "data-madarwa-inline-missing";
/** On a block: the row data-id it was built for, so a recycled row is rebuilt. */
const BLOCK_ROW_ATTR = "data-madarwa-row-key";
const ROW_ATTR = "data-madarwa-restored-id";
const ROW_KEY_ATTR = "data-madarwa-restored-key";
const ENTRY_ATTR = "data-madarwa-entry-key";
/** Rescan this long after WhatsApp changes the open chat (it renders in bursts). */
const SCAN_DELAY_MS = 120;
/** Safety net in case a change slipped past the observer. */
const RESCAN_INTERVAL_MS = 4000;
/** A media lookup that found nothing is retried after this (the engine may still be saving it). */
const MEDIA_RETRY_MS = 10_000;
const MAX_ROWS = 500;

const SVG = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7C3.66 7.6 7.5 4.5 12 4.5s8.34 3.1 9.94 7.15a1 1 0 0 1 0 .7C20.34 16.4 16.5 19.5 12 19.5s-8.34-3.1-9.94-7.15Z"/><circle cx="12" cy="12" r="3"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg>',
  document:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/></svg>',
} as const;

interface MediaState {
  status: "loading" | "ready" | "missing";
  record?: MediaVaultRecord;
  url?: string;
  /** When a lookup last found nothing. */
  checkedAt?: number;
}

/** A JID is never a stanza; entries saved by older versions could hold one. */
function stanzaOf(entry: DeletedMessage): string {
  const stored = entry.stanzaId && !entry.stanzaId.includes("@") ? entry.stanzaId : "";
  return stored || extractStanzaId(entry.id);
}

/** True when the entry holds something to show: text, a caption, a preview or a media type. */
export function hasRestorableContent(entry: DeletedMessage): boolean {
  return Boolean(
    entry.text ||
      entry.caption ||
      entry.previewDataUrl ||
      entry.hasFullMedia ||
      normalizeMediaKind(entry.mediaType || entry.messageType),
  );
}

function svgNode(markup: string, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = markup;
  return span;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function entryKey(entry: DeletedMessage): string {
  return entry.id || entry.stanzaId || "";
}

function safeFilename(entry: DeletedMessage, record: MediaVaultRecord | undefined, kind: MediaKind | ""): string {
  const provided = record?.filename || entry.filename || "";
  const cleaned = provided.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 120);
  if (cleaned) return cleaned;
  const extension = extensionForMimetype(record?.mimetype || entry.mimetype || "", kind === "image" ? "jpg" : "bin");
  return `madarwa-${(entry.stanzaId || entry.id || "media").replace(/[^\w.-]+/g, "_")}.${extension}`;
}

/**
 * Renders a deleted message inside WhatsApp's own bubble as an interactive
 * pill. The native "This message was deleted" text is never removed; the
 * restored content is opt-in (Mode A) or expanded by default (Mode B).
 */
export class InlineRestorer {
  private readonly getLanguage: () => Language;
  private readonly getMode: () => InlineRestoreMode;
  private readonly onOpenVault: () => void;
  private readonly onRowsAdded: () => void;
  private readonly getCaptureInfo: () => CaptureInfo;
  private readonly mediaVault: MediaVaultCache;
  private readonly byId = new Map<string, DeletedMessage>();
  private readonly byStanza = new Map<string, DeletedMessage>();
  private readonly byRevoke = new Map<string, DeletedMessage>();
  /** Revoked rows WhatsApp knows about, keyed by every id their DOM row can carry. */
  private readonly revokedRows = new Map<string, RevokedRowIndexEntry>();
  /** Row data-ids already seen, to notice when WhatsApp renders new rows. */
  private readonly seenRowIds = new Set<string>();
  private readonly media = new Map<string, MediaState>();
  private readonly mediaTasks = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly expanded = new Set<string>();
  private readonly collapsedByUser = new Set<string>();
  private revokeIndexRows: RevokedRowIndexEntry[] = [];
  private revokeIndexSignature = "";
  private enabled = true;
  private observer: MutationObserver | null = null;
  private interval = 0;
  private timer = 0;
  private language: Language = "ar";
  private mode: InlineRestoreMode = "interactive";
  private lightbox: HTMLElement | null = null;
  private lightboxScale = 1;
  private lightboxImage: HTMLImageElement | null = null;

  constructor(options: InlineRestorerOptions = {}) {
    this.getLanguage = options.getLanguage ?? (() => this.language);
    this.getMode = options.getMode ?? (() => this.mode);
    this.onOpenVault = options.onOpenVault ?? (() => undefined);
    this.onRowsAdded = options.onRowsAdded ?? (() => undefined);
    this.getCaptureInfo = options.getCaptureInfo ?? (() => ({ since: 0, clearedAt: 0 }));
    this.mediaVault = options.mediaVault ?? new MediaVaultCache();
    this.language = this.getLanguage();
    this.mode = this.getMode();
  }

  /**
   * Watches the open chat and re-applies pills and notes whenever WhatsApp
   * renders it again: opening a chat, scrolling, or replacing a bubble.
   * Safe to call repeatedly.
   */
  start(): void {
    if (!this.observer && typeof MutationObserver === "function" && document.body) {
      this.observer = new MutationObserver((records) => this.onMutations(records));
      this.observer.observe(document.body, { childList: true, subtree: true });
    }
    if (!this.interval) this.interval = window.setInterval(() => this.scan(), RESCAN_INTERVAL_MS);
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
    if (!enabled) {
      if (!this.enabled) return;
      this.enabled = false;
      this.clearBlocks();
      this.stop();
      return;
    }
    // Starting here (not only on an off→on change) is what keeps pills
    // coming back after WhatsApp re-renders a chat.
    this.enabled = true;
    this.start();
  }

  isRunning(): boolean {
    return this.observer !== null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setLanguage(language: Language): void {
    if (this.language === language) return;
    this.language = language;
    this.rebuild();
  }

  setMode(mode: InlineRestoreMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.collapsedByUser.clear();
    // Back to click-to-reveal: pills opened by the auto-expanded mode close again.
    if (mode === "interactive") this.expanded.clear();
    this.rebuild();
  }

  getModeValue(): InlineRestoreMode {
    return this.mode;
  }

  setRecords(vault: DeletedMessage[]): void {
    this.byId.clear();
    this.byStanza.clear();
    this.byRevoke.clear();
    for (const entry of vault) this.register(entry);
    this.applyRevokeIndex();
    if (this.enabled) this.scan();
  }

  /**
   * Reconnects vault entries captured before this page load to the revoked
   * rows already rendered by WhatsApp (whose data-id is the revoke stanza).
   */
  setRevokeIndex(rows: RevokedRowIndexEntry[]): void {
    const next = Array.isArray(rows) ? rows.slice(-1000) : [];
    const signature = next
      .map((row) => `${row.revokeFull}|${row.revokeStanza}|${row.originalFull}|${row.originalStanza}|${row.timestamp}`)
      .join("~");
    if (signature === this.revokeIndexSignature) return;
    this.revokeIndexSignature = signature;
    this.revokeIndexRows = next;
    this.revokedRows.clear();
    for (const row of next) {
      for (const key of [row.revokeFull, row.revokeStanza, extractStanzaId(row.revokeFull)]) {
        if (key) this.revokedRows.set(key, row);
      }
    }
    this.applyRevokeIndex();
    if (this.enabled) this.scan();
  }

  private applyRevokeIndex(): void {
    for (const row of this.revokeIndexRows) {
      const entry =
        (row.originalFull ? this.byId.get(row.originalFull) : undefined) ??
        (row.originalStanza ? this.byStanza.get(row.originalStanza) : undefined);
      if (!entry) continue;
      // WhatsApp's row may carry either id of the revoked placeholder.
      if (row.revokeFull) this.register(entry, row.revokeFull);
      if (row.revokeStanza && row.revokeStanza !== row.revokeFull) this.register(entry, row.revokeStanza);
    }
  }

  register(entry: DeletedMessage, revokeMessageId = ""): void {
    if (entry.id) this.byId.set(entry.id, entry);
    const stanza = stanzaOf(entry);
    if (stanza) this.byStanza.set(stanza, entry);
    const revoke = revokeMessageId || entry.revokeMessageId || "";
    if (revoke) {
      this.byRevoke.set(revoke, entry);
      const revokeStanza = extractStanzaId(revoke);
      if (revokeStanza && revokeStanza !== revoke) this.byRevoke.set(revokeStanza, entry);
    }
  }

  restoreForRevoke(entry: DeletedMessage, revokeMessageId = ""): void {
    const revoke = revokeMessageId || entry.revokeMessageId || "";
    this.register(entry, revoke);
    if (!this.enabled) return;

    const plan = this.planForEntry(entry);
    let applied = false;
    for (const row of this.messageRows()) {
      if (this.rowMatches(row, entry, revoke)) {
        this.applyPlan(row, plan);
        applied = true;
      }
    }
    // The row may not be rendered yet; the observer also catches it later.
    if (!applied) this.schedule(SCAN_DELAY_MS);
  }

  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /**
   * Brings every message row of the open chat in line with what is known:
   * a pill for a saved copy, a note explaining a missing one, or nothing.
   * Idempotent: rows that are already right are left alone.
   */
  scan(): void {
    if (!this.enabled) return;
    let added = false;
    for (const row of this.messageRows()) {
      const dataId = row.getAttribute("data-id") ?? "";
      if (dataId && !this.seenRowIds.has(dataId)) {
        this.seenRowIds.add(dataId);
        added = true;
      }
      this.applyPlan(row, this.planFor(row));
    }
    if (this.seenRowIds.size > 5000) this.seenRowIds.clear();
    if (added) this.onRowsAdded();
  }

  clearBlocks(): void {
    this.closeLightbox();
    document.querySelectorAll(`[${RESTORE_ATTR}], [${MISSING_ATTR}]`).forEach((node) => node.remove());
    document.querySelectorAll(`[${ROW_ATTR}]`).forEach((node) => {
      node.removeAttribute(ROW_ATTR);
      node.removeAttribute(ROW_KEY_ATTR);
    });
  }

  dispose(): void {
    this.stop();
    this.clearBlocks();
    for (const state of this.media.values()) {
      if (state.url) URL.revokeObjectURL(state.url);
    }
    this.media.clear();
    this.byId.clear();
    this.byStanza.clear();
    this.byRevoke.clear();
    this.revokedRows.clear();
    this.seenRowIds.clear();
    this.expanded.clear();
    this.collapsedByUser.clear();
  }

  private rebuild(): void {
    this.clearBlocks();
    if (this.enabled) this.scan();
  }

  private schedule(delay = SCAN_DELAY_MS): void {
    if (!this.enabled || this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.scan();
    }, delay);
  }

  /** Reacts only to changes in (or around) the open chat, not the chat list. */
  private onMutations(records: MutationRecord[]): void {
    if (!this.enabled || this.timer) return;
    const main = document.querySelector("#main");
    for (const record of records) {
      const target = record.target;
      const relevant = main ? main.contains(target) || target.contains(main) : record.addedNodes.length > 0;
      if (relevant) {
        this.schedule();
        return;
      }
    }
  }

  private messageRows(): HTMLElement[] {
    const main = document.querySelector("#main");
    if (!main) return [];
    // A quoted message inside a bubble can carry its own data-id; only top-level rows count.
    return Array.from(main.querySelectorAll<HTMLElement>("div[data-id]"))
      .filter((row) => !row.parentElement?.closest("div[data-id]"))
      .slice(-MAX_ROWS);
  }

  private planFor(row: HTMLElement): RowPlan {
    const entry = this.entryForRow(row);
    if (entry) return this.planForEntry(entry);
    const revoked = this.revokedRowFor(row);
    return revoked ? this.missingPlan(revoked.timestamp) : null;
  }

  /** A saved deletion with nothing to show (only its notice arrived) gets the note, not an empty pill. */
  private planForEntry(entry: DeletedMessage): RowPlan {
    return hasRestorableContent(entry)
      ? { kind: "pill", entry }
      : { kind: "missing", reason: "notReceived", date: 0 };
  }

  private missingPlan(messageAt: number): RowPlan {
    const { since, clearedAt } = this.getCaptureInfo();
    if (since > 0 && messageAt > 0 && messageAt < since) return { kind: "missing", reason: "beforeCapture", date: since };
    if (clearedAt > 0 && messageAt > 0 && messageAt < clearedAt) {
      return { kind: "missing", reason: "cleared", date: clearedAt };
    }
    return { kind: "missing", reason: "notReceived", date: 0 };
  }

  private applyPlan(row: HTMLElement, plan: RowPlan): void {
    const dataId = row.getAttribute("data-id") ?? "";
    const current = row.querySelector<HTMLElement>(`[${RESTORE_ATTR}], [${MISSING_ATTR}]`);
    const wanted = plan
      ? plan.kind === "pill"
        ? `pill:${plan.entry.id}`
        : `missing:${plan.reason}:${plan.date}`
      : "";
    const have = current
      ? current.hasAttribute(RESTORE_ATTR)
        ? `pill:${current.getAttribute(RESTORE_ATTR) ?? ""}`
        : `missing:${current.getAttribute(MISSING_ATTR) ?? ""}`
      : "";
    if (wanted === have && (!current || current.getAttribute(BLOCK_ROW_ATTR) === dataId)) return;

    current?.remove();
    if (!plan) {
      row.removeAttribute(ROW_ATTR);
      row.removeAttribute(ROW_KEY_ATTR);
      return;
    }
    if (plan.kind === "pill") this.inject(row, plan.entry);
    else this.injectMissing(row, plan.reason, plan.date);
  }

  private entryForRow(row: HTMLElement): DeletedMessage | undefined {
    const dataId = row.getAttribute("data-id") ?? "";
    const testId = row.getAttribute("data-testid") ?? "";
    const domKey = testId.startsWith("conv-msg-") ? testId.slice("conv-msg-".length) : "";
    for (const key of [dataId, domKey]) {
      if (!key) continue;
      const direct = this.byId.get(key) || this.byRevoke.get(key);
      if (direct) return direct;
      const stanza = extractStanzaId(key);
      if (stanza) {
        const byStanza = this.byRevoke.get(stanza) || this.byStanza.get(stanza);
        if (byStanza) return byStanza;
      }
    }
    // A tag from an earlier match only counts while the row still shows the same message.
    const tagged = row.getAttribute(ROW_ATTR);
    if (tagged && dataId && row.getAttribute(ROW_KEY_ATTR) === dataId) return this.byId.get(tagged);
    return undefined;
  }

  private revokedRowFor(row: HTMLElement): RevokedRowIndexEntry | undefined {
    if (this.revokedRows.size === 0) return undefined;
    const dataId = row.getAttribute("data-id") ?? "";
    const testId = row.getAttribute("data-testid") ?? "";
    const domKey = testId.startsWith("conv-msg-") ? testId.slice("conv-msg-".length) : "";
    for (const key of [dataId, domKey]) {
      if (!key) continue;
      const found = this.revokedRows.get(key) ?? this.revokedRows.get(extractStanzaId(key));
      if (found) return found;
    }
    return undefined;
  }

  private rowMatches(row: HTMLElement, entry: DeletedMessage, revokeMessageId: string): boolean {
    const dataId = row.getAttribute("data-id") ?? "";
    const testId = row.getAttribute("data-testid") ?? "";
    if (!dataId) return false;
    if (dataId === entry.id) return true;
    if (revokeMessageId) {
      if (dataId === revokeMessageId) return true;
      // Real WhatsApp revoked rows use the bare stanza id as data-id while the
      // revoke event carries the full serialized key.
      const revokeStanza = extractStanzaId(revokeMessageId);
      if (revokeStanza) {
        if (dataId === revokeStanza || dataId.endsWith(`_${revokeStanza}`)) return true;
        if (testId === `conv-msg-${revokeStanza}` || testId.endsWith(revokeStanza)) return true;
      }
    }
    const stanza = stanzaOf(entry);
    if (stanza && (dataId === stanza || dataId.endsWith(`_${stanza}`))) return true;
    return row.getAttribute(ROW_ATTR) === entry.id && row.getAttribute(ROW_KEY_ATTR) === dataId;
  }

  /**
   * Where blocks go. Preferably inside the bubble itself (the part of the
   * message container that holds the time), so the block reads as part of
   * that message instead of floating between two messages. Falls back to the
   * container, then the row, on builds without those markers.
   */
  private placementFor(row: HTMLElement): { host: HTMLElement; inside: boolean } {
    const container = row.querySelector<HTMLElement>('[data-testid="msg-container"]');
    const meta = container?.querySelector<HTMLElement>('[data-testid="msg-meta"]') ?? null;
    if (container && meta) {
      let body: HTMLElement | null = meta;
      while (body && body.parentElement !== container) body = body.parentElement;
      if (body) return { host: body, inside: true };
    }
    const textContainer =
      row.querySelector<HTMLElement>('[data-testid="msg-text"]') ??
      row.querySelector<HTMLElement>(".copyable-text") ??
      row;
    return {
      host: container ?? (textContainer !== row ? textContainer.parentElement : null) ?? row,
      inside: false,
    };
  }

  private place(row: HTMLElement, block: HTMLElement): void {
    const { host, inside } = this.placementFor(row);
    if (inside) block.classList.add("madarwa-inline-inside");
    host.appendChild(block);
  }

  /** One quiet line under a deleted message that MadarWA has no copy of, saying why. */
  private injectMissing(row: HTMLElement, reason: MissingReason, date: number): void {
    if (!this.enabled || row.querySelector(`[${MISSING_ATTR}]`)) return;
    const language = this.getLanguage();
    const t = tFor(language);
    const why =
      reason === "beforeCapture"
        ? t("inlineRestored.missingBeforeCapture", { date: formatDate(date, language) })
        : reason === "cleared"
          ? t("inlineRestored.missingCleared", { date: formatDate(date, language) })
          : t("inlineRestored.missingNotReceived");

    const note = element("div", "madarwa-inline-missing");
    note.setAttribute(MISSING_ATTR, `${reason}:${date}`);
    note.setAttribute(BLOCK_ROW_ATTR, row.getAttribute("data-id") ?? "");
    note.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
    note.setAttribute("lang", language);
    note.setAttribute("role", "note");
    note.title = t("inlineRestored.missingHelp");

    const text = element("span", "madarwa-inline-missing-text");
    text.append(element("span", "madarwa-inline-missing-title", t("inlineRestored.missingTitle")), document.createTextNode(` · ${why}`));
    note.append(svgNode(SVG.info, "madarwa-inline-missing-icon"), text);
    // Selecting or double-clicking the note must not act on WhatsApp's message.
    note.addEventListener("dblclick", (event) => event.stopPropagation());
    this.place(row, note);
  }

  private inject(row: HTMLElement, entry: DeletedMessage): void {
    if (!this.enabled || row.querySelector(`[${RESTORE_ATTR}]`)) return;

    const language = this.getLanguage();
    const t = tFor(language);
    const dir = language === "ar" ? "rtl" : "ltr";
    const key = entryKey(entry);

    const block = element("div", "madarwa-inline-restore");
    block.setAttribute(RESTORE_ATTR, entry.id);
    block.setAttribute(ENTRY_ATTR, key);
    block.setAttribute(BLOCK_ROW_ATTR, row.getAttribute("data-id") ?? "");
    block.setAttribute("dir", dir);
    block.setAttribute("lang", language);
    block.setAttribute("role", "note");
    block.setAttribute("aria-label", t("inlineRestored.title"));
    block.setAttribute("data-expanded", "0");

    const pill = element("button", "madarwa-inline-pill");
    pill.type = "button";
    pill.setAttribute("aria-expanded", "false");
    pill.append(
      svgNode(SVG.eye, "madarwa-inline-icon"),
      element("span", "madarwa-inline-kind", this.kindLabel(entry)),
      element("span", "madarwa-inline-pill-label", t("inlineRestored.showDeleted")),
      svgNode(SVG.chevron, "madarwa-inline-chevron"),
    );

    const panel = element("div", "madarwa-inline-panel");
    const panelInner = element("div", "madarwa-inline-panel-inner");
    panel.appendChild(panelInner);

    block.append(pill, panel);
    block.addEventListener("pointerdown", (event) => event.stopPropagation());
    block.addEventListener("click", (event) => event.stopPropagation());
    block.addEventListener("dblclick", (event) => event.stopPropagation());

    pill.addEventListener("pointerdown", (event) => event.stopPropagation());
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle(block, entry);
    });

    row.setAttribute(ROW_ATTR, entry.id);
    row.setAttribute(ROW_KEY_ATTR, row.getAttribute("data-id") ?? "");
    this.place(row, block);

    const defaultExpanded =
      (this.mode === "expanded" && !this.collapsedByUser.has(key)) || this.expanded.has(key);
    if (defaultExpanded) {
      this.setExpanded(block, entry, true);
    }
  }

  private toggle(block: HTMLElement, entry: DeletedMessage): void {
    const isExpanded = block.getAttribute("data-expanded") === "1";
    this.setExpanded(block, entry, !isExpanded);
  }

  private setExpanded(block: HTMLElement, entry: DeletedMessage, expanded: boolean): void {
    const key = entryKey(entry);
    const t = tFor(this.getLanguage());
    block.setAttribute("data-expanded", expanded ? "1" : "0");

    const pill = block.querySelector<HTMLElement>(".madarwa-inline-pill");
    if (pill) pill.setAttribute("aria-expanded", expanded ? "true" : "false");
    const label = block.querySelector<HTMLElement>(".madarwa-inline-pill-label");
    if (label) {
      label.textContent = expanded
        ? t("inlineRestored.hideContent")
        : t("inlineRestored.showDeleted");
    }

    if (expanded) {
      this.expanded.add(key);
      this.collapsedByUser.delete(key);
      this.renderPanel(block, entry);
      void this.ensureMedia(entry);
    } else {
      this.expanded.delete(key);
      this.collapsedByUser.add(key);
    }
  }

  private renderPanel(block: HTMLElement, entry: DeletedMessage): void {
    if (!this.enabled) return;
    const inner = block.querySelector<HTMLElement>(".madarwa-inline-panel-inner");
    if (!inner) return;
    const state = this.media.get(entryKey(entry));
    inner.replaceChildren(this.buildPanel(entry, state));
  }
  private buildPanel(entry: DeletedMessage, state: MediaState | undefined): HTMLElement {
    const language = this.getLanguage();
    const t = tFor(language);
    const record = state?.status === "ready" ? state.record : undefined;
    const objectUrl = state?.status === "ready" ? state.url : undefined;
    const kind = normalizeMediaKind(entry.mediaType || entry.messageType || record?.kind);

    const wrap = element("div", "madarwa-inline-content");

    const meta = element("div", "madarwa-inline-meta");
    meta.append(
      svgNode(SVG.eye, "madarwa-inline-meta-icon"),
      element("span", "madarwa-inline-title", t("inlineRestored.title")),
    );
    wrap.appendChild(meta);

    const times = element("div", "madarwa-inline-times");
    times.textContent = `${t("inlineRestored.sentAt")} ${formatTime(entry.timestamp, language)} · ${t(
      "inlineRestored.deletedAt",
    )} ${formatTime(entry.revokedAt, language)}`;
    wrap.appendChild(times);

    const caption =
      entry.caption && entry.caption !== entry.text ? entry.caption : "";
    const text = entry.text || caption;
    if (text) {
      const body = element("div", "madarwa-inline-text", text);
      body.setAttribute("dir", "auto");
      wrap.appendChild(body);
      wrap.appendChild(this.toolRow([this.copyButton(text, t)]));
    }

    if (kind) {
      wrap.appendChild(this.buildMedia(entry, kind, record, objectUrl, t, language));
    } else if (!entry.text) {
      wrap.appendChild(
        element("div", "madarwa-inline-text madarwa-inline-muted", t("inlineRestored.notCaptured")),
      );
    }

    const senderValue = entry.senderName || entry.sender || entry.revokedBy;
    if (senderValue) {
      wrap.appendChild(
        element("div", "madarwa-inline-sender", `${t("inlineRestored.sender")}: ${senderValue}`),
      );
    }

    const footer = element("div", "madarwa-inline-footer");
    const open = element("button", "madarwa-inline-open", t("inlineRestored.viewVault"));
    open.type = "button";
    open.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onOpenVault();
    });
    footer.appendChild(open);
    wrap.appendChild(footer);

    return wrap;
  }

  private buildMedia(
    entry: DeletedMessage,
    kind: MediaKind,
    record: MediaVaultRecord | undefined,
    objectUrl: string | undefined,
    t: (key: string, variables?: Record<string, unknown>) => string,
    language: Language,
  ): HTMLElement {
    const container = element("div", "madarwa-inline-media");
    container.setAttribute("data-madarwa-media-kind", kind);
    const filename = safeFilename(entry, record, kind);
    const size = record?.fileSize || entry.fileSize || 0;
    const duration = record?.duration || entry.duration || 0;

    if (kind === "image" || kind === "sticker") {
      const source = objectUrl || entry.previewDataUrl || "";
      if (source) {
        const image = element("img", "madarwa-inline-image");
        image.src = source;
        image.alt = t("inlineRestored.media");
        image.loading = "lazy";
        image.decoding = "async";
        if (kind === "sticker") image.classList.add("madarwa-inline-sticker");
        if (objectUrl) {
          image.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openLightbox(objectUrl, filename, image.alt);
          });
        }
        container.appendChild(image);
      }
      if (!objectUrl) {
        container.appendChild(
          element("p", "madarwa-inline-note", t("inlineRestored.previewOnly")),
        );
      }
      if (objectUrl) container.appendChild(this.downloadLink(objectUrl, filename, t("inlineRestored.downloadImage")));
      return container;
    }

    if (kind === "video") {
      if (objectUrl) {
        const video = document.createElement("video");
        video.className = "madarwa-inline-video";
        video.controls = true;
        video.preload = "metadata";
        video.src = objectUrl;
        if (entry.width && entry.height) {
          video.width = entry.width;
          video.height = entry.height;
        }
        container.appendChild(video);
        container.appendChild(this.downloadLink(objectUrl, filename, t("inlineRestored.downloadVideo")));
      } else if (entry.previewDataUrl) {
        const shell = element("div", "madarwa-inline-video-shell");
        const image = element("img", "madarwa-inline-image");
        image.src = entry.previewDataUrl;
        image.alt = t("inlineRestored.media");
        shell.append(image, svgNode(SVG.play, "madarwa-inline-play"));
        container.append(shell, element("p", "madarwa-inline-note", t("inlineRestored.previewOnly")));
      } else {
        container.appendChild(element("p", "madarwa-inline-note", t("inlineRestored.mediaUnavailable")));
      }
      return container;
    }

    if (kind === "ptt" || kind === "audio") {
      if (objectUrl) {
        const audio = document.createElement("audio");
        audio.className = "madarwa-inline-audio";
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = objectUrl;
        container.appendChild(audio);
        if (duration > 0) {
          container.appendChild(element("span", "madarwa-inline-duration", formatDuration(duration)));
        }
        container.appendChild(this.downloadLink(objectUrl, filename, t("inlineRestored.downloadAudio")));
      } else {
        container.appendChild(
          element(
            "p",
            "madarwa-inline-note",
            duration > 0
              ? `${t("inlineRestored.audioPreview")} · ${formatDuration(duration)}`
              : t("inlineRestored.mediaUnavailable"),
          ),
        );
      }
      return container;
    }

    const fileRow = element("div", "madarwa-inline-file");
    fileRow.appendChild(svgNode(SVG.document, "madarwa-inline-file-icon"));
    const fileMeta = element("div", "madarwa-inline-file-meta");
    fileMeta.appendChild(element("span", "madarwa-inline-file-name", filename));
    fileMeta.appendChild(
      element(
        "span",
        "madarwa-inline-file-size",
        size > 0 ? formatBytes(size, language) : t("inlineRestored.mediaUnavailable"),
      ),
    );
    fileRow.appendChild(fileMeta);
    container.appendChild(fileRow);
    if (objectUrl) {
      container.appendChild(this.downloadLink(objectUrl, filename, t("inlineRestored.downloadFile")));
    }
    return container;
  }

  private toolRow(children: HTMLElement[]): HTMLElement {
    const row = element("div", "madarwa-inline-tools");
    for (const child of children) row.appendChild(child);
    return row;
  }

  private copyButton(text: string, t: (key: string) => string): HTMLButtonElement {
    const button = element("button", "madarwa-inline-tool");
    button.type = "button";
    button.append(svgNode(SVG.copy, "madarwa-inline-tool-icon"), element("span", "", t("inlineRestored.copy")));
    button.setAttribute("aria-label", t("inlineRestored.copy"));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.copyText(text).then((ok) => {
        if (!ok) return;
        const label = button.querySelector("span:last-child");
        if (label) label.textContent = t("inlineRestored.copied");
        window.setTimeout(() => {
          if (label?.isConnected) label.textContent = t("inlineRestored.copy");
        }, 1600);
      });
    });
    return button;
  }

  private downloadLink(url: string, filename: string, label: string): HTMLAnchorElement {
    const link = element("a", "madarwa-inline-tool");
    link.href = url;
    link.download = filename;
    link.setAttribute("aria-label", label);
    link.append(svgNode(SVG.download, "madarwa-inline-tool-icon"), element("span", "", label));
    link.addEventListener("pointerdown", (event) => event.stopPropagation());
    link.addEventListener("click", (event) => event.stopPropagation());
    return link;
  }

  private async copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API is unavailable on some WhatsApp builds.
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }

  private ensureMedia(entry: DeletedMessage): Promise<void> | null {
    const key = entryKey(entry);
    if (!key) return null;
    // Text has nothing in the media vault.
    if (!normalizeMediaKind(entry.mediaType || entry.messageType)) return null;
    const current = this.media.get(key);
    if (current && current.status === "ready") return null;
    // A miss is not final: the engine may still be saving the file.
    if (current && current.status === "missing" && Date.now() - (current.checkedAt ?? 0) < MEDIA_RETRY_MS) return null;
    const inFlight = this.mediaTasks.get(key);
    if (inFlight) return inFlight;

    this.media.set(key, { status: "loading" });
    const stanza = stanzaOf(entry);
    const task = (async () => {
      const record =
        (await this.mediaVault.get(entry.id)) ?? (stanza ? await this.mediaVault.get(stanza) : null);
      if (!record) {
        this.media.set(key, { status: "missing", checkedAt: Date.now() });
        return;
      }
      const url = URL.createObjectURL(record.blob);
      this.media.set(key, { status: "ready", record, url });
      this.refreshMedia(key);
    })()
      .catch(() => {
        this.media.set(key, { status: "missing", checkedAt: Date.now() });
      })
      .finally(() => {
        this.mediaTasks.delete(key);
        this.pending.delete(task);
      });
    this.mediaTasks.set(key, task);
    this.pending.add(task);
    return task;
  }

  private refreshMedia(key: string): void {
    const entry = this.byId.get(key) ?? this.byStanza.get(key);
    if (!entry) return;
    document.querySelectorAll<HTMLElement>(`[${RESTORE_ATTR}]`).forEach((block) => {
      if (block.getAttribute(ENTRY_ATTR) !== key) return;
      if (block.getAttribute("data-expanded") !== "1") return;
      this.renderPanel(block, entry);
    });
  }

  private kindLabel(entry: DeletedMessage): string {
    const t = tFor(this.getLanguage());
    switch (normalizeMediaKind(entry.mediaType || entry.messageType)) {
      case "image":
        return t("inlineRestored.kindImage");
      case "video":
        return t("inlineRestored.kindVideo");
      case "ptt":
        return t("inlineRestored.kindVoice");
      case "audio":
        return t("inlineRestored.kindAudio");
      case "sticker":
        return t("inlineRestored.kindSticker");
      case "document":
        return t("inlineRestored.kindDocument");
      default:
        return t("media.text");
    }
  }

  private openLightbox(src: string, filename: string, alt: string): void {
    this.closeLightbox();
    const t = tFor(this.getLanguage());
    const dir = this.getLanguage() === "ar" ? "rtl" : "ltr";

    const root = element("div", "madarwa-lightbox");
    root.setAttribute("dir", dir);
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", t("inlineRestored.lightboxTitle"));

    const toolbar = element("div", "madarwa-lightbox-toolbar");
    const zoomOut = this.lightboxButton(SVG.zoomOut, t("inlineRestored.zoomOut"), () => this.setLightboxScale(this.lightboxScale - 0.5));
    zoomOut.classList.add("madarwa-lightbox-zoom-btn");
    const zoomLabel = element("span", "madarwa-lightbox-zoom", "100%");
    const zoomIn = this.lightboxButton(SVG.zoomIn, t("inlineRestored.zoomIn"), () => this.setLightboxScale(this.lightboxScale + 0.5));
    zoomIn.classList.add("madarwa-lightbox-zoom-btn");
    const download = element("a", "madarwa-lightbox-action madarwa-lightbox-download");
    download.href = src;
    download.download = filename;
    download.setAttribute("aria-label", t("inlineRestored.downloadImage"));
    download.append(svgNode(SVG.download, "madarwa-lightbox-icon"), element("span", "", t("inlineRestored.downloadImage")));
    const close = this.lightboxButton(SVG.close, t("common.close"), () => this.closeLightbox());
    close.classList.add("madarwa-lightbox-close");

    toolbar.append(zoomOut, zoomLabel, zoomIn, download, close);
    const stage = element("div", "madarwa-lightbox-stage");
    const image = element("img", "madarwa-lightbox-image");
    image.src = src;
    image.alt = alt;
    stage.appendChild(image);
    root.append(toolbar, stage);

    root.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === root || event.target === stage) this.closeLightbox();
    });

    document.body.appendChild(root);
    this.lightbox = root;
    this.lightboxImage = image;
    this.lightboxScale = 1;
    (zoomLabel as HTMLElement).textContent = "100%";
    (root as HTMLElement & { __zoomLabel?: HTMLElement }).__zoomLabel = zoomLabel;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeLightbox();
      }
    };
    window.addEventListener("keydown", onKey, true);
    (root as HTMLElement & { __onKey?: (event: KeyboardEvent) => void }).__onKey = onKey;
    window.requestAnimationFrame(() => root.classList.add("is-open"));
  }

  private lightboxButton(svg: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = element("button", "madarwa-lightbox-action");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.appendChild(svgNode(svg, "madarwa-lightbox-icon"));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private setLightboxScale(value: number): void {
    const scale = Math.min(4, Math.max(0.5, Math.round(value * 2) / 2));
    this.lightboxScale = scale;
    if (this.lightboxImage) this.lightboxImage.style.transform = `scale(${scale})`;
    if (this.lightbox) {
      const label = (this.lightbox as HTMLElement & { __zoomLabel?: HTMLElement }).__zoomLabel;
      if (label) label.textContent = `${Math.round(scale * 100)}%`;
    }
  }

  private closeLightbox(): void {
    if (!this.lightbox) return;
    const root = this.lightbox as HTMLElement & { __onKey?: (event: KeyboardEvent) => void };
    if (root.__onKey) window.removeEventListener("keydown", root.__onKey, true);
    root.remove();
    this.lightbox = null;
    this.lightboxImage = null;
    this.lightboxScale = 1;
  }
}
