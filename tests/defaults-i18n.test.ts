import { describe, expect, it } from "vitest";
import { createDefaultSettings, mergeSettings } from "../src/shared/defaults";
import { ar, dirFor, en, initI18n, tFor } from "../src/shared/i18n";

function collectKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe("settings defaults and defensive merge", () => {
  it("returns complete defaults for empty/corrupt storage", () => {
    const defaults = mergeSettings(null);
    expect(defaults.privacy.blurPreview).toBe(false);
    expect(defaults.privacy.suppressDeliveryReceipts).toBe(false);
    expect(defaults.privacy.blurComposer).toBe(false);
    expect(defaults.privacy.hideRecording).toBe(false);
    expect(defaults.privacy.privateStatusView).toBe(false);
    expect(defaults.antiDelete.enabled).toBe(true);
    expect(defaults.autoReply.rules.length).toBeGreaterThan(0);
    expect(defaults.broadcaster.minDelaySec).toBe(6);
    expect(defaults.language).toBe("ar");
    expect(createDefaultSettings().version).toBe(defaults.version);
  });

  it("clamps numeric values and rejects wrong types", () => {
    const merged = mergeSettings({
      language: "xx",
      theme: "neon",
      privacy: {
        blurPreview: "yes",
        blurMessages: true,
        suppressDeliveryReceipts: "yes",
        blurComposer: "yes",
        hideRecording: "yes",
        privateStatusView: "yes",
      },
      antiDelete: { maxCache: 999_999, enabled: "no" },
      broadcaster: {
        minDelaySec: 99_999,
        maxDelaySec: -20,
        batchSize: -5,
        batchCooldownSec: 0,
        defaultCountryCode: "9a6b6c",
      },
      pin: { enabled: true, idleMinutes: 0, hash: "h", salt: "s" },
      webhook: { enabled: true, url: 5, token: 7 },
      autoReply: {
        enabled: true,
        rules: [{ matchType: "evil", scope: "x", cooldownMinutes: -5, typingSeconds: 99 }],
        templates: "bad",
      },
    });

    expect(merged.language).toBe("ar");
    expect(merged.theme).toBe("auto");
    expect(merged.privacy.blurPreview).toBe(false);
    expect(merged.privacy.blurMessages).toBe(true);
    expect(merged.privacy.suppressDeliveryReceipts).toBe(false);
    expect(merged.privacy.blurComposer).toBe(false);
    expect(merged.privacy.hideRecording).toBe(false);
    expect(merged.privacy.privateStatusView).toBe(false);
    expect(merged.antiDelete.maxCache).toBe(3000);
    expect(merged.antiDelete.enabled).toBe(true);
    expect(merged.broadcaster.minDelaySec).toBe(600);
    expect(merged.broadcaster.maxDelaySec).toBe(1);
    expect(merged.broadcaster.batchSize).toBe(1);
    expect(merged.broadcaster.defaultCountryCode).toBe("966");
    expect(merged.pin.idleMinutes).toBe(1);
    expect(merged.webhook.url).toBe("");
    expect(merged.webhook.token).toBe("");
    expect(merged.autoReply.rules[0]?.matchType).toBe("contains");
    expect(merged.autoReply.rules[0]?.scope).toBe("private");
    expect(merged.autoReply.rules[0]?.cooldownMinutes).toBe(0);
    expect(merged.autoReply.rules[0]?.typingSeconds).toBe(30);
    expect(Array.isArray(merged.autoReply.templates)).toBe(true);
  });

  it("preserves valid user values", () => {
    const merged = mergeSettings({
      language: "en",
      theme: "dark",
      privacy: {
        disableReadReceipts: true,
        suppressDeliveryReceipts: true,
        blurComposer: true,
        hideRecording: true,
        privateStatusView: true,
      },
      broadcaster: { minDelaySec: 8, maxDelaySec: 20, batchSize: 25 },
      pin: { enabled: true, idleMinutes: 45, hash: "abc", salt: "def" },
      webhook: { enabled: true, url: "https://hooks.example.org/x", token: "t" },
    });
    expect(merged.language).toBe("en");
    expect(merged.theme).toBe("dark");
    expect(merged.privacy.disableReadReceipts).toBe(true);
    expect(merged.privacy.suppressDeliveryReceipts).toBe(true);
    expect(merged.privacy.blurComposer).toBe(true);
    expect(merged.privacy.hideRecording).toBe(true);
    expect(merged.privacy.privateStatusView).toBe(true);
    expect(merged.broadcaster.maxDelaySec).toBe(20);
    expect(merged.pin.idleMinutes).toBe(45);
    expect(merged.webhook.enabled).toBe(true);
    expect(merged.webhook.token).toBe("t");
  });
});

describe("bilingual resources", () => {
  it("has exactly the same key set in Arabic and English", () => {
    expect(collectKeys(en)).toEqual(collectKeys(ar));
  });

  it("initialises and renders escaped template placeholders literally", async () => {
    initI18n("ar");
    await Promise.resolve();
    expect(tFor("ar")("broadcaster.messagePlaceholder", { name: "{{name}}" })).toContain("{{name}}");
    expect(tFor("ar")("tools.webhookToken")).toContain("X-MadarWA-Token");
    expect(tFor("en")("broadcaster.messagePlaceholder", { name: "{{name}}" })).toContain("{{name}}");
    expect(
      tFor("en")("broadcaster.variablesHint", {
        name: "{{name}}",
        custom1: "{{custom1}}",
        custom2: "{{custom2}}",
        phone: "{{phone}}",
      }),
    ).toContain("{{custom2}}");
    expect(tFor("en")("nav.vault")).toBe("Deleted Messages");
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
  });

  it("interpolates count variables", () => {
    expect(tFor("en")("broadcaster.parsedCount", { count: 12 })).toContain("12");
    expect(tFor("ar")("vault.count", { count: 3 })).toContain("3");
  });
});
