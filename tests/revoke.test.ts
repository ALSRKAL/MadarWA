import { describe, expect, it } from "vitest";
import {
  extractStanzaId,
  findSnapshotByCandidates,
  resolveRevokeCandidates,
} from "../src/shared/utils/revoke";

const full = "false_966501234567@c.us_3EB0ABCDEF01";
const stanza = "3EB0ABCDEF01";

describe("revoke key extraction", () => {
  it("extracts the stanza id from a serialized message key", () => {
    expect(extractStanzaId(full)).toBe(stanza);
    expect(extractStanzaId("true_120363000000000000@g.us_ABC123")).toBe("ABC123");
  });

  it("keeps a bare stanza id intact", () => {
    expect(extractStanzaId(stanza)).toBe(stanza);
    expect(extractStanzaId("")).toBe("");
  });
});

describe("cascading revoke resolver", () => {
  it("prefers beforeMsg, then protocolMessageKey, then afterMsg, then refId", () => {
    const candidates = resolveRevokeCandidates({
      beforeFull: "false_c@c.us_BEFORE",
      beforeStanza: "BEFORE",
      protocolFull: "false_c@c.us_PROTOCOL",
      protocolStanza: "PROTOCOL",
      afterFull: "false_c@c.us_AFTER",
      afterStanza: "AFTER",
      refFull: "false_c@c.us_REF",
      refStanza: "REF",
    });

    expect(candidates.fullIds).toEqual([
      "false_c@c.us_BEFORE",
      "false_c@c.us_PROTOCOL",
      "false_c@c.us_AFTER",
      "false_c@c.us_REF",
    ]);
    expect(candidates.primary).toBe("false_c@c.us_BEFORE");
  });

  it("falls back to stanza-only identifiers when no full key is present", () => {
    const candidates = resolveRevokeCandidates({
      protocolStanza: stanza,
      afterStanza: "OTHER",
    });
    expect(candidates.primary).toBe(stanza);
    expect(candidates.stanzaIds).toEqual([stanza, "OTHER"]);
  });

  it("deduplicates keys extracted from full ids", () => {
    const candidates = resolveRevokeCandidates({
      beforeFull: full,
      protocolFull: full,
      refStanza: stanza,
    });
    expect(candidates.fullIds).toEqual([full]);
    expect(candidates.stanzaIds).toEqual([stanza]);
  });

  it("finds a snapshot by full id before falling back to stanza", () => {
    const byFull = new Map<string, { text: string }>([[full, { text: "full" }]]);
    expect(findSnapshotByCandidates(byFull, resolveRevokeCandidates({ beforeFull: full }))?.text).toBe("full");

    const byStanza = new Map<string, { text: string }>([[stanza, { text: "stanza" }]]);
    expect(findSnapshotByCandidates(byStanza, resolveRevokeCandidates({ refStanza: stanza }))?.text).toBe("stanza");
  });
});
