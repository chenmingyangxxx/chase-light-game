import { json, requireAdmin, type PagesHandler } from "../../_shared";

const ALLOWED_TYPES = new Set(["page_view", "game_start", "game_complete", "game_failed", "game_reset", "game_exit"]);

type EventRow = { id: number; session_id: string; event_type: string; payload_json: string; country: string; created_at: string };

export const onRequestGet: PagesHandler = async (context) => {
  const denied = await requireAdmin(context);
  if (denied) return denied;
  try {
    const url = new URL(context.request.url);
    const requestedType = url.searchParams.get("type") || "";
    const eventType = ALLOWED_TYPES.has(requestedType) ? requestedType : "";
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit")) || 60));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const [rows, total] = await Promise.all([
      context.env.DB.prepare(`SELECT id, session_id, event_type, payload_json, country, created_at
        FROM events WHERE (? = '' OR event_type = ?) ORDER BY id DESC LIMIT ? OFFSET ?`)
        .bind(eventType, eventType, limit, offset).all<EventRow>(),
      context.env.DB.prepare("SELECT COUNT(*) AS count FROM events WHERE (? = '' OR event_type = ?)")
        .bind(eventType, eventType).first<{ count: number }>(),
    ]);
    return json({
      total: Number(total?.count || 0),
      events: (rows.results || []).map((row) => {
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(row.payload_json || "{}"); } catch { payload = {}; }
        return { id: row.id, sessionId: row.session_id, eventType: row.event_type, payload, country: row.country || "", createdAt: row.created_at };
      }),
    });
  } catch {
    return json({ error: "EVENTS_READ_FAILED" }, 500);
  }
};
