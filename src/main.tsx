import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import { useStore } from "./store";
import "./app.css";

if (import.meta.env.DEV) {
  (window as unknown as { __store?: typeof useStore }).__store = useStore;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
