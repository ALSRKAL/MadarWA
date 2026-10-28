// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineRestorer } from "../src/content/inline-restore";
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

function restorer(mediaVault = new MediaVaultCache({ factory: null })): InlineRestorer {
  return new InlineRestorer({ getLanguage: () => language, getMode: () => mode, mediaVault });
}

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
