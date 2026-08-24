import React from "react";
import { createRoot } from "react-dom/client";
import GuessMyAnswer from "./GuessMyAnswer.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GuessMyAnswer />
  </React.StrictMode>
);

// Installable, and playable in a dead spot. Registered after load so it never
// competes with the first paint.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
