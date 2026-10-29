/**
 * Maps runtime failures to plain-language, translated messages. Engine and
 * bridge errors carry stable `code`s; raw messages are English developer
 * text and are only shown as a secondary detail when no mapping exists.
 */

type Translate = (key: string, variables?: Record<string, unknown>) => string;

/** Error codes raised by the content script itself (not by the engine). */
export const CLIENT_ERROR_CODES = {
  noActiveChat: "NO_ACTIVE_CHAT",
  contextInvalidated: "CONTEXT_INVALIDATED",
} as const;

const CODE_KEYS: Record<string, string> = {
  TIMEOUT: "errors.timeout",
  UNAVAILABLE: "errors.bridgeUnavailable",
  NOT_STARTED: "errors.bridgeUnavailable",
  CONNECTION_LOST: "errors.bridgeUnavailable",
  DISPOSED: "errors.updated",
  WPP_NOT_READY: "errors.notReady",
  INVALID_PHONE: "errors.invalidPhone",
  CONTACT_NOT_FOUND: "errors.numberNotOnWhatsapp",
  INVALID_CHAT: "errors.invalidChat",
  INVALID_GROUP: "errors.invalidChat",
  INVALID_FILE: "errors.invalidFile",
  [CLIENT_ERROR_CODES.noActiveChat]: "errors.noChat",
  [CLIENT_ERROR_CODES.contextInvalidated]: "errors.updated",
};

/** Transport-level codes: the command never reached WhatsApp, so a retry is safe. */
const TRANSPORT_CODES = new Set(["UNAVAILABLE", "NOT_STARTED", "WPP_NOT_READY"]);

/** The command may or may not have run (reply lost); never retried automatically. */
const UNCERTAIN_CODES = new Set(["TIMEOUT", "CONNECTION_LOST"]);

export function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error && /extension context invalidated/i.test(error.message)) {
    return CLIENT_ERROR_CODES.contextInvalidated;
  }
  return "";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return typeof error === "string" ? error : "";
}

export function isTransportError(error: unknown): boolean {
  return TRANSPORT_CODES.has(errorCode(error));
}

export function isUncertainError(error: unknown): boolean {
  return UNCERTAIN_CODES.has(errorCode(error));
}

export function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/**
 * Returns a translated title and an optional detail. Known codes get a
 * self-explanatory title and no detail. Unknown failures fall back to the
 * generic title with the raw message, trimmed, as the detail.
 */
export function describeError(error: unknown, t: Translate): { title: string; detail: string } {
  const key = CODE_KEYS[errorCode(error)];
  if (key) return { title: t(key), detail: "" };
  return { title: t("errors.generic"), detail: errorMessage(error).slice(0, 200) };
}
