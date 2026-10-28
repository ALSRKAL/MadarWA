import type { MediaKind } from "./utils/media";

export const MEDIA_VAULT_DB = "madarwa_media_vault";
export const MEDIA_VAULT_STORE = "media";
export const MEDIA_VAULT_LIMIT = 150;
const MEDIA_VAULT_VERSION = 2;

export interface MediaVaultRecord {
  /** Serialized WhatsApp message id. Primary key. */
  id: string;
  /** Stanza id, indexed for revoke events that only expose the stanza. */
  stanzaId: string;
  chatId: string;
  kind: MediaKind;
  mimetype: string;
  filename: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  blob: Blob;
  previewDataUrl: string;
  caption: string;
  createdAt: number;
  lastAccess: number;
}

export interface MediaVaultInput extends Omit<MediaVaultRecord, "createdAt" | "lastAccess"> {
  createdAt?: number;
  lastAccess?: number;
}

export interface MediaVaultOptions {
  /** Inject a factory in tests; pass `null` to force the in-memory cache. */
  factory?: IDBFactory | null;
  dbName?: string;
  maxEntries?: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Bounded media cache shared by the MAIN and ISOLATED worlds through the
 * whatsapp.com origin. IndexedDB is unavailable in some private modes, so an
 * equivalent in-memory map keeps the rest of the feature working.
 */
export class MediaVaultCache {
  private readonly dbName: string;
  private readonly maxEntries: number;
  private readonly factory: IDBFactory | null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private readonly memory = new Map<string, MediaVaultRecord>();

  constructor(options: MediaVaultOptions = {}) {
    this.dbName = options.dbName ?? MEDIA_VAULT_DB;
    this.maxEntries = Math.max(1, options.maxEntries ?? MEDIA_VAULT_LIMIT);
    this.factory =
      options.factory !== undefined
        ? options.factory
        : typeof indexedDB !== "undefined"
          ? indexedDB
          : null;
  }

  get usingIndexedDb(): boolean {
    return this.factory !== null;
  }

  private open(): Promise<IDBDatabase | null> {
    if (!this.factory) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.factory!.open(this.dbName, MEDIA_VAULT_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(MEDIA_VAULT_STORE)
          ? request.transaction!.objectStore(MEDIA_VAULT_STORE)
          : db.createObjectStore(MEDIA_VAULT_STORE, { keyPath: "id" });
        if (!store.indexNames.contains("stanzaId")) store.createIndex("stanzaId", "stanzaId", { unique: false });
        if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt", { unique: false });
        if (!store.indexNames.contains("lastAccess")) store.createIndex("lastAccess", "lastAccess", { unique: false });
        if (!store.indexNames.contains("chatId")) store.createIndex("chatId", "chatId", { unique: false });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });

    return this.dbPromise;
  }

  async put(input: MediaVaultInput): Promise<MediaVaultRecord> {
    const now = Date.now();
    const record: MediaVaultRecord = {
      ...input,
      createdAt: input.createdAt ?? now,
      lastAccess: input.lastAccess ?? input.createdAt ?? now,
    };

    const db = await this.open();
    if (!db) {
      this.memory.set(record.id, record);
      this.pruneMemory();
      return record;
    }

    try {
      const transaction = db.transaction(MEDIA_VAULT_STORE, "readwrite");
      transaction.objectStore(MEDIA_VAULT_STORE).put(record);
      await transactionDone(transaction);
      await this.prune();
    } catch {
      this.memory.set(record.id, record);
      this.pruneMemory();
    }
    return record;
  }

  async get(key: string): Promise<MediaVaultRecord | null> {
    if (!key) return null;

    const cached = this.memory.get(key);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached;
    }

    const db = await this.open();
    if (!db) {
      for (const record of this.memory.values()) {
        if (record.stanzaId === key) {
          record.lastAccess = Date.now();
          return record;
        }
      }
      return null;
    }

