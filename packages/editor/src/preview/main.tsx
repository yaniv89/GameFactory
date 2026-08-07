import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@forge/ds/dist/global.css";
import { PreviewApp } from "./PreviewApp";

const container = document.getElementById("preview-root");
if (!container) {
  throw new Error("forge-editor: #preview-root element not found in preview.html");
}

createRoot(container).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
