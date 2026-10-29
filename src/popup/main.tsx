import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installUiFonts } from "../shared/fonts";
import { initI18n } from "../shared/i18n";
import "./popup.css";
import { Popup } from "./Popup";

initI18n("ar");
installUiFonts(document, (path) => `/${path}`);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
