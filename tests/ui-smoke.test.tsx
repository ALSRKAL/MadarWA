// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { App } from "../src/content/ui/App";
import { useAppStore, type TabId } from "../src/content/store";
import { createDefaultSettings } from "../src/shared/defaults";
import { initI18n } from "../src/shared/i18n";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TAB_TITLES: Record<TabId, string> = {
  privacy: "الخصوصية والتمويه",
  broadcaster: "الإرسال الجماعي الذكي",
  autoreply: "الرد الآلي والقوالب",
  exporter: "سحب الأرقام والمجموعات",
  vault: "خزنة الرسائل المحذوفة",
  tools: "الربط البرمجي والأدوات السريعة",
};

function resetStore(): void {
  const defaults = createDefaultSettings();
  useAppStore.setState({
    settings: defaults,
    panelOpen: true,
    activeTab: "privacy",
    locked: false,
    vault: [],
    webhookLog: [],
    campaign: {
      id: "",
      status: "idle",
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      invalid: 0,
      startedAt: 0,
      finishedAt: 0,
      logs: [],
    },
    recipients: [],
    validation: { active: false, current: 0, total: 0 },
  });
  initI18n("ar");
}

describe("Shadow DOM dashboard", () => {
  it("mounts and renders all six tabs in Arabic and English", async () => {
    resetStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      useAppStore.getState().setSettings({ ...useAppStore.getState().settings, language: "ar" });
      useAppStore.getState().openPanel("privacy");
      root.render(<App />);
    });

    expect(container.querySelector(".mw-app")?.getAttribute("dir")).toBe("rtl");
    expect(container.textContent).toContain("مدار واتساب");

    for (const [tab, title] of Object.entries(TAB_TITLES) as Array<[TabId, string]>) {
      await act(async () => {
        useAppStore.getState().setTab(tab);
      });
      expect(container.textContent, `tab ${tab}`).toContain(title);
    }

    await act(async () => {
      useAppStore.getState().setSettings({ ...useAppStore.getState().settings, language: "en" });
      useAppStore.getState().setTab("privacy");
    });
    expect(container.querySelector(".mw-app")?.getAttribute("dir")).toBe("ltr");
    expect(container.textContent).toContain("Privacy & Stealth");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("reveals complexity progressively instead of showing every form at once", async () => {
    resetStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    // Privacy: quick presets, granular phone blur, no PIN form until requested.
    expect(container.textContent).toContain("وضع الخصوصية الكامل (تفعيل الكل)");
    expect(container.textContent).toContain("أرقام الهواتف");
    expect(container.querySelector('input[type="password"]')).toBeNull();

    const fullStealth = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("وضع الخصوصية الكامل"),
    );
    await act(async () => {
      fullStealth?.click();
    });
    expect(useAppStore.getState().settings.privacy.blurMedia).toBe(true);
    expect(useAppStore.getState().settings.privacy.blurPhoneNumbers).toBe(true);
    expect(useAppStore.getState().settings.privacy.hidePresence).toBe(true);
    expect(useAppStore.getState().settings.privacy.suppressDeliveryReceipts).toBe(true);
    expect(useAppStore.getState().settings.privacy.blurComposer).toBe(true);
    expect(useAppStore.getState().settings.privacy.hideRecording).toBe(true);
    expect(useAppStore.getState().settings.privacy.privateStatusView).toBe(true);

    const disableAll = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("إيقاف الكل"),
    );
    await act(async () => {
      disableAll?.click();
    });
    expect(useAppStore.getState().settings.privacy.blurMedia).toBe(false);
    expect(useAppStore.getState().settings.privacy.hidePresence).toBe(false);
    expect(useAppStore.getState().settings.privacy.suppressDeliveryReceipts).toBe(false);
    expect(useAppStore.getState().settings.privacy.blurComposer).toBe(false);
    expect(useAppStore.getState().settings.privacy.hideRecording).toBe(false);
    expect(useAppStore.getState().settings.privacy.privateStatusView).toBe(false);

    // Broadcaster: step 1 only, the send action appears on step 3.
    await act(async () => {
      useAppStore.getState().setTab("broadcaster");
    });
    expect(container.textContent).toContain("الخطوة 1 من 3");
    expect(container.textContent).not.toContain("بدء الحملة");
    await act(async () => {
      (container.querySelectorAll(".mw-step")[2] as HTMLButtonElement | undefined)?.click();
    });
    expect(container.textContent).toContain("الخطوة 3 من 3");
    expect(container.textContent).toContain("بدء الحملة");

    // Vault: filter chips are always visible; the numeric cache option is not.
    await act(async () => {
      useAppStore.getState().setTab("vault");
    });
    for (const label of ["الكل", "نصوص", "صور", "فيديو", "صوتيات"]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).not.toContain("أقصى عدد رسائل محفوظة");

    // Auto-reply: rule editor and rule list stay hidden until the master switch is on.
    await act(async () => {
      useAppStore.getState().setTab("autoreply");
    });
    expect(container.textContent).not.toContain("إضافة قاعدة");
    await act(async () => {
      const state = useAppStore.getState();
      useAppStore.getState().setSettings({
        ...state.settings,
        autoReply: { ...state.settings.autoReply, enabled: true },
      });
    });
    expect(container.textContent).toContain("إضافة قاعدة");

    // Tools: webhook fields stay behind the Configure drawer.
    await act(async () => {
      useAppStore.getState().setTab("tools");
      const state = useAppStore.getState();
      useAppStore.getState().setSettings({
        ...state.settings,
        webhook: { ...state.settings.webhook, enabled: true },
      });
    });
    expect(container.querySelector('input[type="password"]')).toBeNull();
    const configure = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("تخصيص"),
    );
    expect(configure).toBeTruthy();
    await act(async () => {
      configure?.click();
    });
    expect(container.querySelector('input[type="password"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
