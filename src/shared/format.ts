import type { Language } from "./types";

const localeFor = (language: Language): string => (language === "ar" ? "ar-EG" : "en-GB");

export function formatDateTime(timestamp: number, language: Language): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  try {
    return new Intl.DateTimeFormat(localeFor(language), {
      dateStyle: "medium",
      timeStyle: "short",
      calendar: "gregory",
      numberingSystem: "latn",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

export function formatTime(timestamp: number, language: Language): string {
  try {
    return new Intl.DateTimeFormat(localeFor(language), {
      timeStyle: "short",
      numberingSystem: "latn",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

export function formatNumber(value: number, language: Language): string {
  try {
    return new Intl.NumberFormat(language === "ar" ? "ar-EG" : "en-GB", {
      numberingSystem: "latn",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

export function timeAgo(timestamp: number, language: Language): string {
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / 60_000);
  const formatter = new Intl.RelativeTimeFormat(localeFor(language), { numeric: "auto" });
  if (minutes < 1) return formatter.format(0, "second");
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  return formatter.format(-days, "day");
}

export function truncate(text: string, max = 90): string {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function uid(prefix = "id"): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36)}-${[...random].map((value) => value.toString(36)).join("")}`;
}
