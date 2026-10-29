import { describe, expect, it } from "vitest";
import { asTimestamp, mergeDeletion, sameDeletion } from "../src/shared/storage";
import type { DeletedMessage } from "../src/shared/types";

const placeholder: DeletedMessage = {
  id: "false_204857193846012@lid_ACA72FD67E385C8C",
  stanzaId: "ACA72FD67E385C8C",
  chatId: "204857193846012@lid",
  chatName: "Chat",
  sender: "",
  senderName: "",
  text: "",
  messageType: "",
  previewDataUrl: "",
  timestamp: 1_793_250_000_000,
  isGroup: false,
  revokedAt: 1_793_250_000_000,
  revokedBy: "",
  revokeType: "sender",
  recoveredFromCache: false,
};

describe("deletions reported again after a reload", () => {
  it("recognises the same deletion by id or by stanza, but never by a JID", () => {
    expect(sameDeletion(placeholder, { ...placeholder })).toBe(true);
    expect(sameDeletion(placeholder, { ...placeholder, id: "false_other@lid_ACA72FD67E385C8C" })).toBe(true);
    expect(sameDeletion(placeholder, { ...placeholder, id: "x", stanzaId: "OTHER" })).toBe(false);
    const jid = { ...placeholder, id: "a", stanzaId: "966501234567@c.us" };
    expect(sameDeletion(jid, { ...jid, id: "b" })).toBe(false);
  });

  it("keeps the first record when there is nothing new", () => {
    const withRevoke = { ...placeholder, revokeMessageId: "false_204857193846012@lid_REVOKE1" };
    expect(mergeDeletion(withRevoke, { ...withRevoke, revokedAt: Date.now() })).toBe(withRevoke);
  });

  it("adds a missing revoke id and corrects the time of a deletion whose text never arrived", () => {
    const sentAt = placeholder.timestamp - 30 * 60 * 60_000;
    const merged = mergeDeletion(placeholder, {
      ...placeholder,
      revokeMessageId: "false_204857193846012@lid_REVOKE1",
      timestamp: sentAt,
    });
    expect(merged.revokeMessageId).toBe("false_204857193846012@lid_REVOKE1");
    expect(merged.timestamp).toBe(sentAt);
    expect(merged.revokedAt).toBe(placeholder.revokedAt);
  });

  it("fills in content found later without overwriting saved content", () => {
    const upgraded = mergeDeletion(placeholder, { ...placeholder, text: "hello", messageType: "chat", recoveredFromCache: true });
    expect(upgraded.text).toBe("hello");
    expect(upgraded.recoveredFromCache).toBe(true);

    const saved = { ...placeholder, text: "original", recoveredFromCache: true };
    expect(mergeDeletion(saved, { ...saved, text: "" }).text).toBe("original");
  });

  it("reads stored times defensively", () => {
    expect(asTimestamp(1_793_250_000_000)).toBe(1_793_250_000_000);
    expect(asTimestamp("123")).toBe(0);
    expect(asTimestamp(-5)).toBe(0);
    expect(asTimestamp(Number.NaN)).toBe(0);
  });
});
