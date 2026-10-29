// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineRestorer, type InlineRestorerOptions } from "../src/content/inline-restore";
import { initI18n } from "../src/shared/i18n";
import { MediaVaultCache } from "../src/shared/media-vault";
import type { DeletedMessage, InlineRestoreMode, Language } from "../src/shared/types";

const full = "false_966501234567@c.us_STANZA123";
const base: DeletedMessage = {
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
let mode: InlineRestoreMode = "interactive";
let objectUrlCounter = 0;

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      objectUrlCounter += 1;
      return `blob:madarwa-${objectUrlCounter}`;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  if (typeof window.requestAnimationFrame !== "function") {
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
    });
  }
});

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

function restorer(
  mediaVault = new MediaVaultCache({ factory: null }),
  options: Partial<InlineRestorerOptions> = {},
): InlineRestorer {
  return new InlineRestorer({ getLanguage: () => language, getMode: () => mode, mediaVault, ...options });
}

const DELETED_ROW = `<div data-testid="msg-container"><div><span>This message was deleted</span></div></div>`;

function revokedRow(revokeStanza: string, originalFull: string, timestamp = base.timestamp) {
  return {
    revokeFull: `false_966501234567@c.us_${revokeStanza}`,
    revokeStanza,
    originalFull,
    originalStanza: originalFull.split("_")[2] ?? "",
    chatId: base.chatId,
    timestamp,
  };
}

function note(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-madarwa-inline-missing]");
}

const settle = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

function block(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[data-madarwa-inline-restore]");
  if (!node) throw new Error("inline block missing");
  return node;
}

function pill(): HTMLButtonElement {
  const node = block().querySelector<HTMLButtonElement>(".madarwa-inline-pill");
  if (!node) throw new Error("pill missing");
  return node;
}

beforeEach(() => {
  language = "ar";
  mode = "interactive";
  initI18n("ar");
  document.body.innerHTML = "";
});

afterEach(() => {
  document.querySelectorAll(".madarwa-lightbox").forEach((node) => node.remove());
  document.body.innerHTML = "";
});

