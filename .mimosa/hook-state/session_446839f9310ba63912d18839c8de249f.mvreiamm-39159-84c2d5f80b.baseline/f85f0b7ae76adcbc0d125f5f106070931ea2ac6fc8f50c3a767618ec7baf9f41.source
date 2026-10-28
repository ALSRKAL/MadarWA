import { timingSafeEqual } from "./security";

export interface PinRecord {
  hash: string;
  salt: string;
}

export interface PinValidation {
  valid: boolean;
  reason: string;
}

const PIN_ITERATIONS = 120_000;

export function validatePinFormat(pin: string): PinValidation {
  const value = String(pin ?? "");
  if (!/^\d{4,8}$/.test(value)) {
    return { valid: false, reason: "PIN must be 4 to 8 digits" };
  }
  if (/^(\d)\1+$/.test(value)) {
    return { valid: false, reason: "PIN is too weak" };
  }
  return { valid: true, reason: "" };
}

export function randomHex(bytes = 16): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const output = new Uint8Array(clean.length / 2);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derive(pin: string, saltHex: string, iterations: number): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable in this context");
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex) as unknown as BufferSource,
      iterations,
    },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** PBKDF2-SHA256 PIN hash. The plaintext PIN is never persisted. */
export async function createPinRecord(pin: string, iterations = PIN_ITERATIONS): Promise<PinRecord> {
  const validation = validatePinFormat(pin);
  if (!validation.valid) throw new Error(validation.reason);
  const salt = randomHex(16);
  const hash = await derive(pin, salt, iterations);
  return { hash, salt };
}

export async function verifyPin(pin: string, record: PinRecord, iterations = PIN_ITERATIONS): Promise<boolean> {
  if (!record.hash || !record.salt) return false;
  if (!/^\d{4,8}$/.test(String(pin ?? ""))) return false;
  const candidate = await derive(pin, record.salt, iterations);
  return timingSafeEqual(candidate, record.hash);
}
