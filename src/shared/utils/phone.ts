/**
 * Phone normalisation for WhatsApp JIDs.
 *
 * WhatsApp expects an international number in the form `countrycode_number@c.us`.
 * The user may paste anything: spaces, dashes, parentheses, a leading `+`,
 * `00` international prefix, Arabic-Indic digits or a local leading zero.
 */

const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/g;

export interface SanitizedPhone {
  digits: string;
  chatId: string;
  valid: boolean;
  reason: string;
}

export function toLatinDigits(input: string): string {
  return String(input ?? "").replace(ARABIC_INDIC, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Normalises an international phone number.
 * @param raw user input
 * @param defaultCountryCode optional country code (digits only, e.g. "966")
 */
export function sanitizePhone(raw: string, defaultCountryCode = ""): SanitizedPhone {
  const country = (defaultCountryCode || "").replace(/\D/g, "");
  let text = toLatinDigits(String(raw ?? "")).trim();
  const invalid = (reason: string): SanitizedPhone => ({ digits: "", chatId: "", valid: false, reason });

  if (!text) return invalid("empty");
  if (/@g\.us$/i.test(text)) return invalid("group-id");
  if (/@(broadcast|newsletter|status)/i.test(text)) return invalid("unsupported-jid");

  // Keep an explicit international marker before stripping punctuation.
  const hadPlus = text.startsWith("+");
  const hadDoubleZero = /^00\d/.test(text.replace(/[\s\-().]/g, ""));
  text = text.replace(/@c\.us$/i, "");

  let digits = text.replace(/\D/g, "");
  if (!digits) return invalid("no-digits");

  if (!hadPlus && hadDoubleZero) digits = digits.slice(2);

  if (country) {
    if (digits.startsWith(country)) {
      const rest = digits.slice(country.length);
      if (rest.startsWith("0")) digits = country + rest.replace(/^0+/, "");
    } else if (digits.startsWith("0")) {
      digits = country + digits.replace(/^0+/, "");
    } else if (!hadPlus && digits.length <= 10) {
      digits = country + digits;
    }
  } else if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  if (digits.length < 7) return invalid("too-short");
  if (digits.length > 15) return invalid("too-long");
  if (/^0+$/.test(digits)) return invalid("invalid");

  return {
    digits,
    chatId: `${digits}@c.us`,
    valid: true,
    reason: "",
  };
}

export function toChatId(raw: string, defaultCountryCode = ""): string {
  const result = sanitizePhone(raw, defaultCountryCode);
  return result.valid ? result.chatId : "";
}

export function phoneFromChatId(chatId: string): string {
  return String(chatId ?? "").replace(/@.*$/, "").replace(/\D/g, "");
}

export function isGroupChatId(chatId: string): boolean {
  return /@g\.us$/i.test(String(chatId ?? ""));
}

export function isUserChatId(chatId: string): boolean {
  return /@(c\.us|lid)$/i.test(String(chatId ?? ""));
}

export function isNewsletterChatId(chatId: string): boolean {
  return /@newsletter$/i.test(String(chatId ?? ""));
}

export function normalizeChatId(raw: string, defaultCountryCode = ""): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (/@(g\.us|c\.us|newsletter|broadcast|lid)$/i.test(text)) {
    return text.toLowerCase();
  }
  return toChatId(text, defaultCountryCode);
}

export function formatPhone(digits: string): string {
  const clean = String(digits ?? "").replace(/\D/g, "");
  if (!clean) return "";
  return `+${clean}`;
}

/** Deterministic 32-bit FNV-1a hash, used for dedupe buckets and spintax seeds. */
export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