describe("interactive inline restored message", () => {
  it("keeps the native deleted text and renders a collapsed reveal pill", () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.scan();

    expect(block().getAttribute("dir")).toBe("rtl");
    expect(block().getAttribute("data-expanded")).toBe("0");
    expect(pill().getAttribute("aria-expanded")).toBe("false");
    expect(block().querySelector(".madarwa-inline-kind")?.textContent).toBe("نص");
    expect(block().querySelector(".madarwa-inline-pill-label")?.textContent).toBe("كشف الرسالة المحذوفة");
    // Content is built lazily, so the deleted text is not in the DOM yet.
    expect(block().textContent).not.toContain(base.text);
    expect(document.querySelector("#main")?.textContent).toContain("تم حذف هذه الرسالة");
    widget.dispose();
  });

  it("expands the restored text and timestamps on click and collapses again", () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.scan();

    pill().click();
    expect(block().getAttribute("data-expanded")).toBe("1");
    expect(pill().getAttribute("aria-expanded")).toBe("true");
    expect(block().querySelector(".madarwa-inline-pill-label")?.textContent).toBe("إخفاء المحتوى");
    expect(block().textContent).toContain(base.text);
    expect(block().textContent).toContain("أُرسلت");
    expect(block().textContent).toContain("حُذفت");
    expect(block().querySelector(".madarwa-inline-tool")?.textContent).toContain("نسخ");
    expect(block().textContent).toContain("Ahmed");

    pill().click();
    expect(block().getAttribute("data-expanded")).toBe("0");
    expect(pill().getAttribute("aria-expanded")).toBe("false");
    expect(block().querySelector(".madarwa-inline-pill-label")?.textContent).toBe("كشف الرسالة المحذوفة");
    widget.dispose();
  });

  it("renders a captured photo, opens the lightbox on click and closes with Escape", async () => {
    const mediaVault = new MediaVaultCache({ factory: null });
    await mediaVault.put({
      id: full,
      stanzaId: "STANZA123",
      chatId: base.chatId,
      kind: "image",
      mimetype: "image/jpeg",
      filename: "deleted-photo.jpg",
      fileSize: 1024,
      duration: 0,
      width: 640,
      height: 480,
      blob: new Blob(["photo"], { type: "image/jpeg" }),
      previewDataUrl: "",
      caption: "",
    });
    const widget = restorer(mediaVault);
    mountRow();
    widget.setRecords([
      {
        ...base,
        text: "",
        messageType: "image",
        mediaType: "image",
        mimetype: "image/jpeg",
        filename: "deleted-photo.jpg",
        hasFullMedia: true,
      },
    ]);
    widget.scan();

    expect(block().querySelector(".madarwa-inline-kind")?.textContent).toBe("صورة محذوفة");
    pill().click();
    await widget.whenIdle();

    const image = block().querySelector<HTMLImageElement>("img.madarwa-inline-image");
    expect(image).not.toBeNull();
    expect(image?.src).toContain("blob:madarwa-");
    expect(block().querySelector(".madarwa-inline-note")).toBeNull();

    image?.click();
    const lightbox = document.querySelector<HTMLElement>(".madarwa-lightbox");
    expect(lightbox).not.toBeNull();
    expect(lightbox?.querySelector('a[download="deleted-photo.jpg"]')).not.toBeNull();
    expect(lightbox?.querySelectorAll(".madarwa-lightbox-zoom-btn")).toHaveLength(2);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".madarwa-lightbox")).toBeNull();
    widget.dispose();
  });

  it("renders an inline video player with metadata and a download link", async () => {
    const mediaVault = new MediaVaultCache({ factory: null });
    await mediaVault.put({
      id: full,
      stanzaId: "STANZA123",
      chatId: base.chatId,
      kind: "video",
      mimetype: "video/mp4",
      filename: "deleted-clip.mp4",
      fileSize: 4096,
      duration: 9,
      width: 1280,
      height: 720,
      blob: new Blob(["video"], { type: "video/mp4" }),
      previewDataUrl: "",
      caption: "",
    });
    const widget = restorer(mediaVault);
    mountRow();
    widget.setRecords([
      {
        ...base,
        text: "",
        messageType: "video",
        mediaType: "video",
        filename: "deleted-clip.mp4",
        hasFullMedia: true,
      },
    ]);
    widget.scan();

    expect(block().querySelector(".madarwa-inline-kind")?.textContent).toBe("فيديو محذوف");
    pill().click();
    await widget.whenIdle();

    const video = block().querySelector<HTMLVideoElement>("video.madarwa-inline-video");
    expect(video).not.toBeNull();
    expect(video?.controls).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.getAttribute("src")).toContain("blob:madarwa-");
    expect(block().textContent).toContain("تحميل الفيديو");
    widget.dispose();
  });

  it("renders a voice note with an inline audio player", async () => {
    const mediaVault = new MediaVaultCache({ factory: null });
    await mediaVault.put({
      id: full,
      stanzaId: "STANZA123",
      chatId: base.chatId,
      kind: "ptt",
      mimetype: "audio/ogg",
      filename: "voice.ogg",
      fileSize: 2048,
      duration: 14,
      width: 0,
      height: 0,
      blob: new Blob(["audio"], { type: "audio/ogg" }),
      previewDataUrl: "",
      caption: "",
    });
    const widget = restorer(mediaVault);
    mountRow();
    widget.setRecords([
      {
        ...base,
        text: "",
        messageType: "ptt",
        mediaType: "ptt",
        hasFullMedia: true,
      },
    ]);
    widget.scan();

    expect(block().querySelector(".madarwa-inline-kind")?.textContent).toBe("رسالة صوتية");
    pill().click();
    await widget.whenIdle();

    const audio = block().querySelector<HTMLAudioElement>("audio.madarwa-inline-audio");
    expect(audio).not.toBeNull();
    expect(audio?.controls).toBe(true);
    expect(block().textContent).toContain("0:14");
    expect(block().textContent).toContain("تحميل الصوت");
    widget.dispose();
  });

  it("falls back to the thumbnail when the full media was not captured", async () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([
      {
        ...base,
        text: "",
        messageType: "image",
        mediaType: "image",
        hasFullMedia: false,
        previewDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    ]);
    widget.scan();
    pill().click();
    await widget.whenIdle();

    const image = block().querySelector<HTMLImageElement>("img.madarwa-inline-image");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(block().textContent).toContain("معاينة مصغّرة فقط");
    expect(block().querySelector(".madarwa-inline-tool")).toBeNull();

    image?.click();
    expect(document.querySelector(".madarwa-lightbox")).toBeNull();
    widget.dispose();
  });

  it("supports the auto-expanded display mode", () => {
    mode = "expanded";
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.scan();

    expect(block().getAttribute("data-expanded")).toBe("1");
    expect(block().textContent).toContain(base.text);
    expect(pill().getAttribute("aria-expanded")).toBe("true");
    widget.dispose();
  });

  it("renders English LTR labels after a language change", () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.scan();
    language = "en";
    widget.setLanguage("en");

    expect(block().getAttribute("dir")).toBe("ltr");
    expect(block().querySelector(".madarwa-inline-pill-label")?.textContent).toBe("Show Deleted Message");
    pill().click();
    expect(block().querySelector(".madarwa-inline-pill-label")?.textContent).toBe("Hide Content");
    expect(block().textContent).toContain("Sent");
    expect(block().textContent).toContain("Deleted");
    widget.dispose();
  });

  it("is idempotent across repeated scans", () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.scan();
    widget.scan();
    expect(document.querySelectorAll("[data-madarwa-inline-restore]")).toHaveLength(1);
    widget.dispose();
  });

  it("matches the revoke row when WhatsApp replaces the original data-id", () => {
    const revokeId = "false_966501234567@c.us_REVOKE999";
    const widget = restorer();
    mountRow(revokeId);
    widget.restoreForRevoke(base, revokeId);

    expect(block().getAttribute("data-madarwa-inline-restore")).toBe(base.id);
    expect(block().querySelector(".madarwa-inline-pill-label")?.textContent).toBe("كشف الرسالة المحذوفة");
    widget.dispose();
  });

  it("matches the bare revoke stanza real WhatsApp uses as data-id and survives rescans", () => {
    const revokeFull = "false_966501234567@c.us_REVOKE999";
    const widget = restorer();
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE999" data-testid="conv-msg-REVOKE999">
      <div data-testid="msg-container"><div class="copyable-text"><span>This message was deleted</span></div></div>
    </div></div>`;
    widget.restoreForRevoke(base, revokeFull);

    expect(block().getAttribute("data-madarwa-inline-restore")).toBe(base.id);
    expect(document.querySelector("#main")?.textContent).toContain("This message was deleted");

    block().remove();
    widget.scan();
    expect(block().getAttribute("data-madarwa-inline-restore")).toBe(base.id);
    widget.dispose();
  });

  it("restores after a reload using the persisted revoke id", () => {
    const widget = restorer();
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE999" data-testid="conv-msg-REVOKE999">
      <div data-testid="msg-container"><div class="copyable-text"><span>This message was deleted</span></div></div>
    </div></div>`;
    widget.setRecords([
      { ...base, revokeMessageId: "false_966501234567@c.us_REVOKE999" },
    ]);
    widget.scan();

    expect(block().getAttribute("data-madarwa-inline-restore")).toBe(base.id);
    widget.dispose();
  });

  it("reconnects old vault entries to revoked rows through the store revoke index", () => {
    const widget = restorer();
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE999" data-testid="conv-msg-REVOKE999">
      <div data-testid="msg-container"><div class="copyable-text"><span>This message was deleted</span></div></div>
    </div></div>`;
    widget.setRecords([base]);
    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();

    widget.setRevokeIndex([
      {
        revokeFull: "false_966501234567@c.us_REVOKE999",
        revokeStanza: "REVOKE999",
        originalFull: base.id,
        originalStanza: base.stanzaId || "",
        chatId: base.chatId,
        timestamp: base.timestamp,
      },
    ]);
    expect(block().getAttribute("data-madarwa-inline-restore")).toBe(base.id);
    widget.dispose();
  });

  it("also works when the revoke index arrives before the vault is loaded", () => {
    const widget = restorer();
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE999" data-testid="conv-msg-REVOKE999">
      <div data-testid="msg-container"><div class="copyable-text"><span>This message was deleted</span></div></div>
    </div></div>`;
    widget.setRevokeIndex([
      {
        revokeFull: "false_966501234567@c.us_REVOKE999",
        revokeStanza: "REVOKE999",
        originalFull: base.id,
        originalStanza: base.stanzaId || "",
        chatId: base.chatId,
        timestamp: base.timestamp,
      },
    ]);
    widget.setRecords([base]);
    expect(block().getAttribute("data-madarwa-inline-restore")).toBe(base.id);
    widget.dispose();
  });

  it("still works when the row has no msg-container wrapper", () => {
    const widget = restorer();
    const row = mountRow(full, false);
    widget.setRecords([base]);
    widget.scan();
    expect(row.querySelector("[data-madarwa-inline-restore]")).not.toBeNull();
    widget.dispose();
  });

  it("removes injected blocks when disabled", () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.scan();
    expect(document.querySelector("[data-madarwa-inline-restore]")).not.toBeNull();

    widget.setEnabled(false);
    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    expect(document.querySelector("[data-madarwa-restored-id]")).toBeNull();
    widget.dispose();
  });
});

