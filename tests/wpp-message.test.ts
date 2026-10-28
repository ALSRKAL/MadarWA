import { describe, expect, it } from "vitest";
import { messagePreview, messageText, type WppMsg } from "../src/injected/wpp";

const base: WppMsg = {
  id: {
    _serialized: "false_966501234567@c.us_ABC",
    id: "ABC",
    remote: { _serialized: "966501234567@c.us", toString: () => "966501234567@c.us" },
  },
  t: 1_700_000_000,
  type: "chat",
};

describe("message body extraction", () => {
  it("returns text message bodies", () => {
    expect(messageText({ ...base, body: "مرحباً" })).toBe("مرحباً");
  });

  it("uses the caption, never a base64 thumbnail, for media", () => {
    expect(messageText({ ...base, type: "image", body: "data:image/jpeg;base64,/9j/AAAA", caption: "صورة المنتج" })).toBe(
      "صورة المنتج",
    );
    expect(messageText({ ...base, type: "image", body: "data:image/jpeg;base64,/9j/AAAA" })).toBe("");
  });

  it("falls back to the filename for documents", () => {
    expect(messageText({ ...base, type: "document", filename: "invoice.pdf", body: "" })).toBe("invoice.pdf");
  });
});

describe("media preview extraction", () => {
  it("keeps a data URL preview", () => {
    const preview = messagePreview({ ...base, type: "image", mediaData: { preview: "data:image/jpeg;base64,/9j/AAAA" } });
    expect(preview).toBe("data:image/jpeg;base64,/9j/AAAA");
  });

  it("prefixes raw base64 image thumbnails", () => {
    const raw = "/9j/" + "A".repeat(120);
    const preview = messagePreview({ ...base, type: "video", mediaData: { preview: raw } });
    expect(preview.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("prefixes stickers as webp and ignores text messages", () => {
    const preview = messagePreview({ ...base, type: "sticker", mediaData: { preview: "/9j/" + "B".repeat(120) } });
    expect(preview.startsWith("data:image/webp;base64,")).toBe(true);
    expect(messagePreview({ ...base, body: "hello" })).toBe("");
  });
});
