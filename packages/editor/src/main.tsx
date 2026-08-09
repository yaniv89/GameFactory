import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@forge/ds/dist/global.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("forge-editor: #root element not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
