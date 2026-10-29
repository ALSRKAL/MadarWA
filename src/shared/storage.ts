import { STORAGE_KEYS } from "./constants";
import { mergeSettings } from "./defaults";
import type { AppSettings, DeletedMessage, WebhookLogEntry } from "./types";

export function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function storageArea(): chrome.storage.StorageArea {
  return chrome.storage.local;
}

export async function readStorage<T>(key: string, fallback: T): Promise<T> {
  try {
    const result = await storageArea().get(key);
    return (result[key] as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function writeStorage(key: string, value: unknown): Promise<boolean> {
  try {
    await storageArea().set({ [key]: value });
    return true;
  } catch {
    return false;
  }
}

export async function removeStorage(key: string): Promise<void> {
  try {
    await storageArea().remove(key);
  } catch {
    // Storage unavailable (orphaned content script) — caller keeps memory state.
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await readStorage<unknown>(STORAGE_KEYS.settings, null);
  return mergeSettings(raw);
}

export async function saveSettings(settings: AppSettings): Promise<boolean> {
  return writeStorage(STORAGE_KEYS.settings, { ...settings, updatedAt: Date.now() });
}

export async function loadVault(max = 1000): Promise<DeletedMessage[]> {
  const raw = await readStorage<unknown>(STORAGE_KEYS.vault, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDeletedMessage).slice(0, max);
}

export function isDeletedMessage(value: unknown): value is DeletedMessage {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<DeletedMessage>;
  return (
    typeof entry.id === "string" &&
    typeof entry.chatId === "string" &&
    typeof entry.text === "string" &&
    typeof entry.timestamp === "number" &&
    typeof entry.revokedAt === "number"
  );
}

export async function saveVault(entries: DeletedMessage[]): Promise<boolean> {
  return writeStorage(STORAGE_KEYS.vault, entries.slice(0, 1000));
}

/** Deleted messages captured after the user last opened the vault. */
export function countUnseen(entries: readonly unknown[], seenAt: number): number {
  let count = 0;
  for (const entry of entries) {
    const revokedAt = (entry as Partial<DeletedMessage> | null)?.revokedAt;
    if (typeof revokedAt === "number" && revokedAt > seenAt) count += 1;
  }
  return count;
}

/** A stored time in ms, or 0 when it is missing or invalid. */
export function asTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export async function loadTimestamp(key: string): Promise<number> {
  return asTimestamp(await readStorage<unknown>(key, 0));
}

export async function saveTimestamp(key: string, at: number): Promise<boolean> {
  return writeStorage(key, asTimestamp(at));
}

export async function loadVaultSeenAt(): Promise<number> {
  return loadTimestamp(STORAGE_KEYS.vaultSeenAt);
}

export async function saveVaultSeenAt(at: number): Promise<boolean> {
  return saveTimestamp(STORAGE_KEYS.vaultSeenAt, at);
}

/**
 * Two deletions are the same when they share an id or a stanza; WhatsApp
 * reports an old deletion again after every reload.
 */
export function sameDeletion(a: DeletedMessage, b: DeletedMessage): boolean {
  if (a.id && a.id === b.id) return true;
  const stanzaA = a.stanzaId && !a.stanzaId.includes("@") ? a.stanzaId : "";
  const stanzaB = b.stanzaId && !b.stanzaId.includes("@") ? b.stanzaId : "";
  return Boolean(stanzaA && stanzaA === stanzaB);
}

/**
 * Fills what an earlier record of the same deletion lacked (its revoke id,
 * or content found later) without touching what it already had. Returns the
 * existing record unchanged when there is nothing to add.
 */
export function mergeDeletion(existing: DeletedMessage, incoming: DeletedMessage): DeletedMessage {
  const patch: Partial<DeletedMessage> = {};
  if (!existing.revokeMessageId && incoming.revokeMessageId) patch.revokeMessageId = incoming.revokeMessageId;
  // Older versions stored the detection time for deletions whose text never
  // arrived; the store model now reports when the message was really sent.
  if (!existing.recoveredFromCache && incoming.timestamp > 0 && incoming.timestamp < existing.timestamp - 60_000) {
    patch.timestamp = incoming.timestamp;
  }
  const existingEmpty = !existing.text && !existing.caption && !existing.previewDataUrl && !existing.hasFullMedia;
  const incomingHasContent = Boolean(incoming.text || incoming.caption || incoming.previewDataUrl || incoming.hasFullMedia);
  if (existingEmpty && incomingHasContent) {
    Object.assign(patch, {
      text: incoming.text,
      caption: incoming.caption,
      previewDataUrl: incoming.previewDataUrl,
      hasFullMedia: incoming.hasFullMedia,
      messageType: incoming.messageType || existing.messageType,
      mediaType: incoming.mediaType || existing.mediaType,
      mimetype: incoming.mimetype || existing.mimetype,
      filename: incoming.filename || existing.filename,
      fileSize: incoming.fileSize || existing.fileSize,
      duration: incoming.duration || existing.duration,
      width: incoming.width || existing.width,
      height: incoming.height || existing.height,
      recoveredFromCache: true,
    });
  }
  return Object.keys(patch).length > 0 ? { ...existing, ...patch } : existing;
}

export async function loadWebhookLog(): Promise<WebhookLogEntry[]> {
  const raw = await readStorage<unknown>(STORAGE_KEYS.webhookLog, []);
  return Array.isArray(raw) ? raw.filter(isWebhookLog).slice(0, 60) : [];
}

function isWebhookLog(value: unknown): value is WebhookLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<WebhookLogEntry>;
  return typeof entry.id === "string" && typeof entry.at === "number" && typeof entry.url === "string";
}

export async function saveWebhookLog(entries: WebhookLogEntry[]): Promise<boolean> {
  return writeStorage(STORAGE_KEYS.webhookLog, entries.slice(0, 60));
}

export function onStorageChanged(listener: (changes: Record<string, chrome.storage.StorageChange>) => void): () => void {
  if (!isExtensionContextValid()) return () => undefined;
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local") listener(changes);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function sanitizeFilename(name: string, fallback = "madarwa"): string {
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

/** Downloads text from a content script using a temporary blob URL. */
export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8"): boolean {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sanitizeFilename(filename);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    (document.body ?? document.documentElement).appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    return false;
  }
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsText(file);
  });
}