    try {
      const transaction = db.transaction(MEDIA_VAULT_STORE, "readonly");
      const store = transaction.objectStore(MEDIA_VAULT_STORE);
      const direct = await requestResult<MediaVaultRecord | undefined>(store.get(key));
      if (direct) {
        this.touch(direct);
        return direct;
      }
      if (!store.indexNames.contains("stanzaId")) return null;
      const byStanza = await requestResult<MediaVaultRecord | undefined>(store.index("stanzaId").get(key));
      if (byStanza) this.touch(byStanza);
      return byStanza ?? null;
    } catch {
      return null;
    }
  }

  /** Refreshes the LRU timestamp without blocking the caller. */
  private touch(record: MediaVaultRecord): void {
    record.lastAccess = Date.now();
    void this.open()
      .then((db) => {
        if (!db) return;
        const transaction = db.transaction(MEDIA_VAULT_STORE, "readwrite");
        transaction.objectStore(MEDIA_VAULT_STORE).put(record);
      })
      .catch(() => undefined);
  }

  async getByStanza(stanzaId: string): Promise<MediaVaultRecord | null> {
    if (!stanzaId) return null;
    return this.get(stanzaId);
  }

  async has(key: string): Promise<boolean> {
    if (this.memory.has(key)) return true;
    for (const record of this.memory.values()) {
      if (record.stanzaId === key) return true;
    }
    const db = await this.open();
    if (!db) return false;
    try {
      const transaction = db.transaction(MEDIA_VAULT_STORE, "readonly");
      const store = transaction.objectStore(MEDIA_VAULT_STORE);
      const count = await requestResult<number>(store.count(key));
      if (count > 0) return true;
      if (!store.indexNames.contains("stanzaId")) return false;
      const byStanza = await requestResult<number>(store.index("stanzaId").count(key));
      return byStanza > 0;
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    const db = await this.open();
    if (!db) return this.memory.size;
    try {
      const transaction = db.transaction(MEDIA_VAULT_STORE, "readonly");
      return await requestResult<number>(transaction.objectStore(MEDIA_VAULT_STORE).count());
    } catch {
      return this.memory.size;
    }
  }

  async prune(limit = this.maxEntries): Promise<number> {
    const max = Math.max(1, limit);
    const db = await this.open();
    if (!db) {
      return this.pruneMemory(max);
    }
    try {
      const countTransaction = db.transaction(MEDIA_VAULT_STORE, "readonly");
      const total = await requestResult<number>(countTransaction.objectStore(MEDIA_VAULT_STORE).count());
      if (total <= max) return 0;

      let removed = 0;
      const transaction = db.transaction(MEDIA_VAULT_STORE, "readwrite");
      const store = transaction.objectStore(MEDIA_VAULT_STORE);
      const index = store.indexNames.contains("lastAccess")
        ? store.index("lastAccess")
        : store.indexNames.contains("createdAt")
          ? store.index("createdAt")
          : null;
      const source = index ?? store;
      const request = source.openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || removed >= total - max) return;
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      await transactionDone(transaction);
      return removed;
    } catch {
      return this.pruneMemory(max);
    }
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    const db = await this.open();
    if (!db) return;
    try {
      const transaction = db.transaction(MEDIA_VAULT_STORE, "readwrite");
      transaction.objectStore(MEDIA_VAULT_STORE).delete(key);
      await transactionDone(transaction);
    } catch {
      // Deletion is best-effort; pruning still enforces the bound.
    }
  }

  async clear(): Promise<void> {
    this.memory.clear();
    const db = await this.open();
    if (!db) return;
    try {
      const transaction = db.transaction(MEDIA_VAULT_STORE, "readwrite");
      transaction.objectStore(MEDIA_VAULT_STORE).clear();
      await transactionDone(transaction);
    } catch {
      // The cache is disposable by design.
    }
  }

  close(): void {
    void this.dbPromise?.then((db) => db?.close()).catch(() => undefined);
    this.dbPromise = null;
  }

  private pruneMemory(limit = this.maxEntries): number {
    const max = Math.max(1, limit);
    if (this.memory.size <= max) return 0;
    const ordered = [...this.memory.values()].sort((left, right) => left.lastAccess - right.lastAccess);
    let removed = 0;
    for (const record of ordered) {
      if (this.memory.size <= max) break;
      this.memory.delete(record.id);
      removed += 1;
    }
    return removed;
  }
}

export function mediaVaultKeyCandidates(id: string, stanzaId: string): string[] {
  const keys = [id, stanzaId].map((value) => String(value ?? "").trim()).filter(Boolean);
  return [...new Set(keys)];
}
