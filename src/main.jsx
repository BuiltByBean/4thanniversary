import React from "react";
import { createRoot } from "react-dom/client";
import GuessMyAnswer from "./GuessMyAnswer.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GuessMyAnswer />
  </React.StrictMode>
);
