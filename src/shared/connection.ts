import type { EngineInfo } from "./types";

/**
 * One connection model for every surface (panel header, native launcher,
 * popup). Each phase maps to exactly one label, one hint and one dot tone,
 * so the same state always reads the same way everywhere.
 */
export type ConnectionPhase =
  /** Extension reloaded/updated while this tab stayed open; only a page reload helps. */
  | "updated"
  /** Popup only: no WhatsApp Web tab is open. */
  | "absent"
  /** Popup only: a WhatsApp tab exists but MadarWA is not running in it. */
  | "unreachable"
  /** First connection to the page engine has not completed yet. */
  | "connecting"
  /** Was connected, the engine stopped answering; recovery is automatic. */
  | "reconnecting"
  /** Engine connected, WhatsApp Web is still booting. */
  | "loading"
  /** WhatsApp Web has been booting for an unusually long time. */
  | "slow"
  /** WhatsApp Web is loaded but no account is linked (QR screen). */
  | "login"
  /** Fully operational. */
  | "live";

export type ConnectionTone = "live" | "waiting" | "offline";

export interface ConnectionInput {
  bridgeConnected: boolean;
  engine: Pick<EngineInfo, "ready" | "connected"> & { slow?: boolean };
  orphaned?: boolean;
  everConnected?: boolean;
}

export function connectionPhase(input: ConnectionInput): ConnectionPhase {
  if (input.orphaned) return "updated";
  if (!input.bridgeConnected) return input.everConnected ? "reconnecting" : "connecting";
  if (!input.engine.ready) return input.engine.slow ? "slow" : "loading";
  if (!input.engine.connected) return "login";
  return "live";
}

const TONES: Record<ConnectionPhase, ConnectionTone> = {
  updated: "offline",
  absent: "offline",
  unreachable: "offline",
  connecting: "waiting",
  reconnecting: "waiting",
  loading: "waiting",
  slow: "waiting",
  login: "waiting",
  live: "live",
};

export function connectionTone(phase: ConnectionPhase): ConnectionTone {
  return TONES[phase];
}

/** Phases a page reload fixes, and that therefore show a reload action. */
export function connectionNeedsReload(phase: ConnectionPhase): boolean {
  return phase === "updated" || phase === "slow" || phase === "unreachable";
}

export function connectionLabelKey(phase: ConnectionPhase): string {
  return `connection.${phase}`;
}

export function connectionHintKey(phase: ConnectionPhase): string {
  return `connection.hint.${phase}`;
}
