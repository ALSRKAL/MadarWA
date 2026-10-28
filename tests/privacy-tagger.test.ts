// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ELEMENT_ATTR, PrivacyTagger, looksLikePhone } from "../src/content/privacyTagger";
import { createDefaultSettings, mergeSettings } from "../src/shared/defaults";
import type { PrivacySettings } from "../src/shared/types";

const ALL_BLURS: PrivacySettings = {
  ...createDefaultSettings().privacy,
  blurPreview: true,
  blurNames: true,
  blurPhoneNumbers: true,
  blurAvatars: true,
  blurMessages: true,
  blurMedia: true,
};

function mountWhatsapp(): void {
  document.body.innerHTML = `
    <div id="pane-side">
      <div role="listitem" data-testid="cell-frame-container">
        <div data-testid="avatar"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" /></div>
        <div data-testid="cell-frame-title"><span dir="auto" title="+966 50 123 4567">+966 50 123 4567</span></div>
        <div data-testid="cell-frame-secondary"><span>See you tomorrow</span></div>
      </div>
      <div role="listitem">
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" />
        <div data-testid="cell-frame-title"><span dir="auto" title="Team">Team</span></div>
        <div data-testid="cell-frame-secondary"><span>Preview text</span></div>
      </div>
    </div>
    <div id="main">
      <header>
        <div data-testid="conversation-info-header-chat-title"><span dir="auto" title="Team">Team</span></div>
        <span dir="auto">+966 55 987 6543</span>
      </header>
      <div data-testid="contact-info-drawer"><span>+966 50 123 4567</span></div>
      <div data-id="false_966501234567@c.us_MSG1">
        <div data-testid="msg-container">
          <div class="copyable-text"><div data-testid="msg-text"><span dir="auto">Hello there</span></div></div>
          <img src="https://example.com/photo.jpg" alt="" />
        </div>
      </div>
    </div>
  `;
}

