// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyCampaign, emptyValidation, useAppStore } from "../src/content/store";
import { App } from "../src/content/ui/App";
import { Field, NumberInput } from "../src/content/ui/components";
import { createDefaultSettings } from "../src/shared/defaults";
import { initI18n, tFor } from "../src/shared/i18n";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  const settings = { ...createDefaultSettings(), language: "en" as const };
  useAppStore.setState({
    settings,
    panelOpen: true,
    activeTab: "privacy",
    locked: false,
    vault: [],
    toasts: [],
    campaign: emptyCampaign(),
    recipients: [],
    validation: emptyValidation(),
    bridgeConnected: true,
    everConnected: true,
    orphaned: false,
    engine: { ready: true, connected: true, wppVersion: "4.7.2", me: "" },
  });
  initI18n("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const t = tFor("en");

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
}

describe("panel behaviour", () => {
  it("offers Undo for a privacy preset and restores the previous settings", async () => {
    await act(async () => root.render(<App />));
    expect(useAppStore.getState().settings.privacy.blurNames).toBe(false);

    await act(async () => buttonByText(t("privacy.fullStealth"))?.click());
    expect(useAppStore.getState().settings.privacy.blurNames).toBe(true);

    const toast = useAppStore.getState().toasts[0];
    expect(toast?.action?.label).toBe(t("common.undo"));
    await act(async () => toast?.action?.run());
    expect(useAppStore.getState().settings.privacy.blurNames).toBe(false);
    expect(useAppStore.getState().settings.privacy.hidePresence).toBe(false);
  });

  it("closes only the dialog on Escape and keeps the drawer open", async () => {
    useAppStore.setState({ activeTab: "vault" });
    useAppStore.setState({
      vault: [
        {
          id: "v1",
          chatId: "966501234567@c.us",
          chatName: "Ahmed",
          sender: "966501234567",
          senderName: "Ahmed",
          text: "hello",
          messageType: "chat",
          timestamp: Date.now(),
          isGroup: false,
          revokedAt: Date.now(),
          revokedBy: "966501234567",
          revokeType: "revoke",
          recoveredFromCache: true,
        },
      ],
    });
    await act(async () => root.render(<App />));
    await act(async () => buttonByText(t("vault.clearAll"))?.click());

    const dialog = container.querySelector('[role="dialog"][aria-labelledby]');
    expect(dialog).not.toBeNull();
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(container.querySelector('[role="dialog"][aria-labelledby]')).toBeNull();
    expect(useAppStore.getState().panelOpen).toBe(true);
  });

  it("shows the reload banner only when a reload actually helps", async () => {
    await act(async () => root.render(<App />));
    expect(container.textContent).not.toContain(t("connection.reload"));

    await act(async () => useAppStore.setState({ orphaned: true }));
    expect(container.textContent).toContain(t("connection.hint.updated"));
    expect(buttonByText(t("connection.reload"))).toBeTruthy();
  });
});

describe("NumberInput", () => {
  it("lets people type freely and clamps only on commit", async () => {
    const commits: number[] = [];
    await act(async () =>
      root.render(
        <Field label="Max">
          <NumberInput value={800} min={50} max={3000} onCommit={(value) => commits.push(value)} />
        </Field>,
      ),
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(container.querySelector("label")?.getAttribute("for")).toBe(input.id);

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Mid-typing "1" is kept as typed instead of jumping to the minimum.
    expect(input.value).toBe("1");
    expect(commits).toEqual([]);

    await act(async () => {
      setValue?.call(input, "9000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(commits).toEqual([3000]);
  });
});
