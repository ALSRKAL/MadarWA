import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "../shared/i18n";
import "./popup.css";
import { Popup } from "./Popup";

initI18n("ar");

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
