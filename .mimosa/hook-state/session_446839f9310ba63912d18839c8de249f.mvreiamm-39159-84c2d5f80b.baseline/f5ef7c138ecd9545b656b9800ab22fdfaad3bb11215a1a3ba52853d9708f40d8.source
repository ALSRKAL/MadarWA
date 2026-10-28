import { BRIDGE } from "../constants";
import { timingSafeEqual } from "../utils/security";

/**
 * The ISOLATED and MAIN worlds share the DOM, therefore window CustomEvents
 * are the transport. String-only details are used so no cross-realm object
 * leaks between worlds. Payloads are keyed-obfuscated with an ephemeral
 * per-page session key and authenticated with a keyed checksum. This is a
 * transport hardening layer, not secrecy from page JavaScript: MAIN-world
 * code is page code and can always observe its own traffic.
 */

export const BRIDGE_NS = BRIDGE.namespace;
export const BRIDGE_VERSION = BRIDGE.version;

export type EnvelopeKind = "req" | "res" | "evt";

export interface Envelope {
  v: number;
  ns: string;
  sid: string;
  seq: number;
  k: EnvelopeKind;
  b: string;
  tag: string;
}

export interface Handshake {
  v: number;
  ns: string;
  sid: string;
  key: string;
  ts: number;
  origin: string;
}

export interface EngineReadyMessage {
  v: number;
  ns: string;
  sid: string;
  ready: boolean;
  wppVersion: string;
  me: string;
}

export class BridgeProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeProtocolError";
    this.code = code;
  }
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function keystream(key: string, sid: string, seq: number, kind: string, length: number): Uint8Array {
  let state = fnv1a(`${key}|${sid}|${seq}|${kind}`) || 0x9e3779b9;
  const output = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    state ^= (state << 13) >>> 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    state >>>= 0;
    output[i] = state & 0xff;
  }
  return output;
}

function xor(bytes: Uint8Array, stream: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    output[i] = (bytes[i] ?? 0) ^ (stream[i] ?? 0);
  }
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function computeTag(key: string, sid: string, seq: number, kind: string, body: string): string {
  return fnv1a(`${key}|${sid}|${seq}|${kind}|${body}`).toString(16).padStart(8, "0");
}

export function encodeEnvelope(
  key: string,
  sid: string,
  seq: number,
  kind: EnvelopeKind,
  payload: unknown,
): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const encrypted = xor(bytes, keystream(key, sid, seq, kind, bytes.length));
  const body = bytesToBase64(encrypted);
  const envelope: Envelope = {
    v: BRIDGE_VERSION,
    ns: BRIDGE_NS,
    sid,
    seq,
    k: kind,
    b: body,
    tag: computeTag(key, sid, seq, kind, body),
  };
  return JSON.stringify(envelope);
}

export function decodeEnvelope(key: string, sid: string, raw: unknown): { seq: number; kind: EnvelopeKind; payload: unknown } {
  if (typeof raw !== "string") throw new BridgeProtocolError("MALFORMED", "Envelope is not a string");
  if (raw.length > BRIDGE.maxEnvelopeBytes) throw new BridgeProtocolError("TOO_LARGE", "Envelope exceeds size limit");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BridgeProtocolError("MALFORMED", "Envelope is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new BridgeProtocolError("MALFORMED", "Envelope shape invalid");
  const envelope = parsed as Partial<Envelope>;

  if (envelope.v !== BRIDGE_VERSION || envelope.ns !== BRIDGE_NS) {
    throw new BridgeProtocolError("VERSION", "Envelope version/namespace mismatch");
  }
  if (envelope.sid !== sid) throw new BridgeProtocolError("SESSION", "Envelope session mismatch");
  if (typeof envelope.seq !== "number" || !Number.isInteger(envelope.seq) || envelope.seq < 1) {
    throw new BridgeProtocolError("MALFORMED", "Envelope sequence invalid");
  }
  if (envelope.k !== "req" && envelope.k !== "res" && envelope.k !== "evt") {
    throw new BridgeProtocolError("MALFORMED", "Envelope kind invalid");
  }
  if (typeof envelope.b !== "string" || typeof envelope.tag !== "string") {
    throw new BridgeProtocolError("MALFORMED", "Envelope body/tag missing");
  }

  const expected = computeTag(key, sid, envelope.seq, envelope.k, envelope.b);
  if (!timingSafeEqual(expected, envelope.tag)) {
    throw new BridgeProtocolError("AUTH", "Envelope authentication failed");
  }

  let encrypted: Uint8Array;
  try {
    encrypted = base64ToBytes(envelope.b);
  } catch {
    throw new BridgeProtocolError("MALFORMED", "Envelope body is not base64");
  }

  const decrypted = xor(encrypted, keystream(key, sid, envelope.seq, envelope.k, encrypted.length));

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    throw new BridgeProtocolError("MALFORMED", "Envelope payload is not JSON");
  }

  return { seq: envelope.seq, kind: envelope.k, payload };
}

export function randomToken(bytes = 16): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isHandshake(value: unknown, expectedOrigin: string, now = Date.now()): value is Handshake {
  if (typeof value !== "object" || value === null) return false;
  const handshake = value as Partial<Handshake>;
  return (
    handshake.v === BRIDGE_VERSION &&
    handshake.ns === BRIDGE_NS &&
    typeof handshake.sid === "string" &&
    /^[a-f0-9]{16,80}$/i.test(handshake.sid) &&
    typeof handshake.key === "string" &&
    /^[a-f0-9]{32,128}$/i.test(handshake.key) &&
    typeof handshake.ts === "number" &&
    Math.abs(now - handshake.ts) < 5 * 60_000 &&
    handshake.origin === expectedOrigin
  );
}

export interface RequestPayload {
  reqId: string;
  cmd: string;
  params: unknown;
  ts: number;
}

export interface ResponsePayload {
  reqId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export function isRequestPayload(value: unknown): value is RequestPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<RequestPayload>;
  return (
    typeof payload.reqId === "string" &&
    payload.reqId.length > 0 &&
    payload.reqId.length <= 80 &&
    typeof payload.cmd === "string" &&
    payload.cmd.length > 0 &&
    payload.cmd.length <= 120 &&
    typeof payload.ts === "number"
  );
}

export function isResponsePayload(value: unknown): value is ResponsePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<ResponsePayload>;
  return typeof payload.reqId === "string" && typeof payload.ok === "boolean";
}

export function isEventPayload(value: unknown): value is { event: string; data: unknown; ts: number } {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as { event?: unknown; ts?: unknown };
  return typeof payload.event === "string" && payload.event.length <= 120 && typeof payload.ts === "number";
}
