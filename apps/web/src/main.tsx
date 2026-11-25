import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@astrolabe/ui/styles.css";
import "./app.css";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Astrolabe: #root element missing in index.html");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
