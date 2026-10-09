import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "./index.css";
import App from "./App";
import { routeExternalLinks } from "./lib/external-links";

// In the desktop app, https links open in the system browser (6.1).
if (isTauri()) void import("@tauri-apps/plugin-opener").then(({ openUrl }) => routeExternalLinks((url) => openUrl(url)));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
