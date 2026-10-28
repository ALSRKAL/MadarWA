// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { App } from "../src/content/ui/App";
import { useAppStore, type TabId } from "../src/content/store";
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

describe("Shadow DOM dashboard", () => {
  it("mounts and renders all six tabs in Arabic and English", async () => {
    initI18n("ar");
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
});
