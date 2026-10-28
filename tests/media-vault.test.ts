import { describe, expect, it } from "vitest";
import { MediaVaultCache, mediaVaultKeyCandidates, type MediaVaultInput } from "../src/shared/media-vault";
import {
  blobToDataUrl,
  dataUrlToBlob,
  formatDuration,
  normalizeMediaPreview,
} from "../src/shared/utils/media";

function record(index: number, overrides: Partial<MediaVaultInput> = {}): MediaVaultInput {
  return {
    id: `false_96650000000${index}@c.us_MSG${index}`,
    stanzaId: `MSG${index}`,
    chatId: "966500000000@c.us",
    kind: "image",
    mimetype: "image/jpeg",
    filename: `photo-${index}.jpg`,
    fileSize: 4,
    duration: 0,
    width: 320,
    height: 240,
    blob: new Blob(["data"], { type: "image/jpeg" }),
    previewDataUrl: `data:image/jpeg;base64,AAAA${index}`,
    caption: "",
    createdAt: index,
    ...overrides,
  };
}

describe("MediaVaultCache", () => {
  it("stores and retrieves image, video and voice blobs by serialized id and stanza id", async () => {
    const vault = new MediaVaultCache({ factory: null });
    await vault.put(record(1));
    await vault.put(
      record(2, {
        kind: "video",
        mimetype: "video/mp4",
        filename: "clip.mp4",
        blob: new Blob(["video"], { type: "video/mp4" }),
        duration: 12,
      }),
    );
    await vault.put(
      record(3, {
        kind: "ptt",
        mimetype: "audio/ogg",
        filename: "voice.ogg",
        blob: new Blob(["audio"], { type: "audio/ogg" }),
        duration: 7,
      }),
    );

    const image = await vault.get("false_966500000001@c.us_MSG1");
    expect(image?.kind).toBe("image");
    expect(image?.filename).toBe("photo-1.jpg");
    expect(image?.blob.type).toBe("image/jpeg");

    const byStanza = await vault.get("MSG2");
    expect(byStanza?.kind).toBe("video");
    expect(byStanza?.duration).toBe(12);

    const voice = await vault.getByStanza("MSG3");
    expect(voice?.kind).toBe("ptt");
    expect(voice?.mimetype).toBe("audio/ogg");
    expect(await vault.count()).toBe(3);
  });

  it("prunes the oldest blobs so the cache stays bounded", async () => {
    const vault = new MediaVaultCache({ factory: null, maxEntries: 3 });
    for (let index = 1; index <= 6; index += 1) await vault.put(record(index));

    expect(await vault.count()).toBe(3);
    expect(await vault.get("MSG1")).toBeNull();
    expect(await vault.get("MSG3")).toBeNull();
    expect(await vault.get("MSG4")).not.toBeNull();
    expect(await vault.get("MSG6")).not.toBeNull();
  });

  it("keeps recently accessed blobs when pruning", async () => {
    const vault = new MediaVaultCache({ factory: null, maxEntries: 3 });
    await vault.put(record(1));
    await vault.put(record(2));
    await vault.put(record(3));
    expect((await vault.get("MSG1"))?.id).toContain("MSG1");
    await vault.put(record(4));

    expect(await vault.count()).toBe(3);
    expect(await vault.get("MSG1")).not.toBeNull();
    expect(await vault.get("MSG2")).toBeNull();
    expect(await vault.get("MSG3")).not.toBeNull();
    expect(await vault.get("MSG4")).not.toBeNull();
  });

  it("deletes and clears cached blobs", async () => {
    const vault = new MediaVaultCache({ factory: null });
    await vault.put(record(1));
    await vault.put(record(2));
    await vault.delete("false_966500000001@c.us_MSG1");
    expect(await vault.get("MSG1")).toBeNull();
    expect(await vault.get("MSG2")).not.toBeNull();
    await vault.clear();
    expect(await vault.count()).toBe(0);
  });

  it("exposes deduplicated lookup keys", () => {
    expect(mediaVaultKeyCandidates("false_chat_MSG1", "MSG1")).toEqual(["false_chat_MSG1", "MSG1"]);
    expect(mediaVaultKeyCandidates("MSG1", "MSG1")).toEqual(["MSG1"]);
    expect(mediaVaultKeyCandidates("", "MSG1")).toEqual(["MSG1"]);
  });
});

describe("media preview normalization", () => {
  it("adds the missing data URL prefix to raw JPEG base64", () => {
    const raw = "A".repeat(120);
    const normalized = normalizeMediaPreview(raw, "image");
    expect(normalized.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(normalized).toContain(raw);
  });

  it("uses WebP for sticker thumbnails and preserves existing data URLs", () => {
    const raw = "B".repeat(120);
    expect(normalizeMediaPreview(raw, "sticker")).toContain("data:image/webp;base64,");
    const existing = "data:image/png;base64,iVBORw0KGgo=";
    expect(normalizeMediaPreview(existing, "image")).toBe(existing);
  });

  it("rejects text, short blobs and non-base64 payloads", () => {
    expect(normalizeMediaPreview("", "image")).toBe("");
    expect(normalizeMediaPreview("short", "image")).toBe("");
    expect(normalizeMediaPreview("https://example.com/image.jpg", "image")).toBe("");
    expect(normalizeMediaPreview("A".repeat(120) + "-", "image")).toBe("");
  });

  it("converts blobs to data URLs and back", async () => {
    const blob = new Blob(["madarwa"], { type: "text/plain" });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.startsWith("data:text/plain;base64,")).toBe(true);
    const restored = dataUrlToBlob(dataUrl);
    expect(restored.type).toBe("text/plain");
    expect(await restored.text()).toBe("madarwa");
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });
});
