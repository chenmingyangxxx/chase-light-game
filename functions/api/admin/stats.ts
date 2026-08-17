import { json, requireAdmin, type PagesHandler } from "../../_shared";

type TotalRow = {
  total_events: number;
  total_sessions: number;
  starts: number;
  completions: number;
  failures: number;
  exits: number;
  today_events: number;
};

export const onRequestGet: PagesHandler = async (context) => {
  const denied = await requireAdmin(context);
  if (denied) return denied;
  try {
    const [summary, dailyResult, typeResult] = await Promise.all([
      context.env.DB.prepare(`SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT session_id) AS total_sessions,
        SUM(CASE WHEN event_type = 'game_start' THEN 1 ELSE 0 END) AS starts,
        SUM(CASE WHEN event_type = 'game_complete' THEN 1 ELSE 0 END) AS completions,
        SUM(CASE WHEN event_type = 'game_failed' THEN 1 ELSE 0 END) AS failures,
        SUM(CASE WHEN event_type = 'game_exit' THEN 1 ELSE 0 END) AS exits,
        SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END) AS today_events
        FROM events`).first<TotalRow>(),
      context.env.DB.prepare(`SELECT date(created_at) AS day,
        SUM(CASE WHEN event_type = 'game_start' THEN 1 ELSE 0 END) AS starts,
        SUM(CASE WHEN event_type = 'game_complete' THEN 1 ELSE 0 END) AS completions,
        SUM(CASE WHEN event_type = 'game_failed' THEN 1 ELSE 0 END) AS failures
        FROM events WHERE created_at >= datetime('now', '-13 days')
        GROUP BY date(created_at) ORDER BY day ASC`).all<Record<string, number | string>>(),
      context.env.DB.prepare("SELECT event_type, COUNT(*) AS count FROM events GROUP BY event_type ORDER BY count DESC").all<Record<string, number | string>>(),
    ]);
    const totals = summary || { total_events: 0, total_sessions: 0, starts: 0, completions: 0, failures: 0, exits: 0, today_events: 0 };
    const starts = Number(totals.starts || 0);
    const completions = Number(totals.completions || 0);
    return json({
      summary: {
        totalEvents: Number(totals.total_events || 0),
        totalSessions: Number(totals.total_sessions || 0),
        starts,
        completions,
        failures: Number(totals.failures || 0),
        exits: Number(totals.exits || 0),
        todayEvents: Number(totals.today_events || 0),
        completionRate: starts > 0 ? Math.round(completions / starts * 1000) / 10 : 0,
      },
      daily: (dailyResult.results || []).map((row) => ({ day: String(row.day), starts: Number(row.starts), completions: Number(row.completions), failures: Number(row.failures) })),
      eventTypes: (typeResult.results || []).map((row) => ({ eventType: String(row.event_type), count: Number(row.count) })),
    });
  } catch {
    return json({ error: "STATS_READ_FAILED" }, 500);
  }
};
