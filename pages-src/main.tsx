import { createRoot } from "react-dom/client";
import { DawnTowerGame } from "../app/game";
import "../app/globals.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Unable to find the game root element.");
}

createRoot(rootElement).render(<DawnTowerGame />);