function el(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

beforeEach(() => {
  mountWhatsapp();
  document.body.removeAttribute("data-madarwa-blur-media");
  document.body.removeAttribute("data-madarwa-blur-names");
  document.body.removeAttribute("data-madarwa-blur-phones");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("phone detection", () => {
  it("accepts international phone formats and rejects other strings", () => {
    expect(looksLikePhone("+966 50 123 4567")).toBe(true);
    expect(looksLikePhone("00966501234567")).toBe(true);
    expect(looksLikePhone("(055) 123-4567")).toBe(true);
    expect(looksLikePhone("Team")).toBe(false);
    expect(looksLikePhone("10:42")).toBe(false);
    expect(looksLikePhone("Hello +966501234567")).toBe(false);
    expect(looksLikePhone("12345")).toBe(false);
  });
});

describe("privacy tagger", () => {
  it("tags each semantic target precisely", () => {
    const tagger = new PrivacyTagger();
    tagger.setActive(ALL_BLURS);
    tagger.scanNow();

    expect(el('[data-testid="cell-frame-container"]').getAttribute(ELEMENT_ATTR)).toBe("chat-item");
    expect(el('[data-testid="cell-frame-title"] span').getAttribute(ELEMENT_ATTR)).toBe("phone-number");
    expect(el('[data-testid="cell-frame-secondary"]').getAttribute(ELEMENT_ATTR)).toBe("chat-preview");
    expect(el('[data-testid="avatar"] img').getAttribute(ELEMENT_ATTR)).toBe("avatar");
    expect(el("#pane-side div[role='listitem'] > img").getAttribute(ELEMENT_ATTR)).toBe("avatar");
    expect(el('[data-testid="msg-text"]').getAttribute(ELEMENT_ATTR)).toBe("message-text");
    expect(el('[data-id] img').getAttribute(ELEMENT_ATTR)).toBe("media-box");
    expect(el("#main header [data-testid='conversation-info-header-chat-title'] span").getAttribute(ELEMENT_ATTR)).toBe(
      "contact-name",
    );
    expect(el("#main header > span").getAttribute(ELEMENT_ATTR)).toBe("phone-number");
    expect(el('[data-testid="contact-info-drawer"] span').getAttribute(ELEMENT_ATTR)).toBe("phone-number");

    tagger.stop();
    expect(document.querySelector(`[${ELEMENT_ATTR}]`)).toBeNull();
  });

  it("does not run when every blur is off", () => {
    const tagger = new PrivacyTagger();
    tagger.setActive(createDefaultSettings().privacy);
    tagger.scanNow();
    expect(tagger.isActive()).toBe(false);
    expect(document.querySelector(`[${ELEMENT_ATTR}]`)).toBeNull();
  });

  it("swallows the first click on blurred media and reveals it in place", () => {
    document.body.setAttribute("data-madarwa-blur-media", "1");
    const tagger = new PrivacyTagger();
    tagger.setActive(ALL_BLURS);
    tagger.scanNow();

    const image = el('[data-id] img');
    image.dispatchEvent(new Event("pointerover", { bubbles: true }));
    const first = new MouseEvent("click", { bubbles: true, cancelable: true });
    image.dispatchEvent(first);

    expect(first.defaultPrevented).toBe(true);
    expect(image.getAttribute("data-madarwa-revealed")).toBe("1");

    const second = new MouseEvent("click", { bubbles: true, cancelable: true });
    image.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    tagger.stop();
  });

  it("stops tagging and guarding after settings turn all blurs off", () => {
    document.body.setAttribute("data-madarwa-blur-media", "1");
    const tagger = new PrivacyTagger();
    tagger.setActive(ALL_BLURS);
    tagger.scanNow();
    expect(tagger.isActive()).toBe(true);

    tagger.setActive(createDefaultSettings().privacy);
    expect(tagger.isActive()).toBe(false);
    expect(document.querySelector(`[${ELEMENT_ATTR}]`)).toBeNull();

    const image = el('[data-id] img');
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    image.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });
});

describe("surgical hover-to-reveal CSS", () => {
  const css = readFileSync(resolve(process.cwd(), "src/injected/privacy.css"), "utf8");

  it("blurs and reveals each tagged element individually", () => {
    for (const tag of ["contact-name", "phone-number", "chat-preview", "avatar", "message-text", "media-box"]) {
      expect(css).toContain(`[data-madarwa-el="${tag}"]`);
      expect(css).toContain(`[data-madarwa-el="${tag}"]:hover`);
    }
    expect(css).toContain("filter: blur(0px) !important;");
    expect(css).toContain("transition: filter 160ms cubic-bezier(0.2, 0, 0, 1);");
    expect(css).toContain('[data-madarwa-el="media-box"][data-madarwa-revealed="1"]');
  });

  it("keeps the phone-number blur gated by its own body attribute", () => {
    expect(css).toContain('body[data-madarwa-blur-phones="1"] [data-madarwa-el="phone-number"]');
  });

  it("does not unblur every name when hovering an unrelated header area", () => {
    expect(css).not.toContain("#main header:hover span");
  });
});

describe("privacy settings merge", () => {
  it("keeps the new granular defaults and rejects invalid inline modes", () => {
    const defaults = createDefaultSettings();
    expect(defaults.privacy.blurPhoneNumbers).toBe(false);
    expect(defaults.antiDelete.inlineMode).toBe("interactive");

    const merged = mergeSettings({
      privacy: { blurPhoneNumbers: true },
      antiDelete: { inlineMode: "expanded" },
    });
    expect(merged.privacy.blurPhoneNumbers).toBe(true);
    expect(merged.antiDelete.inlineMode).toBe("expanded");

    const invalid = mergeSettings({ antiDelete: { inlineMode: "nonsense" } });
    expect(invalid.antiDelete.inlineMode).toBe("interactive");
  });
});
