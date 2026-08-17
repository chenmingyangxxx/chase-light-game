import React from "react";
import { createRoot } from "react-dom/client";
import { DawnTowerGame } from "../../app/game";
import "../../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Desktop renderer root was not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <DawnTowerGame />
  </React.StrictMode>,
);
