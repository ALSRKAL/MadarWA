/**
 * Cascading revoke-key resolution.
 *
 * WhatsApp's revoke event can expose the original key on `beforeMsg`, on
 * `afterMsg.protocolMessageKey`, on `afterMsg.refId` (wa-js event) or on the
 * revoked store model itself, depending on the Web build. The store index keeps
 * both the full serialized id and the bare stanza id, so every path converges
 * on one snapshot.
 */

export interface RevokeKeyInput {
  beforeFull?: string;
  beforeStanza?: string;
  protocolFull?: string;
  protocolStanza?: string;
  afterFull?: string;
  afterStanza?: string;
  refFull?: string;
  refStanza?: string;
}

export interface RevokeKeyCandidates {
  fullIds: string[];
  stanzaIds: string[];
  primary: string;
}

/**
 * The stanza id of a serialized message key. WhatsApp serializes keys as
 * `fromMe_chat_stanza`, and group messages from someone else add the author
 * as a fourth part (`false_<group>@g.us_<stanza>_<participant>`), so the
 * stanza is the third part, not the last one. Stanzas and JIDs never contain
 * "_". A bare stanza is returned as is.
 */
export function extractStanzaId(serialized: string): string {
  const value = String(serialized ?? "");
  if (!value) return "";
  const parts = value.split("_");
  if (parts.length >= 3 && (parts[0] === "true" || parts[0] === "false")) return parts[2] || value;
  if (parts.length > 1) return parts[parts.length - 1] || value;
  return value;
}

function pushUnique(target: string[], value: string | undefined): void {
  const trimmed = String(value ?? "").trim();
  if (trimmed && !target.includes(trimmed)) target.push(trimmed);
}

export function resolveRevokeCandidates(input: RevokeKeyInput): RevokeKeyCandidates {
  const fullIds: string[] = [];
  const stanzaIds: string[] = [];

  pushUnique(fullIds, input.beforeFull);
  pushUnique(fullIds, input.protocolFull);
  pushUnique(fullIds, input.afterFull);
  pushUnique(fullIds, input.refFull);

  pushUnique(stanzaIds, input.beforeStanza);
  pushUnique(stanzaIds, input.protocolStanza);
  pushUnique(stanzaIds, input.afterStanza);
  pushUnique(stanzaIds, input.refStanza);

  for (const full of [...fullIds]) {
    pushUnique(stanzaIds, extractStanzaId(full));
  }

  return {
    fullIds,
    stanzaIds: stanzaIds.filter((id) => !fullIds.includes(id)),
    primary: fullIds[0] ?? stanzaIds[0] ?? "",
  };
}

export function findSnapshotByCandidates<T>(index: Map<string, T>, candidates: RevokeKeyCandidates): T | undefined {
  for (const id of candidates.fullIds) {
    const found = index.get(id);
    if (found) return found;
  }
  for (const id of candidates.stanzaIds) {
    const found = index.get(id);
    if (found) return found;
  }
  return undefined;
}
