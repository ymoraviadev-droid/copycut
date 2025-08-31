import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "../index.css";
import { CommanderProvider } from "./store/CommanderContext";
import { invoke } from "@tauri-apps/api/core";

if (import.meta.env.VITE_DEVMODE! === "dev") {
  await invoke("toggle_devtools");
}


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CommanderProvider>
      <App />
    </CommanderProvider>
  </React.StrictMode>,
);
