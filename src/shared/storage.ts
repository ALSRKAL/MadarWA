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