describe("keeping pills on screen", () => {
  it("starts watching the chat when enabled, even if it was never switched off", () => {
    const widget = restorer();
    expect(widget.isRunning()).toBe(false);
    widget.setEnabled(true);
    expect(widget.isRunning()).toBe(true);
    widget.dispose();
  });

  it("puts the pill back after WhatsApp renders the chat again", async () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.setEnabled(true);
    expect(document.querySelectorAll("[data-madarwa-inline-restore]")).toHaveLength(1);

    // Leaving and reopening the chat: WhatsApp rebuilds every row from scratch.
    document.querySelector("#main")?.remove();
    await settle(30);
    const main = document.createElement("div");
    main.id = "main";
    main.innerHTML = `<div data-id="${full}">${DELETED_ROW}</div>`;
    document.body.appendChild(main);
    await settle();

    expect(document.querySelectorAll("[data-madarwa-inline-restore]")).toHaveLength(1);
    widget.dispose();
  });

  it("re-opens a pill the user had expanded after a re-render", async () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.setEnabled(true);
    pill().click();
    expect(block().getAttribute("data-expanded")).toBe("1");

    block().remove();
    await settle();
    expect(block().getAttribute("data-expanded")).toBe("1");
    expect(block().textContent).toContain(base.text);
    widget.dispose();
  });

  it("drops the pill when WhatsApp reuses the row for another message", () => {
    const widget = restorer();
    const row = mountRow();
    widget.setRecords([base]);
    widget.scan();
    expect(document.querySelector("[data-madarwa-inline-restore]")).not.toBeNull();

    row.setAttribute("data-id", "false_966501234567@c.us_SOMETHINGELSE");
    widget.scan();
    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    widget.dispose();
  });

  it("closes auto-expanded pills when the mode goes back to click-to-reveal", () => {
    mode = "expanded";
    const widget = restorer();
    mountRow();
    widget.setRecords([base]);
    widget.scan();
    expect(block().getAttribute("data-expanded")).toBe("1");

    mode = "interactive";
    widget.setMode("interactive");
    expect(block().getAttribute("data-expanded")).toBe("0");
    widget.dispose();
  });

  it("reports newly rendered rows so the revoke index can refresh", () => {
    const onRowsAdded = vi.fn();
    const widget = restorer(undefined, { onRowsAdded });
    mountRow();
    widget.scan();
    widget.scan();
    expect(onRowsAdded).toHaveBeenCalledTimes(1);
    widget.dispose();
  });

  it("only marks the deleted row in a group, not every message by the same person", () => {
    const author = "966501234567@c.us";
    const group = "120363000000000000@g.us";
    const entry: DeletedMessage = {
      ...base,
      id: `false_${group}_GSTANZA1_${author}`,
      stanzaId: "GSTANZA1",
      chatId: group,
      isGroup: true,
    };
    document.body.innerHTML = `<div id="main">
      <div data-id="false_${group}_REVOKEG1_${author}">${DELETED_ROW}</div>
      <div data-id="false_${group}_OTHERMSG_${author}"><div data-testid="msg-container"><span>hello</span></div></div>
    </div>`;
    const widget = restorer();
    widget.restoreForRevoke(entry, `false_${group}_REVOKEG1_${author}`);

    const [deletedRow, otherRow] = [...document.querySelectorAll<HTMLElement>("#main > div[data-id]")];
    expect(deletedRow?.querySelector("[data-madarwa-inline-restore]")).not.toBeNull();
    expect(otherRow?.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    widget.scan();
    expect(otherRow?.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    widget.dispose();
  });
});

