// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InlineRestorer } from "../src/content/inline-restore";
import { initI18n } from "../src/shared/i18n";
import type { DeletedMessage, Language } from "../src/shared/types";

const full = "false_966501234567@c.us_STANZA123";
const entry: DeletedMessage = {
  id: full,
  stanzaId: "STANZA123",
  chatId: "966501234567@c.us",
  chatName: "Test Chat",
  sender: "966501234567",
  senderName: "Ahmed",
  text: "النص الأصلي قبل الحذف",
  messageType: "chat",
  timestamp: 1_700_000_000_000,
  isGroup: false,
  revokedAt: 1_700_000_060_000,
  revokedBy: "966501234567",
  revokeType: "revoke",
  recoveredFromCache: true,
};

let language: Language = "ar";

function mountRow(dataId = full, withBubble = true): HTMLElement {
  document.body.innerHTML = `<div id="main"><div data-id="${dataId}">${
    withBubble
      ? '<div data-testid="msg-container"><div class="copyable-text"><span>تم حذف هذه الرسالة</span></div></div>'
      : '<span>تم حذف هذه الرسالة</span>'
  }</div></div>`;
  const row = document.querySelector<HTMLElement>(`#main [data-id="${dataId}"]`);
  if (!row) throw new Error("row not mounted");
  return row;
}

beforeEach(() => {
  language = "ar";
  initI18n("ar");
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("inline restored message", () => {
  it("injects the original text, sender and timestamp into the WhatsApp row", () => {
    const restorer = new InlineRestorer({ getLanguage: () => language });
    mountRow();
    restorer.setEnabled(true);
    restorer.setRecords([entry]);
    restorer.scan();

    const block = document.querySelector<HTMLElement>("[data-madarwa-inline-restore]");
    expect(block).not.toBeNull();
    expect(block?.getAttribute("dir")).toBe("rtl");
    expect(block?.textContent).toContain("رسالة محذوفة مستعادة");
    expect(block?.textContent).toContain(entry.text);
    expect(block?.textContent).toContain("Ahmed");
    expect(document.querySelector("#main [data-madarwa-restored-id]")).not.toBeNull();
    restorer.dispose();
  });

  it("is idempotent across repeated scans", () => {
    const restorer = new InlineRestorer({ getLanguage: () => language });
    mountRow();
    restorer.setRecords([entry]);
    restorer.scan();
    restorer.scan();
    expect(document.querySelectorAll("[data-madarwa-inline-restore]")).toHaveLength(1);
    restorer.dispose();
  });

  it("matches the revoke message row when WhatsApp replaces the original data-id", () => {
    const revokeId = "false_966501234567@c.us_REVOKE999";
    const restorer = new InlineRestorer({ getLanguage: () => language });
    mountRow(revokeId);
    restorer.restoreForRevoke(entry, revokeId);

    const block = document.querySelector("[data-madarwa-inline-restore]");
    expect(block?.textContent).toContain(entry.text);
    restorer.dispose();
  });

  it("renders in English LTR after a language change", () => {
    const restorer = new InlineRestorer({ getLanguage: () => language });
    mountRow();
    restorer.setRecords([entry]);
    restorer.scan();
    language = "en";
    restorer.setLanguage("en");

    const block = document.querySelector<HTMLElement>("[data-madarwa-inline-restore]");
    expect(block?.getAttribute("dir")).toBe("ltr");
    expect(block?.textContent).toContain("Restored deleted message");
    expect(block?.textContent).toContain("View in vault");
    restorer.dispose();
  });

  it("renders a restored media preview without dumping base64 into the text", () => {
    const restorer = new InlineRestorer({ getLanguage: () => language });
    mountRow();
    restorer.setRecords([
      {
        ...entry,
        text: "",
        messageType: "image",
        previewDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    ]);
    restorer.scan();

    expect(document.querySelector("img.madarwa-inline-preview")).not.toBeNull();
    expect(document.querySelector("[data-madarwa-inline-restore]")?.textContent).not.toContain("iVBORw0KGgo");
    restorer.dispose();
  });

  it("removes injected blocks when disabled", () => {
    const restorer = new InlineRestorer({ getLanguage: () => language });
    mountRow();
    restorer.setRecords([entry]);
    restorer.scan();
    expect(document.querySelector("[data-madarwa-inline-restore]")).not.toBeNull();

    restorer.setEnabled(false);
    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    expect(document.querySelector("[data-madarwa-restored-id]")).toBeNull();
    restorer.dispose();
  });

  it("still works when the row has no msg-container wrapper", () => {
    const restorer = new InlineRestorer({ getLanguage: () => language });
    mountRow(full, false);
    restorer.setRecords([entry]);
    restorer.scan();
    expect(document.querySelector("[data-madarwa-inline-restore]")?.textContent).toContain(entry.text);
    restorer.dispose();
  });
});
