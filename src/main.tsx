import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "../index.css";
import { CommanderProvider } from "./store/CommanderContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CommanderProvider>
      <App />
    </CommanderProvider>
  </React.StrictMode>,
);
