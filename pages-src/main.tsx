import { createRoot } from "react-dom/client";
import { DawnTowerGame } from "../app/game";
import { AdminApp } from "./admin";
import "../app/globals.css";
import "./admin.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Unable to find the game root element.");
}

const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
const isAdminRoute = normalizedPath === "/admin" || normalizedPath.endsWith("/admin");

createRoot(rootElement).render(isAdminRoute ? <AdminApp /> : <DawnTowerGame />);
