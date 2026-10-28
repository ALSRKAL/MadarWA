import type { Language } from "../types";

export type MediaKind = "image" | "video" | "ptt" | "audio" | "sticker" | "document";

const MEDIA_KINDS = new Set<string>(["image", "video", "ptt", "audio", "sticker", "document"]);

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export function normalizeMediaType(value: unknown): MediaKind | "" {
  const type = String(value ?? "").toLowerCase();
  return MEDIA_KINDS.has(type) ? (type as MediaKind) : "";
}

export function isMediaType(value: unknown): boolean {
  return normalizeMediaType(value) !== "";
}

/** WhatsApp uses a couple of aliases for voice notes depending on the build. */
export function normalizeMediaKind(type: unknown): MediaKind | "" {
  const normalized = normalizeMediaType(type);
  if (normalized) return normalized;
  const value = String(type ?? "").toLowerCase();
  if (value === "ptt" || value === "voice" || value === "audiomessage") return "ptt";
  return "";
}

/**
 * `msg.body` for media is either a complete data URL or a bare base64
 * thumbnail. The latter is useless to an <img> until the prefix is added.
 */
export function normalizeMediaPreview(raw: unknown, type: unknown, maxLength = 180_000): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value.slice(0, maxLength);
  if (value.length < 64 || value.length > maxLength * 2) return "";
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) return "";
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 64) return "";
  const mime = normalizeMediaType(type) === "sticker" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${compact}`.slice(0, maxLength);
}

export function guessMimetype(type: unknown, fallback = ""): string {
  if (fallback) return fallback;
  switch (normalizeMediaType(type)) {
    case "image":
      return "image/jpeg";
    case "sticker":
      return "image/webp";
    case "video":
      return "video/mp4";
    case "ptt":
    case "audio":
      return "audio/ogg";
    case "document":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

export function extensionForMimetype(mimetype: string, fallback = "bin"): string {
  const value = mimetype.toLowerCase();
  if (value.includes("jpeg")) return "jpg";
  if (value.includes("png")) return "png";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("mp4")) return "mp4";
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  if (value.includes("ogg")) return "ogg";
  if (value.includes("mpeg")) return "mp3";
  if (value.includes("wav")) return "wav";
  if (value.includes("pdf")) return "pdf";
  return fallback;
}

export function formatBytes(bytes: number, language: Language): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const locale = language === "ar" ? "ar-EG" : "en-GB";
  if (value < 1024) return `${Math.round(value)} ${language === "ar" ? "بايت" : "B"}`;
  const units = language === "ar" ? ["كيلوبايت", "ميجابايت", "جيجابايت"] : ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    numberingSystem: "latn",
    maximumFractionDigits: size >= 10 ? 0 : 1,
  }).format(size);
  return `${formatted} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return new Blob([dataUrl]);
  const mimetype = match[1] || "application/octet-stream";
  const payload = match[3] ?? "";
  if (!match[2]) return new Blob([decodeURIComponent(payload)], { type: mimetype });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimetype });
}

export type HeavyMediaMetadata = {
  duration: number;
  width: number;
  height: number;
};

/**
 * Reads intrinsic media metadata off a blob. Every probe is best-effort and
 * bounded so a corrupt media file can never stall the capture queue.
 */
export async function inspectMediaBlob(blob: Blob, kind: MediaKind, timeoutMs = 2000): Promise<HeavyMediaMetadata> {
  const empty: HeavyMediaMetadata = { duration: 0, width: 0, height: 0 };
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return empty;

  const url = URL.createObjectURL(blob);
  try {
    if (kind === "image" || kind === "sticker") {
      return await withTimeout(
        new Promise<HeavyMediaMetadata>((resolve) => {
          const image = new Image();
          image.onload = () => resolve({ duration: 0, width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => resolve(empty);
          image.src = url;
        }),
        timeoutMs,
        empty,
      );
    }

    if (kind === "video" || kind === "audio" || kind === "ptt") {
      const element = document.createElement(kind === "video" ? "video" : "audio");
      element.preload = "metadata";
      element.muted = true;
      return await withTimeout(
        new Promise<HeavyMediaMetadata>((resolve) => {
          const finish = (metadata: HeavyMediaMetadata) => {
            element.removeAttribute("src");
            element.load();
            resolve(metadata);
          };
          element.onloadedmetadata = () => {
            const video = element as HTMLVideoElement;
            finish({
              duration: Number.isFinite(element.duration) ? element.duration : 0,
              width: Number(video.videoWidth ?? 0),
              height: Number(video.videoHeight ?? 0),
            });
          };
          element.onerror = () => finish(empty);
          element.src = url;
        }),
        timeoutMs,
        empty,
      );
    }

    return empty;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);
    void promise.then((value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    });
  });
}
