import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import shadowCss from "./styles/shadow.css?inline";
import { installUiFonts } from "../shared/fonts";
import { initI18n } from "../shared/i18n";
import { contentController } from "./controller";
import { App } from "./ui/App";

const HOST_ID = "madarwa-shadow-host";

initI18n("ar");

function mount(): void {
  if (!location.hostname.endsWith("web.whatsapp.com")) return;

  try {
    installUiFonts(document, (path) => chrome.runtime.getURL(path));
  } catch {
    // Fonts are cosmetic; the system fallback stack still renders the panel.
  }

  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-madarwa", "1");
  host.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    "z-index:2147483000",
    "width:0",
    "height:0",
  ].join(";");

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.setAttribute("data-madarwa-styles", "1");
  style.textContent = shadowCss;

  const root = document.createElement("div");
  root.id = "madarwa-root";

  shadow.append(style, root);
  (document.body ?? document.documentElement).appendChild(host);

  try {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (error) {
    const fallback = document.createElement("pre");
    fallback.style.cssText =
      "position:fixed;z-index:2147483647;background:#fff;color:#831c1e;border:1px solid #e6e8ea;border-radius:8px;padding:12px;font-size:12px";
    fallback.textContent = `MadarWA UI error: ${error instanceof Error ? error.message : String(error)}`;
    shadow.appendChild(fallback);
  }

  void contentController.init().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[MadarWA] Failed to initialise:", error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