describe("deleted messages without a saved copy", () => {
  it("explains a deleted message MadarWA never received", () => {
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE777" data-testid="conv-msg-REVOKE777">${DELETED_ROW}</div></div>`;
    const widget = restorer();
    widget.setRevokeIndex([revokedRow("REVOKE777", "false_966501234567@c.us_NEVERSEEN")]);

    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    expect(note()?.getAttribute("data-madarwa-inline-missing")).toBe("notReceived:0");
    expect(note()?.textContent).toContain("لا توجد نسخة محفوظة");
    expect(note()?.textContent).toContain("حُذفت قبل أن يستلمها مدار");
    expect(note()?.getAttribute("title")).toContain("واتساب ويب");
    expect(note()?.getAttribute("dir")).toBe("rtl");
    // WhatsApp's own deleted text stays.
    expect(document.querySelector("#main")?.textContent).toContain("This message was deleted");
    widget.dispose();
  });

  it("says when a message is older than when saving started", () => {
    const since = base.timestamp + 24 * 60 * 60_000;
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE778">${DELETED_ROW}</div></div>`;
    const widget = restorer(undefined, { getCaptureInfo: () => ({ since, clearedAt: 0 }) });
    widget.setRevokeIndex([revokedRow("REVOKE778", "false_966501234567@c.us_OLDMSG")]);

    expect(note()?.getAttribute("data-madarwa-inline-missing")).toBe(`beforeCapture:${since}`);
    expect(note()?.textContent).toContain("أقدم من بدء الحفظ");
    expect(note()?.textContent).toMatch(/2023/);
    widget.dispose();
  });

  it("says when the copy was removed by clearing the vault", () => {
    const clearedAt = base.timestamp + 60 * 60_000;
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE779">${DELETED_ROW}</div></div>`;
    const widget = restorer(undefined, { getCaptureInfo: () => ({ since: 0, clearedAt }) });
    widget.setRecords([]);
    widget.setRevokeIndex([revokedRow("REVOKE779", base.id)]);

    expect(note()?.getAttribute("data-madarwa-inline-missing")).toBe(`cleared:${clearedAt}`);
    expect(note()?.textContent).toContain("مسح الخزنة");
    widget.dispose();
  });

  it("shows the note instead of an empty pill when only the deletion notice arrived", () => {
    const widget = restorer();
    mountRow();
    widget.setRecords([{ ...base, text: "", messageType: "", recoveredFromCache: false }]);
    widget.scan();

    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    expect(note()?.getAttribute("data-madarwa-inline-missing")).toBe("notReceived:0");
    widget.dispose();
  });

  it("replaces the note with the pill once the saved copy is linked", () => {
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE999">${DELETED_ROW}</div></div>`;
    const widget = restorer();
    widget.setRevokeIndex([revokedRow("REVOKE999", base.id)]);
    expect(note()).not.toBeNull();

    widget.setRecords([base]);
    expect(note()).toBeNull();
    expect(block().getAttribute("data-madarwa-inline-restore")).toBe(base.id);
    widget.dispose();
  });

  it("turns the pill into a note when the vault is cleared", () => {
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE999">${DELETED_ROW}</div></div>`;
    const clearedAt = Date.now();
    const widget = restorer(undefined, { getCaptureInfo: () => ({ since: 0, clearedAt }) });
    widget.setRecords([base]);
    widget.setRevokeIndex([revokedRow("REVOKE999", base.id)]);
    expect(block()).not.toBeNull();

    widget.setRecords([]);
    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    expect(note()?.getAttribute("data-madarwa-inline-missing")).toBe(`cleared:${clearedAt}`);
    widget.dispose();
  });

  it("writes the note in English for an English panel and removes it when disabled", () => {
    language = "en";
    initI18n("en");
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE780">${DELETED_ROW}</div></div>`;
    const widget = restorer();
    widget.setRevokeIndex([revokedRow("REVOKE780", "false_966501234567@c.us_NEVERSEEN")]);

    expect(note()?.getAttribute("dir")).toBe("ltr");
    expect(note()?.textContent).toContain("No saved copy");
    expect(note()?.textContent).toContain("Deleted before MadarWA received it");

    widget.setEnabled(false);
    expect(note()).toBeNull();
    widget.dispose();
  });

  it("sits inside the bubble, under WhatsApp's own text, when the bubble can be found", () => {
    document.body.innerHTML = `<div id="main"><div data-id="REVOKE782">
      <div data-testid="msg-container"><span data-testid="tail-in"></span>
        <div class="bubble"><div><span>This message was deleted</span><div><div data-testid="msg-meta">7:49</div></div></div></div>
      </div>
    </div></div>`;
    const widget = restorer();
    widget.setRevokeIndex([revokedRow("REVOKE782", "false_966501234567@c.us_NEVERSEEN")]);

    expect(note()?.parentElement?.className).toBe("bubble");
    expect(note()?.classList.contains("madarwa-inline-inside")).toBe(true);
    widget.dispose();
  });

  it("leaves ordinary messages alone", () => {
    document.body.innerHTML = `<div id="main"><div data-id="NORMAL1"><div data-testid="msg-container"><span>hi</span></div></div></div>`;
    const widget = restorer();
    widget.setRecords([base]);
    widget.setRevokeIndex([revokedRow("REVOKE781", "false_966501234567@c.us_ELSEWHERE")]);
    expect(note()).toBeNull();
    expect(document.querySelector("[data-madarwa-inline-restore]")).toBeNull();
    widget.dispose();
  });
});
