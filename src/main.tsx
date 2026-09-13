import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Box,
  ChevronRight,
  Clock,
  Database,
  Globe,
  Layers,
  LayoutDashboard,
  LockKeyhole,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  Workflow,
  Zap,
  Bell,
  Radio,
  GitBranch,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import "./style.css";
type Series = { name: string; values: [number, string][] };
type Metric = {
  id: string;
  title: string;
  unit: string;
  series: Series[];
  state: string;
  error?: string;
};
type Service = {
  id: string;
  name: string;
  description: string;
  status: string;
  latencyMs: number | null;
};
type Overview = {
  updatedAt: string;
  metrics: Metric[];
  services: Service[];
  release: string;
};
type Catalog = {
  id: string;
  title: string;
  application: string;
  panelCount: number;
};
const wiki = "https://localserver.wiki.ramideltoro.com";
const menu = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "applications", name: "Applications", icon: Layers },
  { id: "local", name: "Local server", icon: Server },
  { id: "nutsnews", name: "NutsNews", icon: Globe },
  { id: "ramideltoro", name: "Rami Del Toro", icon: Globe },
  { id: "showalgo", name: "ShowAlgo", icon: Globe },
  { id: "alerts", name: "Alerts", icon: Bell },
  { id: "logs", name: "Logs", icon: Terminal },
  { id: "traces", name: "Traces", icon: Workflow },
  { id: "deployments", name: "Deployments", icon: GitBranch },
  { id: "backups", name: "Backups", icon: Database },
];
function format(v: number | undefined, unit = "short") {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (unit === "percent" || unit === "percentunit")
    return (unit === "percentunit" ? v * 100 : v).toFixed(1) + "%";
  if (unit === "bytes" || unit === "Bps") {
    const i = Math.min(
      3,
      Math.max(0, Math.floor(Math.log(Math.max(v, 1)) / Math.log(1024))),
    );
    return (
      (v / 1024 ** i).toFixed(1) +
      " " +
      ["B", "KiB", "MiB", "GiB"][i] +
      (unit === "Bps" ? "/s" : "")
    );
  }
  if (unit === "s" && v > 86400) return (v / 86400).toFixed(1) + " days";
  if (unit === "s") return v.toFixed(1) + " s";
  if (unit === "ms") return v.toFixed(0) + " ms";
  return new Intl.NumberFormat("en", {
    notation: v > 10000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(v);
}
function Plot({
  metric,
  compact = false,
}: {
  metric: Metric;
  compact?: boolean;
}) {
  const rows = new Map<number, Record<string, number>>();
  metric.series.slice(0, 6).forEach((s, i) =>
    s.values.forEach(([t, v]) => {
      const r = rows.get(t) || { time: t };
      r["s" + i] = Number(v);
      rows.set(t, r);
    }),
  );
  const data = [...rows.values()].sort((a, b) => a.time - b.time);
  const colors = [
    "#d28a19",
    "#6f9b78",
    "#557fb0",
    "#b27c99",
    "#8676b8",
    "#af906c",
  ];
  if (!data.length)
    return (
      <div className="empty-chart">
        <Radio size={18} />
        <span>
          {metric.state === "stale"
            ? "Telemetry is stale"
            : "No telemetry in this time range"}
        </span>
      </div>
    );
  return (
    <ResponsiveContainer width="100%" height={compact ? 62 : 205}>
      <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {colors.map((c, i) => (
            <linearGradient
              key={c}
              id={`g-${metric.id}-${i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={c} stopOpacity={0.2} />
              <stop offset="100%" stopColor={c} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {!compact && (
          <>
            <CartesianGrid
              stroke="#ece8e0"
              strokeDasharray="3 4"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              tickFormatter={(t) =>
                new Date(t * 1000).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              tick={{ fontSize: 10, fill: "#8c8578" }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              width={52}
              tick={{ fontSize: 10, fill: "#8c8578" }}
              tickFormatter={(v) => format(v, metric.unit)}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              labelFormatter={(t) =>
                new Date(Number(t) * 1000).toLocaleString()
              }
              formatter={(v) => format(Number(v), metric.unit)}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid #e7e0d2",
                fontSize: 12,
              }}
            />
          </>
        )}
        {metric.series.slice(0, 6).map((s, i) => (
          <Area
            key={i}
            name={s.name}
            dataKey={"s" + i}
            type="monotone"
            stroke={colors[i]}
            strokeWidth={1.8}
            fill={`url(#g-${metric.id}-${i})`}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
async function api<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (r.status === 401) {
    location.assign(
      "/auth/google?returnTo=" + encodeURIComponent("/owner/" + location.hash),
    );
    throw Error("Please sign in with Google to continue");
  }
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw Error(
      "The service could not return data. Please refresh or sign in again.",
    );
  const j = await r.json();
  if (!r.ok) throw Error(j.error || "Unable to load data");
  return j;
}
function MetricCard({ metric }: { metric: Metric }) {
  const v = metric.series[0]?.values.at(-1)?.[1];
  return (
    <article className="metric-card">
      <div className="card-top">
        <span>{metric.title}</span>
        <span className={"dot " + metric.state} />
      </div>
      <strong>
        {format(v === undefined ? undefined : Number(v), metric.unit)}
      </strong>
      <Plot metric={metric} compact />
      <div className="metric-caption">
        {metric.state === "live"
          ? "Latest measured value"
          : metric.state === "stale"
            ? "Last sample is out of date"
            : "Awaiting source data"}
      </div>
    </article>
  );
}
type HostSnapshot = {
  timestamp: string;
  services: {
    unit: string;
    ActiveState: string;
    SubState?: string;
    MainPID?: string;
    NRestarts?: string;
    MemoryCurrent?: string;
  }[];
  processes: {
    pid: number;
    name: string;
    cpu: number;
    memoryPercent: number;
    rssBytes: number;
  }[];
  timers: string;
};
function App() {
  const owner = location.pathname.startsWith("/owner");
  const [tab, setTab] = useState(location.hash.slice(1) || "overview");
  const [range, setRange] = useState("1h");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [selected, setSelected] = useState("");
  const [panels, setPanels] = useState<Metric[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [logFilter, setLogFilter] = useState("");
  const [logApp, setLogApp] = useState("nutsnews");
  const [traceNote, setTraceNote] = useState("");
  const [host, setHost] = useState<HostSnapshot | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setRefresh((r) => r + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    api<Overview>("/api/public/overview?range=" + range, c.signal)
      .then((d) => {
        setOverview(d);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [range, refresh]);
  useEffect(() => {
    if (owner && tab === "local")
      api<HostSnapshot>("/api/owner/host")
        .then(setHost)
        .catch((e) => setDetailError(e.message));
  }, [owner, tab, refresh]);
  useEffect(() => {
    if (owner)
      api<Catalog[]>("/api/owner/catalog")
        .then(setCatalog)
        .catch((e) => setDetailError(e.message));
  }, [owner]);
  useEffect(() => {
    location.hash = tab;
    setSelected("");
    setSearch("");
    setPanels([]);
    setRecords([]);
    setDetailError("");
  }, [tab]);
  useEffect(() => {
    if (!owner) return;
    const c = new AbortController();
    setDetailError("");
    if (selected) {
      setDetailLoading(true);
      api<{ panels: Metric[] }>(
        "/api/owner/dashboard/" + selected + "?range=" + range,
        c.signal,
      )
        .then((d) => setPanels(d.panels))
        .catch((e) => {
          if (e.name !== "AbortError") setDetailError(e.message);
        })
        .finally(() => setDetailLoading(false));
    } else if (["alerts", "logs", "traces"].includes(tab)) {
      setDetailLoading(true);
      api<unknown>(
        "/api/owner/" +
          tab +
          "?range=" +
          range +
          "&application=" +
          logApp +
          "&search=" +
          encodeURIComponent(logFilter),
        c.signal,
      )
        .then((d) => {
          if (tab === "alerts") setRecords(d as Record<string, unknown>[]);
          else if (tab === "logs")
            setRecords((d as { entries: Record<string, unknown>[] }).entries);
          else {
            const j = d as { traces: Record<string, unknown>[]; note?: string };
            setRecords(j.traces);
            setTraceNote(j.note || "");
          }
        })
        .catch((e) => {
          if (e.name !== "AbortError") setDetailError(e.message);
        })
        .finally(() => setDetailLoading(false));
    }
    return () => c.abort();
  }, [owner, selected, range, tab, refresh, logFilter, logApp]);
  const navigate = (t: string) => setTab(t);
  const metrics = overview?.metrics || [];
  const services = overview?.services || [];
  const healthy = services.filter((s) => s.status === "healthy").length;
  const privateTab = [
    "alerts",
    "logs",
    "traces",
    "deployments",
    "backups",
  ].includes(tab);
  const visibleCatalog = catalog.filter(
    (d) =>
      (tab === "local"
        ? d.application === "local"
        : ["nutsnews", "ramideltoro", "showalgo"].includes(tab)
          ? d.application === tab
          : tab === "backups"
            ? /backup|restore/i.test(d.title)
            : tab === "deployments"
              ? /ownership|runtime|systemd/i.test(d.title)
              : true) && d.title.toLowerCase().includes(search.toLowerCase()),
  );
  const title = menu.find((m) => m.id === tab)?.name || "Overview";
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Activity size={22} />
          </span>
          <span>
            observe<span className="brand-sub">PERSONAL INFRASTRUCTURE</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">R</span>
          <div>
            Rami's workspace<small>Infrastructure & applications</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {menu.map(({ id, name, icon: Icon }) => (
            <button
              className={tab === id ? "nav-item active" : "nav-item"}
              key={id}
              onClick={() => navigate(id)}
            >
              <Icon size={17} />
              <span>{name}</span>
              {id === "overview" && <span className="nav-count">4</span>}
              {["alerts", "logs", "traces"].includes(id) && !owner && (
                <LockKeyhole size={11} />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href={wiki} target="_blank" rel="noreferrer">
            <BookOpen size={17} />
            Documentation
            <ArrowUpRight size={14} />
          </a>
          <div className="connection">
            <span className={"dot " + (error ? "unavailable" : "live")} />
            <span>
              Grafana Cloud<small>Central telemetry source</small>
            </span>
          </div>
          {owner && (
            <form action="/auth/logout" method="post">
              <button type="submit">Sign out</button>
            </form>
          )}
          <a className="owner-link" href={owner ? "/" : "/auth/google"}>
            <ShieldCheck size={17} />
            {owner ? "Owner view · return to public" : "Sign in with Google"}
          </a>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>{title}</span>
          </div>
          <div className="topbar-right">
            <span className="public-tag">
              <Globe size={12} />
              {owner ? "Owner workspace" : "Public overview"}
            </span>
            <span className="avatar">R</span>
          </div>
        </header>
        <div className="content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">YOUR SYSTEMS, IN ONE PLACE</div>
              <h1>{title === "Overview" ? "Everything in view." : title}</h1>
              <p>
                {tab === "overview"
                  ? "A clear picture of your infrastructure and the applications it powers."
                  : tab === "local"
                    ? "Hardware, services, and the Qwen inference server."
                    : tab === "nutsnews"
                      ? "From the public website to workers, queues, and databases."
                      : "Follow the signals. Understand what changed."}
              </p>
            </div>
            <div className="heading-controls">
              <label className="range">
                <Clock size={15} />
                <select
                  aria-label="Time range"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                >
                  <option value="1h">Last hour</option>
                  <option value="6h">Last 6 hours</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                </select>
              </label>
              <button
                className="refresh"
                onClick={() => setRefresh((r) => r + 1)}
                aria-label="Refresh telemetry"
              >
                <RefreshCw size={16} className={loading ? "spinning" : ""} />
              </button>
            </div>
          </section>
          {error && (
            <div role="alert" className="notice error">
              {error}. Previously loaded data may be stale.
            </div>
          )}
          {(!privateTab || owner) && !selected && (
            <>
              <section className="health-banner">
                <div className="health-icon">
                  <Activity size={22} />
                </div>
                <div>
                  <strong>
                    {!overview
                      ? "Connecting to your systems"
                      : healthy === services.length
                        ? "Public endpoints are responding"
                        : `${healthy} of ${services.length} public endpoints responding`}
                  </strong>
                  <p>
                    Endpoint reachability · resource and worker health shown
                    separately
                  </p>
                </div>
                <div className="live-label">
                  <span
                    className={"dot " + (overview ? "live" : "unavailable")}
                  />
                  {overview ? "LIVE" : "CONNECTING"}
                  <small>
                    {overview
                      ? "Updated " +
                        new Date(overview.updatedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Fetching real telemetry"}
                  </small>
                </div>
              </section>
              {[
                "overview",
                "local",
                "nutsnews",
                "ramideltoro",
                "showalgo",
                "applications",
              ].includes(tab) && (
                <>
                  <div className="section-heading">
                    <h2>
                      {["ramideltoro", "showalgo"].includes(tab)
                        ? "Website telemetry"
                        : tab === "nutsnews"
                          ? "Application resources"
                          : "Local server at a glance"}
                    </h2>
                    <span className="subtle">
                      {range === "1h"
                        ? "60-minute history"
                        : "Selected time range"}
                    </span>
                  </div>
                  <section className="metric-grid">
                    {(["nutsnews", "ramideltoro", "showalgo"].includes(tab)
                      ? metrics.filter((m) => m.id.startsWith(tab))
                      : metrics.slice(0, 4)
                    ).map((m) => (
                      <MetricCard key={m.id} metric={m} />
                    ))}
                    {!overview &&
                      [1, 2, 3, 4].map((n) => (
                        <div key={n} className="metric-card skeleton" />
                      ))}
                  </section>
                </>
              )}
              {[
                "overview",
                "applications",
                "nutsnews",
                "ramideltoro",
                "showalgo",
                "local",
              ].includes(tab) && (
                <>
                  <div className="section-heading">
                    <h2>Your applications</h2>
                    <span className="subtle">Live endpoint checks</span>
                  </div>
                  <section className="service-grid">
                    {services
                      .filter((s) =>
                        tab === "local"
                          ? s.id === "qwen"
                          : ["ramideltoro", "showalgo"].includes(tab)
                            ? s.id === tab
                            : tab === "nutsnews"
                              ? ["nutsnews", "backend", "qwen"].includes(s.id)
                              : true,
                      )
                      .map((s) => (
                        <article className="service-card" key={s.id}>
                          <div className="service-top">
                            <span className={"service-icon " + s.id}>
                              {s.id === "qwen" ? (
                                <Zap size={20} />
                              ) : s.id === "backend" ? (
                                <Database size={20} />
                              ) : (
                                <Globe size={20} />
                              )}
                            </span>
                            <span className={"status " + s.status}>
                              {s.status}
                            </span>
                          </div>
                          <h3>{s.name}</h3>
                          <p>{s.description}</p>
                          <div className="service-bottom">
                            <span>
                              {s.latencyMs === null
                                ? "No response"
                                : s.latencyMs + " ms"}{" "}
                              <small>HTTP check</small>
                            </span>
                            <button
                              aria-label={"Explore " + s.name}
                              onClick={() =>
                                navigate(
                                  s.id === "qwen"
                                    ? "local"
                                    : s.id === "backend"
                                      ? "nutsnews"
                                      : s.id,
                                )
                              }
                            >
                              <ArrowUpRight size={19} />
                            </button>
                          </div>
                        </article>
                      ))}
                  </section>
                </>
              )}
              {tab === "overview" && (
                <section className="lower-grid">
                  <article className="chart-panel">
                    <div className="section-heading">
                      <h2>Resource activity</h2>
                      <span className="subtle">CPU utilization</span>
                    </div>
                    {metrics[0] && <Plot metric={metrics[0]} />}
                  </article>
                  <article className="wiki-callout">
                    <span className="callout-icon">
                      <BookOpen size={23} />
                    </span>
                    <span className="eyebrow">
                      UNDERSTAND YOUR INFRASTRUCTURE
                    </span>
                    <h2>
                      Every system.
                      <br />A clear explanation.
                    </h2>
                    <p>
                      From the big picture to the decisions behind it. Read the
                      wiki your way.
                    </p>
                    <div className="reading-tags">
                      <span>Summary</span>
                      <span>Technical</span>
                      <span>Expert</span>
                    </div>
                    <a href={wiki} target="_blank" rel="noreferrer">
                      Explore the wiki <ArrowUpRight size={17} />
                    </a>
                  </article>
                </section>
              )}
            </>
          )}
          {privateTab && !owner && (
            <section className="locked-panel">
              <span className="lock-circle">
                <LockKeyhole size={27} />
              </span>
              <h2>Your investigation workspace</h2>
              <p>
                Sign in to explore detailed {title.toLowerCase()}, internal
                service health, and operational diagnostics.
              </p>
              <a
                className="primary"
                href={
                  "/auth/google?returnTo=" +
                  encodeURIComponent("/owner/#" + tab)
                }
              >
                Sign in with Google <ArrowUpRight size={16} />
              </a>
              <small>Public health remains available without signing in.</small>
            </section>
          )}
          {["ramideltoro", "showalgo"].includes(tab) && (
            <p className="notice">
              HTTPS checks run every minute from the local server. Response time
              measures arrival of HTTP headers, not browser page speed.
              Availability is a rolling one-hour measure over collected samples.
              Visitor analytics, application logs, and hosting resource metrics
              are not connected.
            </p>
          )}
          {!owner &&
            ["local", "nutsnews", "ramideltoro", "showalgo"].includes(tab) && (
              <div className="owner-callout">
                <ShieldCheck size={21} />
                <div>
                  <strong>Go deeper with owner access</strong>
                  <p>
                    {["ramideltoro", "showalgo"].includes(tab)
                      ? "Inspect HTTPS availability, timing, certificate expiry, and collection freshness."
                      : "Explore service metrics, individual processes, worker stages, databases, and logs."}
                  </p>
                </div>
                <a
                  href={
                    "/auth/google?returnTo=" +
                    encodeURIComponent("/owner/#" + tab)
                  }
                >
                  Open diagnostics <ArrowUpRight size={15} />
                </a>
              </div>
            )}
          {owner && tab === "local" && host && !selected && (
            <section className="records-panel">
              <div className="section-heading">
                <h2>Live service & process diagnostics</h2>
                <span className="subtle">
                  {new Date(host.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>State</th>
                      <th>PID</th>
                      <th>Restarts</th>
                      <th>Memory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {host.services.map((s) => (
                      <tr key={s.unit}>
                        <td>{s.unit}</td>
                        <td>
                          <span
                            className={
                              "status " +
                              (s.ActiveState === "active"
                                ? "healthy"
                                : "degraded")
                            }
                          >
                            {s.ActiveState}
                          </span>
                        </td>
                        <td>{s.MainPID || "—"}</td>
                        <td>{s.NRestarts || "0"}</td>
                        <td>{format(Number(s.MemoryCurrent), "bytes")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Top 20 processes by resident memory</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Process</th>
                        <th>PID</th>
                        <th>CPU lifetime average</th>
                        <th>Resident memory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {host.processes.map((p) => (
                        <tr key={p.pid}>
                          <td>{p.name}</td>
                          <td>{p.pid}</td>
                          <td>{p.cpu}%</td>
                          <td>{format(p.rssBytes, "bytes")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <details>
                <summary>Systemd timer schedules</summary>
                <pre className="timers">{host.timers}</pre>
              </details>
            </section>
          )}
          {owner && (
            <>
              {detailError && (
                <div role="alert" className="notice error">
                  {detailError}
                </div>
              )}
              {!selected &&
                [
                  "overview",
                  "local",
                  "nutsnews",
                  "ramideltoro",
                  "showalgo",
                  "applications",
                  "backups",
                  "deployments",
                ].includes(tab) && (
                  <>
                    <div className="section-heading">
                      <h2>
                        Investigation library{" "}
                        <span className="number">{visibleCatalog.length}</span>
                      </h2>
                      <label className="search">
                        <Search size={15} />
                        <input
                          aria-label="Search dashboards"
                          placeholder="Find a dashboard…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="dashboard-grid">
                      {visibleCatalog.map((d) => (
                        <button
                          className="dashboard-card"
                          key={d.id}
                          onClick={() => {
                            if (d.panelCount) setSelected(d.id);
                            else {
                              setLogApp(
                                d.application === "local"
                                  ? "local"
                                  : "nutsnews",
                              );
                              navigate("logs");
                            }
                          }}
                        >
                          <div>
                            <Box size={18} />
                            <span>
                              {d.application === "local"
                                ? "LOCAL SERVER"
                                : d.application.toUpperCase()}
                            </span>
                          </div>
                          <h3>{d.title.replace(/^NutsNews /, "")}</h3>
                          <span>
                            {d.panelCount
                              ? `${d.panelCount} metric panels`
                              : "Log explorer"}{" "}
                            <ArrowUpRight size={16} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              {selected && (
                <>
                  <button className="back" onClick={() => setSelected("")}>
                    ← Back to dashboards
                  </button>
                  <h2>{catalog.find((d) => d.id === selected)?.title}</h2>
                  {detailLoading && (
                    <div className="notice">Updating dashboard…</div>
                  )}
                  <div className="panels">
                    {panels.map((p) => (
                      <article className="chart-panel" key={p.id}>
                        <div className="section-heading">
                          <h3>{p.title}</h3>
                          <span className={"status " + p.state}>{p.state}</span>
                        </div>
                        <Plot metric={p} />
                        {p.series.length > 1 && (
                          <details>
                            <summary>{p.series.length} series</summary>
                            {p.series.map((s, i) => (
                              <p className="series-name" key={i}>
                                {s.name}
                              </p>
                            ))}
                          </details>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              )}
              {["alerts", "logs", "traces"].includes(tab) && !selected && (
                <section className="records-panel">
                  <div className="section-heading">
                    <h2>{title}</h2>
                    {tab === "logs" && (
                      <form
                        className="log-controls"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setLogFilter(search);
                        }}
                      >
                        <select
                          aria-label="Log application"
                          value={logApp}
                          onChange={(e) => setLogApp(e.target.value)}
                        >
                          <option value="nutsnews">NutsNews</option>
                          <option value="local">Local server</option>
                        </select>
                        <input
                          placeholder="Search log text"
                          aria-label="Search log text"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <button>Search</button>
                      </form>
                    )}
                  </div>
                  {detailLoading && (
                    <p className="subtle">Fetching telemetry…</p>
                  )}
                  {!detailLoading && !records.length && (
                    <div className="empty-state">
                      <Radio size={25} />
                      <h3>
                        {detailError
                          ? "Source unavailable"
                          : "No matching records"}
                      </h3>
                      <p>
                        {tab === "traces"
                          ? traceNote ||
                            "No traces were returned for this time range."
                          : tab === "alerts"
                            ? "No active alerts returned by this alert source."
                            : "Try a different time range or search."}
                      </p>
                    </div>
                  )}
                  {records.map((r, i) => (
                    <article className="record" key={i}>
                      {Object.entries(r)
                        .filter(([, v]) => v !== null && v !== undefined)
                        .map(([k, v]) => (
                          <div key={k}>
                            <span>{k}</span>
                            <code>
                              {typeof v === "object"
                                ? JSON.stringify(v)
                                : String(v)}
                            </code>
                          </div>
                        ))}
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
          <footer>
            <span>
              <span className="dot live" /> Powered by real telemetry ·
              refreshes every 30 seconds
            </span>
            <a
              href="https://github.com/ramideltoro/local-server-observability"
              target="_blank"
              rel="noreferrer"
            >
              Source & releases <ArrowUpRight size={12} />
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
