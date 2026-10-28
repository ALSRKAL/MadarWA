// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { PresenceScrubber } from "../src/content/privacy-runtime";

const HIDDEN = "data-madarwa-hidden-presence";

function span(text: string): HTMLElement {
  const element = document.createElement("span");
  element.textContent = text;
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("presence scrubber", () => {
  it("hides typing and recording independently", () => {
    document.body.innerHTML = '<div id="main"><header id="header"></header></div>';
    const header = document.querySelector<HTMLElement>("#header");
    if (!header) throw new Error("header missing");
    const online = span("online");
    const typing = span("typing…");
    const recording = span("recording audio…");
    header.append(online, typing, recording);

    const scrubber = new PresenceScrubber();
    scrubber.setEnabled(false, true, false);
    scrubber.scanNow();

    expect(typing.getAttribute(HIDDEN)).toBe("1");
    expect(recording.getAttribute(HIDDEN)).toBeNull();
    expect(online.getAttribute(HIDDEN)).toBeNull();

    scrubber.setEnabled(false, false, true);
    scrubber.scanNow();

    expect(typing.getAttribute(HIDDEN)).toBeNull();
    expect(recording.getAttribute(HIDDEN)).toBe("1");
    expect(online.getAttribute(HIDDEN)).toBeNull();

    scrubber.setEnabled(false, false, false);
    expect(typing.getAttribute(HIDDEN)).toBeNull();
    expect(recording.getAttribute(HIDDEN)).toBeNull();
  });

  it("hides presence but leaves typing visible when only presence is enabled", () => {
    document.body.innerHTML = '<div id="main"><header id="header"></header></div>';
    const header = document.querySelector<HTMLElement>("#header");
    if (!header) throw new Error("header missing");
    const online = span("last seen recently");
    const typing = span("typing…");
    header.append(online, typing);

    const scrubber = new PresenceScrubber();
    scrubber.setEnabled(true, false, false);
    scrubber.scanNow();

    expect(online.getAttribute(HIDDEN)).toBe("1");
    expect(typing.getAttribute(HIDDEN)).toBeNull();
    scrubber.setEnabled(false, false, false);
  });
});
