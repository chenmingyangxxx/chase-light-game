import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Summary = {
  totalEvents: number;
  totalSessions: number;
  starts: number;
  completions: number;
  failures: number;
  exits: number;
  todayEvents: number;
  completionRate: number;
};

type DailyMetric = { day: string; starts: number; completions: number; failures: number };
type EventTypeMetric = { eventType: string; count: number };
type StatsResponse = { summary: Summary; daily: DailyMetric[]; eventTypes: EventTypeMetric[] };
type GameEvent = {
  id: number;
  sessionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  country: string;
  createdAt: string;
};

const EVENT_NAMES: Record<string, string> = {
  page_view: "访问首页",
  game_start: "开始游戏",
  game_complete: "完成任务",
  game_failed: "挑战失败",
  game_reset: "重新搭建",
  game_exit: "退出游戏",
};

const EMPTY_SUMMARY: Summary = {
  totalEvents: 0,
  totalSessions: 0,
  starts: 0,
  completions: 0,
  failures: 0,
  exits: 0,
  todayEvents: 0,
  completionRate: 0,
};

function eventName(type: string) {
  return EVENT_NAMES[type] ?? type;
}

function formatTime(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function shortSession(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

export function AdminApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [stats, setStats] = useState<StatsResponse>({ summary: EMPTY_SUMMARY, daily: [], eventTypes: [] });
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "追光｜运营管理";
  }, []);

  const loadDashboard = useCallback(async (eventType = "") => {
    setLoading(true);
    setError("");
    try {
      const query = eventType ? `?type=${encodeURIComponent(eventType)}` : "";
      const [statsResponse, eventsResponse] = await Promise.all([
        fetch("/api/admin/stats", { credentials: "same-origin", cache: "no-store" }),
        fetch(`/api/admin/events${query}`, { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (statsResponse.status === 401 || eventsResponse.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!statsResponse.ok || !eventsResponse.ok) throw new Error("后台数据暂时无法读取");
      const statsData = (await statsResponse.json()) as StatsResponse;
      const eventData = (await eventsResponse.json()) as { events: GameEvent[]; total: number };
      setStats(statsData);
      setEvents(eventData.events);
      setEventTotal(eventData.total);
      setAuthenticated(true);
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "后台数据暂时无法读取");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard("");
  }, [loadDashboard]);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || loggingIn) return;
    setLoggingIn(true);
    setLoginError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "密码不正确");
      }
      setPassword("");
      setAuthenticated(true);
      await loadDashboard("");
    } catch (loginFailure) {
      setLoginError(loginFailure instanceof Error ? loginFailure.message : "登录失败");
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
    setAuthenticated(false);
    setEvents([]);
  };

  const chartMaximum = useMemo(
    () => Math.max(1, ...stats.daily.flatMap((item) => [item.starts, item.completions, item.failures])),
    [stats.daily],
  );

  if (authenticated !== true) {
    return (
      <main className="admin-login-shell">
        <section className="admin-login-card" aria-labelledby="admin-login-title">
          <div className="admin-login-mark" aria-hidden="true"><span>99</span><i>m</i></div>
          <p className="admin-eyebrow">CHASE THE LIGHT · CONTROL</p>
          <h1 id="admin-login-title">追光运营后台</h1>
          <p className="admin-login-copy">查看匿名游玩数据、完成率与最近事件。</p>
          <form onSubmit={submitLogin}>
            <label htmlFor="admin-password">管理员密码</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="输入后台访问密码"
              disabled={loggingIn}
              autoFocus
            />
            {loginError && <p className="admin-form-error" role="alert">{loginError}</p>}
            <button type="submit" disabled={!password || loggingIn}>{loggingIn ? "验证中…" : "进入后台"}</button>
          </form>
          <a href="/">返回游戏</a>
        </section>
      </main>
    );
  }

  const summaryCards = [
    ["累计游玩", stats.summary.starts.toLocaleString("zh-CN"), "开始游戏次数"],
    ["独立会话", stats.summary.totalSessions.toLocaleString("zh-CN"), "匿名设备会话"],
    ["任务完成", stats.summary.completions.toLocaleString("zh-CN"), `完成率 ${stats.summary.completionRate}%`],
    ["挑战失败", stats.summary.failures.toLocaleString("zh-CN"), "失败事件总数"],
  ];

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span>追光</span><small>运营管理</small></div>
        <nav aria-label="后台导航"><a className="active" href="#overview">数据概览</a><a href="#events">事件记录</a></nav>
        <div className="admin-sidebar-actions"><a href="/">打开游戏</a><button type="button" onClick={() => void logout()}>退出后台</button></div>
      </aside>
      <section className="admin-workspace">
        <header className="admin-topbar">
          <div><p>CONTROL CENTER</p><h1>运营数据概览</h1></div>
          <div className="admin-refresh-group">
            <span>{lastUpdated ? `更新于 ${lastUpdated.toLocaleTimeString("zh-CN", { hour12: false })}` : "正在同步"}</span>
            <button type="button" onClick={() => void loadDashboard(filter)} disabled={loading}>{loading ? "同步中…" : "刷新数据"}</button>
          </div>
        </header>
        {error && <div className="admin-alert" role="alert">{error}</div>}
        <section id="overview" className="admin-summary-grid" aria-label="核心数据">
          {summaryCards.map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
        </section>
        <section className="admin-chart-grid">
          <article className="admin-panel admin-daily-panel">
            <header><div><span>最近 14 天</span><h2>游玩趋势</h2></div><div className="admin-chart-legend"><i className="start" />开始<i className="complete" />完成<i className="failure" />失败</div></header>
            <div className="admin-bar-chart" aria-label="最近十四天游玩趋势">
              {stats.daily.length === 0 && <p className="admin-empty">等待第一批游玩数据</p>}
              {stats.daily.map((day) => (
                <div className="admin-bar-day" key={day.day} title={`${day.day}：开始 ${day.starts}，完成 ${day.completions}，失败 ${day.failures}`}>
                  <div className="admin-bars"><i className="start" style={{ height: `${Math.max(3, day.starts / chartMaximum * 100)}%` }} /><i className="complete" style={{ height: `${Math.max(3, day.completions / chartMaximum * 100)}%` }} /><i className="failure" style={{ height: `${Math.max(3, day.failures / chartMaximum * 100)}%` }} /></div>
                  <small>{day.day.slice(5)}</small>
                </div>
              ))}
            </div>
          </article>
          <article className="admin-panel admin-funnel-panel">
            <header><div><span>玩家旅程</span><h2>关键事件</h2></div></header>
            <div className="admin-event-types">
              {stats.eventTypes.length === 0 && <p className="admin-empty">暂无事件</p>}
              {stats.eventTypes.map((item) => <div key={item.eventType}><span>{eventName(item.eventType)}</span><strong>{item.count}</strong></div>)}
            </div>
          </article>
        </section>
        <section id="events" className="admin-panel admin-events-panel">
          <header>
            <div><span>最近记录</span><h2>游戏事件</h2></div>
            <label>筛选事件<select value={filter} onChange={(event) => { setFilter(event.target.value); void loadDashboard(event.target.value); }}><option value="">全部事件</option>{Object.entries(EVENT_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </header>
          <div className="admin-table-wrap">
            <table><thead><tr><th>事件</th><th>匿名会话</th><th>地区</th><th>补充信息</th><th>时间</th></tr></thead><tbody>
              {events.map((item) => <tr key={item.id}><td><span className={`admin-event-badge ${item.eventType}`}>{eventName(item.eventType)}</span></td><td title={item.sessionId}>{shortSession(item.sessionId)}</td><td>{item.country || "—"}</td><td>{Object.keys(item.payload).length ? JSON.stringify(item.payload) : "—"}</td><td>{formatTime(item.createdAt)}</td></tr>)}
            </tbody></table>
            {events.length === 0 && <p className="admin-empty">当前筛选条件下没有记录</p>}
          </div>
          <footer>共 {eventTotal.toLocaleString("zh-CN")} 条记录 · 当前显示最近 {events.length} 条</footer>
        </section>
      </section>
    </main>
  );
}
