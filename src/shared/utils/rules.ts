import type { AutoReplyRule, RuleScope } from "../types";
import { UI_LIMITS } from "../constants";

export interface MatchContext {
  text: string;
  isGroup: boolean;
}

export function normalizeText(text: string): string {
  return String(text ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}

export function isValidRegex(pattern: string): boolean {
  if (!pattern || pattern.length > UI_LIMITS.maxPatternLength) return false;
  try {
    const compiled = new RegExp(pattern, "i");
    return compiled.test("") === false || true;
  } catch {
    return false;
  }
}

function scopeAllows(scope: RuleScope, isGroup: boolean): boolean {
  if (scope === "all") return true;
  if (scope === "groups") return isGroup;
  return !isGroup;
}

/** Pure matcher. Fallback rules never "match" here; they are handled by selectRule. */
export function matchesRule(rule: AutoReplyRule, context: MatchContext): boolean {
  if (!rule.enabled || rule.matchType === "fallback") return false;
  if (!scopeAllows(rule.scope, context.isGroup)) return false;

  const text = String(context.text ?? "").slice(0, 4096);
  const normalized = normalizeText(text);
  const pattern = normalizeText(rule.pattern);

  switch (rule.matchType) {
    case "exact":
      return pattern.length > 0 && normalized === pattern;
    case "contains":
      return pattern.length > 0 && normalized.includes(pattern);
    case "startsWith":
      return pattern.length > 0 && normalized.startsWith(pattern);
    case "regex": {
      if (!rule.pattern || rule.pattern.length > UI_LIMITS.maxPatternLength) return false;
      try {
        return new RegExp(rule.pattern, "i").test(text);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export interface SelectionOptions {
  rules: AutoReplyRule[];
  context: MatchContext;
  cooldownActive: (ruleId: string, contactId: string) => boolean;
  contactId: string;
}

/**
 * First enabled, scope-compatible, non-cooldown rule wins. A fallback rule is
 * used only when no normal rule matched (welcome/away message semantics).
 */
export function selectRule(options: SelectionOptions): AutoReplyRule | null {
  const { rules, context, cooldownActive, contactId } = options;

  for (const rule of rules) {
    if (rule.matchType === "fallback") continue;
    if (!matchesRule(rule, context)) continue;
    if (cooldownActive(rule.id, contactId)) continue;
    return rule;
  }

  for (const rule of rules) {
    if (rule.matchType !== "fallback") continue;
    if (!rule.enabled) continue;
    if (!scopeAllows(rule.scope, context.isGroup)) continue;
    if (cooldownActive(rule.id, contactId)) continue;
    if (!rule.response.trim()) continue;
    return rule;
  }

  return null;
}

export class CooldownTracker {
  private readonly lastSent = new Map<string, number>();

  private key(ruleId: string, contactId: string): string {
    return `${ruleId}::${contactId}`;
  }

  isActive(ruleId: string, contactId: string, cooldownMinutes: number, now = Date.now()): boolean {
    if (cooldownMinutes <= 0) return false;
    const at = this.lastSent.get(this.key(ruleId, contactId));
    if (!at) return false;
    return now - at < cooldownMinutes * 60_000;
  }

  mark(ruleId: string, contactId: string, now = Date.now()): void {
    this.lastSent.set(this.key(ruleId, contactId), now);
  }

  prune(now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60_000): void {
    for (const [key, at] of this.lastSent) {
      if (now - at > maxAgeMs) this.lastSent.delete(key);
    }
  }

  clear(): void {
    this.lastSent.clear();
  }

  size(): number {
    return this.lastSent.size;
  }
}
