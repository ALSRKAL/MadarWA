import { describe, expect, it, vi } from "vitest";
import type { AutoReplyRule } from "../src/shared/types";
import { CooldownTracker, isValidRegex, matchesRule, selectRule } from "../src/shared/utils/rules";

function rule(overrides: Partial<AutoReplyRule> = {}): AutoReplyRule {
  return {
    id: "rule-1",
    name: "Rule",
    enabled: true,
    matchType: "contains",
    pattern: "سعر",
    response: "السعر 100",
    scope: "all",
    cooldownMinutes: 30,
    typingSeconds: 0,
    ...overrides,
  };
}

describe("auto-reply rule matcher", () => {
  it("matches exact, contains and startsWith case-insensitively", () => {
    expect(matchesRule(rule({ matchType: "exact", pattern: "PRICE" }), { text: " price ", isGroup: false })).toBe(true);
    expect(matchesRule(rule({ matchType: "exact", pattern: "price" }), { text: "best price", isGroup: false })).toBe(false);
    expect(matchesRule(rule({ matchType: "contains", pattern: "سعر" }), { text: "ما هو السعر؟", isGroup: false })).toBe(true);
    expect(matchesRule(rule({ matchType: "startsWith", pattern: "مرحب" }), { text: "مرحباً بك", isGroup: false })).toBe(true);
    expect(matchesRule(rule({ matchType: "startsWith", pattern: "بك" }), { text: "مرحباً بك", isGroup: false })).toBe(false);
  });

  it("supports regex and fails safely on invalid patterns", () => {
    expect(matchesRule(rule({ matchType: "regex", pattern: "^\\s*(سعر|price)" }), { text: "سعر المنتج", isGroup: false })).toBe(true);
    expect(matchesRule(rule({ matchType: "regex", pattern: "(" }), { text: "anything", isGroup: false })).toBe(false);
    expect(isValidRegex("[a-z]+")).toBe(true);
    expect(isValidRegex("(")).toBe(false);
    expect(isValidRegex("")).toBe(false);
  });

  it("honours scope", () => {
    expect(matchesRule(rule({ scope: "private" }), { text: "سعر", isGroup: true })).toBe(false);
    expect(matchesRule(rule({ scope: "groups" }), { text: "سعر", isGroup: true })).toBe(true);
    expect(matchesRule(rule({ scope: "all" }), { text: "سعر", isGroup: true })).toBe(true);
  });

  it("selects the first matching rule and skips disabled rules", () => {
    const rules = [
      rule({ id: "disabled", enabled: false }),
      rule({ id: "first", matchType: "contains", pattern: "سعر" }),
      rule({ id: "second", matchType: "contains", pattern: "سعر" }),
    ];
    const selected = selectRule({
      rules,
      context: { text: "كم سعر المنتج؟", isGroup: false },
      contactId: "966501234567@c.us",
      cooldownActive: () => false,
    });
    expect(selected?.id).toBe("first");
  });

  it("uses a fallback only when no normal rule matched", () => {
    const fallback = rule({ id: "welcome", matchType: "fallback", pattern: "", scope: "all" });
    const normal = rule({ id: "price", matchType: "contains", pattern: "سعر" });

    const matched = selectRule({
      rules: [fallback, normal],
      context: { text: "ما هو السعر؟", isGroup: false },
      contactId: "c1",
      cooldownActive: () => false,
    });
    expect(matched?.id).toBe("price");

    const fallbackSelected = selectRule({
      rules: [fallback, normal],
      context: { text: "مرحباً", isGroup: false },
      contactId: "c1",
      cooldownActive: () => false,
    });
    expect(fallbackSelected?.id).toBe("welcome");
  });

  it("honours cooldowns", () => {
    const fallback = rule({ id: "welcome", matchType: "fallback", pattern: "", cooldownMinutes: 60 });
    const selected = selectRule({
      rules: [fallback],
      context: { text: "hello", isGroup: false },
      contactId: "c1",
      cooldownActive: (ruleId, contactId) => ruleId === "welcome" && contactId === "c1",
    });
    expect(selected).toBeNull();
  });
});

describe("cooldown tracker", () => {
  it("tracks per rule and contact", () => {
    const tracker = new CooldownTracker();
    const now = 1_700_000_000_000;
    expect(tracker.isActive("r1", "c1", 30, now)).toBe(false);
    tracker.mark("r1", "c1", now);
    expect(tracker.isActive("r1", "c1", 30, now + 29 * 60_000)).toBe(true);
    expect(tracker.isActive("r1", "c1", 30, now + 31 * 60_000)).toBe(false);
    expect(tracker.isActive("r1", "c2", 30, now + 60_000)).toBe(false);
    expect(tracker.isActive("r2", "c1", 30, now + 60_000)).toBe(false);
    expect(tracker.isActive("r1", "c1", 0, now)).toBe(false);
  });

  it("prunes stale entries and clears", () => {
    const tracker = new CooldownTracker();
    const now = 1_700_000_000_000;
    tracker.mark("r1", "c1", now - 8 * 24 * 60 * 60_000);
    tracker.mark("r1", "c2", now);
    tracker.prune(now);
    expect(tracker.size()).toBe(1);
    tracker.clear();
    expect(tracker.size()).toBe(0);
  });
});

describe("rule engine integration", () => {
  it("invokes cooldown lookup with the contact id", () => {
    const spy = vi.fn().mockReturnValue(false);
    selectRule({
      rules: [rule()],
      context: { text: "سعر", isGroup: false },
      contactId: "966501234567@c.us",
      cooldownActive: spy,
    });
    expect(spy).toHaveBeenCalledWith("rule-1", "966501234567@c.us");
  });
});
