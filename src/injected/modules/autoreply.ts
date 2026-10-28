import type { AutoReplyRule, AutoReplySettings } from "../../shared/types";
import { CooldownTracker, selectRule } from "../../shared/utils/rules";
import { personalizeMessage } from "../../shared/utils/template";
import type { WppApi } from "../wpp";

export interface AutoReplyInput {
  chatId: string;
  contactId: string;
  senderName: string;
  text: string;
  isGroup: boolean;
  phone: string;
  fromMe?: boolean;
}

export interface AutoReplyOutcome {
  chatId: string;
  ruleId: string;
  ruleName: string;
  text: string;
  at: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Rule engine for incoming messages. Cooldowns are per rule+contact and kept
 * in memory for the page session; duplicate/in-flight events are suppressed.
 */
export class AutoReplyController {
  private config: AutoReplySettings = { enabled: false, rules: [], templates: [] };
  private readonly cooldown = new CooldownTracker();
  private readonly inFlight = new Set<string>();
  private processed = 0;

  configure(config: AutoReplySettings): void {
    this.config = {
      enabled: Boolean(config.enabled),
      rules: Array.isArray(config.rules) ? config.rules : [],
      templates: Array.isArray(config.templates) ? config.templates : [],
    };
  }

  getConfig(): AutoReplySettings {
    return this.config;
  }

  async maybeReply(wpp: WppApi, input: AutoReplyInput): Promise<AutoReplyOutcome | null> {
    if (!this.config.enabled) return null;
    if (input.fromMe) return null;
    const text = String(input.text ?? "").trim();
    if (!text || text.length > 4096) return null;

    const rulesById = new Map<string, AutoReplyRule>(this.config.rules.map((rule) => [rule.id, rule]));
    const rule = selectRule({
      rules: this.config.rules,
      context: { text, isGroup: input.isGroup },
      contactId: input.contactId,
      cooldownActive: (ruleId, contactId) => {
        const candidate = rulesById.get(ruleId);
        return this.cooldown.isActive(ruleId, contactId, candidate?.cooldownMinutes ?? 0);
      },
    });
    if (!rule) return null;

    const key = `${input.chatId}::${rule.id}`;
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);

    try {
      const response = personalizeMessage(rule.response, {
        variables: {
          name: input.senderName || "",
          phone: input.phone || "",
          custom1: "",
          custom2: "",
        },
        enableSpintax: true,
      });
      if (!response) return null;

      const typingMs = Math.min(30_000, Math.max(0, Math.round(rule.typingSeconds * 1000)));
      if (typingMs > 0) {
        try {
          await wpp.chat.markIsComposing(input.chatId, typingMs);
        } catch {
          // Typing state is cosmetic; still send the reply.
        }
        await sleep(typingMs);
      }

      await wpp.chat.sendTextMessage(input.chatId, response, { createChat: true, markIsRead: false });
      this.cooldown.mark(rule.id, input.contactId);
      this.processed += 1;
      if (this.processed % 50 === 0) this.cooldown.prune();

      return {
        chatId: input.chatId,
        ruleId: rule.id,
        ruleName: rule.name,
        text: response,
        at: Date.now(),
      };
    } finally {
      this.inFlight.delete(key);
    }
  }

  clearCooldowns(): void {
    this.cooldown.clear();
  }
}
