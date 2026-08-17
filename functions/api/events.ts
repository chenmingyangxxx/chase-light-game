import { json, readJson, text, type PagesHandler } from "../_shared";

const ALLOWED_EVENTS = new Set(["page_view", "game_start", "game_complete", "game_failed", "game_reset", "game_exit"]);

type EventRequest = { sessionId?: unknown; eventType?: unknown; payload?: unknown };

export const onRequestPost: PagesHandler = async ({ request, env }) => {
  try {
    const body = await readJson<EventRequest>(request);
    const sessionId = text(body.sessionId, 64);
    const eventType = text(body.eventType, 40);
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId) || !ALLOWED_EVENTS.has(eventType)) {
      return json({ error: "INVALID_EVENT" }, 400);
    }
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
    const payloadJson = JSON.stringify(payload).slice(0, 4_000);
    const userAgent = text(request.headers.get("user-agent"), 300);
    const country = text(request.headers.get("cf-ipcountry"), 8);
    await env.DB.prepare(
      "INSERT INTO events (session_id, event_type, payload_json, user_agent, country) VALUES (?, ?, ?, ?, ?)",
    ).bind(sessionId, eventType, payloadJson, userAgent, country).run();
    return json({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof Error && (error.message === "REQUEST_TOO_LARGE" || error instanceof SyntaxError)) {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    return json({ error: "EVENT_WRITE_FAILED" }, 500);
  }
};

export const onRequestOptions: PagesHandler = () => new Response(null, { status: 204, headers: { allow: "POST, OPTIONS" } });
