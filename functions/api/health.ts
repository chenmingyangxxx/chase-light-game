import { json, type PagesHandler } from "../_shared";

export const onRequestGet: PagesHandler = async ({ env }) => {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: true, service: "chase-light-admin", database: "ready" });
  } catch {
    return json({ ok: false, service: "chase-light-admin", database: "unavailable" }, 503);
  }
};
