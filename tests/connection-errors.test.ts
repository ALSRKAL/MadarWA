import { describe, expect, it } from "vitest";
import { BridgeProtocolError } from "../src/shared/bridge/protocol";
import {
  connectionHintKey,
  connectionLabelKey,
  connectionNeedsReload,
  connectionPhase,
  connectionTone,
  type ConnectionPhase,
} from "../src/shared/connection";
import {
  CLIENT_ERROR_CODES,
  codedError,
  describeError,
  errorCode,
  isTransportError,
  isUncertainError,
} from "../src/shared/errors";
import { tFor } from "../src/shared/i18n";

const engine = (ready: boolean, connected: boolean, slow = false) => ({ ready, connected, slow });

const PHASES: ConnectionPhase[] = [
  "updated",
  "absent",
  "unreachable",
  "connecting",
  "reconnecting",
  "loading",
  "slow",
  "login",
  "live",
];

describe("connection model", () => {
  it("derives exactly one phase per runtime state, in priority order", () => {
    expect(connectionPhase({ bridgeConnected: true, engine: engine(true, true), orphaned: true })).toBe("updated");
    expect(connectionPhase({ bridgeConnected: false, engine: engine(false, false) })).toBe("connecting");
    expect(
      connectionPhase({ bridgeConnected: false, engine: engine(true, true), everConnected: true }),
    ).toBe("reconnecting");
    expect(connectionPhase({ bridgeConnected: true, engine: engine(false, false) })).toBe("loading");
    expect(connectionPhase({ bridgeConnected: true, engine: engine(false, false, true) })).toBe("slow");
    expect(connectionPhase({ bridgeConnected: true, engine: engine(true, false) })).toBe("login");
    expect(connectionPhase({ bridgeConnected: true, engine: engine(true, true) })).toBe("live");
  });

  it("gives every phase a translated label and hint in Arabic and English", () => {
    for (const language of ["ar", "en"] as const) {
      const t = tFor(language);
      for (const phase of PHASES) {
        expect(t(connectionLabelKey(phase)), `${language} label ${phase}`).not.toBe(connectionLabelKey(phase));
        expect(t(connectionHintKey(phase)), `${language} hint ${phase}`).not.toBe(connectionHintKey(phase));
      }
    }
  });

  it("uses color only for real state and offers reload only where it helps", () => {
    expect(connectionTone("live")).toBe("live");
    expect(connectionTone("login")).toBe("waiting");
    expect(connectionTone("reconnecting")).toBe("waiting");
    expect(connectionTone("updated")).toBe("offline");
    expect(connectionNeedsReload("updated")).toBe(true);
    expect(connectionNeedsReload("slow")).toBe(true);
    expect(connectionNeedsReload("unreachable")).toBe(true);
    expect(connectionNeedsReload("reconnecting")).toBe(false);
    expect(connectionNeedsReload("live")).toBe(false);
  });
});

describe("error mapping", () => {
  const t = tFor("en");

  it("turns engine and bridge codes into plain messages without raw developer text", () => {
    expect(describeError(new BridgeProtocolError("TIMEOUT", "Command timed out: exporter.groups"), t)).toEqual({
      title: t("errors.timeout"),
      detail: "",
    });
    expect(describeError({ code: "CONTACT_NOT_FOUND", message: "not registered" }, t).title).toBe(
      t("errors.numberNotOnWhatsapp"),
    );
    expect(describeError(codedError(CLIENT_ERROR_CODES.noActiveChat, "no chat"), t).title).toBe(t("errors.noChat"));
    expect(describeError(new Error("Extension context invalidated."), t).title).toBe(t("errors.updated"));
  });

  it("falls back to the generic title with a trimmed raw detail", () => {
    const result = describeError(new Error("x".repeat(500)), t);
    expect(result.title).toBe(t("errors.generic"));
    expect(result.detail).toHaveLength(200);
  });

  it("separates safe-to-retry transport failures from uncertain ones", () => {
    expect(isTransportError({ code: "UNAVAILABLE" })).toBe(true);
    expect(isTransportError({ code: "WPP_NOT_READY" })).toBe(true);
    expect(isTransportError({ code: "TIMEOUT" })).toBe(false);
    expect(isUncertainError({ code: "TIMEOUT" })).toBe(true);
    expect(isUncertainError({ code: "CONNECTION_LOST" })).toBe(true);
    expect(isUncertainError({ code: "CONTACT_NOT_FOUND" })).toBe(false);
    expect(errorCode("plain string")).toBe("");
  });
});
