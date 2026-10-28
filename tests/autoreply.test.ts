import { describe, expect, it, vi } from "vitest";
import { AutoReplyController } from "../src/injected/modules/autoreply";
import type { WppApi } from "../src/injected/wpp";
import type { AutoReplySettings } from "../src/shared/types";

function fakeWpp() {
  const sendTextMessage = vi.fn(async () => ({ id: "sent" }));
  const markIsComposing = vi.fn(async () => undefined);
  return {
    wpp: { chat: { sendTextMessage, markIsComposing } } as unknown as WppApi,
    sendTextMessage,
    markIsComposing,
  };
}

function config(): AutoReplySettings {
  return {
    enabled: true,
    rules: [
      {
        id: "price",
        name: "Price",
        enabled: true,
        matchType: "contains",
        pattern: "سعر",
        response: "مرحباً {{name}}، السعر 100",
        scope: "all",
        cooldownMinutes: 30,
        typingSeconds: 0,
      },
    ],
    templates: [],
  };
}

const input = {
  chatId: "966501234567@c.us",
  contactId: "966501234567",
  senderName: "أحمد",
  text: "ما هو السعر؟",
  isGroup: false,
  phone: "966501234567",
};

describe("auto-reply live-session guards", () => {
  it("never replies to self-sent messages", async () => {
    const controller = new AutoReplyController();
    controller.configure(config());
    const { wpp, sendTextMessage } = fakeWpp();

    const outcome = await controller.maybeReply(wpp, { ...input, fromMe: true });
    expect(outcome).toBeNull();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("replies to a media caption passed as text", async () => {
    const controller = new AutoReplyController();
    controller.configure(config());
    const { wpp, sendTextMessage } = fakeWpp();

    const outcome = await controller.maybeReply(wpp, { ...input, text: "سعر هذه الصورة؟" });
    expect(outcome?.ruleId).toBe("price");
    expect(sendTextMessage).toHaveBeenCalledWith(
      input.chatId,
      "مرحباً أحمد، السعر 100",
      expect.objectContaining({ markIsRead: false }),
    );
  });

  it("applies per-contact cooldowns", async () => {
    const controller = new AutoReplyController();
    controller.configure(config());
    const { wpp, sendTextMessage } = fakeWpp();

    expect(await controller.maybeReply(wpp, input)).not.toBeNull();
    expect(await controller.maybeReply(wpp, input)).toBeNull();
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });
});
