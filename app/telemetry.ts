export type GameEventType =
  | "page_view"
  | "game_start"
  | "game_complete"
  | "game_failed"
  | "game_reset"
  | "game_exit";

const SESSION_KEY = "chase-light-anonymous-session-v1";

function anonymousSessionId() {
  if (typeof window === "undefined") return "server";
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const generated = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(SESSION_KEY, generated);
  return generated;
}

export function reportGameEvent(eventType: GameEventType, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: anonymousSessionId(), eventType, payload }),
    keepalive: true,
  }).catch(() => undefined);
}
