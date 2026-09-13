import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Menu,
  X,
  ChevronRight,
  ArrowUpRight,
  Search,
  Server,
  LayoutDashboard,
  AlertTriangle,
  Clock,
  Bell,
} from "lucide-react";
import "./workspace.css";
type Metric = {
  id: string;
  title: string;
  unit: string;
  state: string;
  series: { values: [number, string][] }[];
};
type Inventory = {
  servers: {
    id: string;
    name: string;
    applications: string[];
    services: string[];
    sources: string[];
    evidence: string;
    limitation?: string;
  }[];
  applications: { id: string; name: string; coverage: string }[];
};
type Dashboard = {
  id: string;
  title: string;
  source: string;
  panels: number;
  restricted: number;
  publicPath?: string;
  ownerPath?: string;
  cloudUrl?: string;
  limitation: string;
};
type Issue = {
  id: string;
  system: string;
  summary: string;
  status: string;
  severity: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  history: { at: string; status: string }[];
};
type Report = {
  id: string;
  at: string;
  summary: string;
  delaySeconds: number;
  checks: {
    system: string;
    id: string;
    complete: boolean;
    note: string;
    failures: unknown[];
  }[];
  ai: { note: string };
};
type Rule = {
  id: string;
  name: string;
  system: string;
  severity: string;
  source: string;
  state: string;
  enabled: boolean;
  paused: boolean;
  silenced: boolean;
  intervalSeconds: number | null;
  pending: string;
  lastEvaluation: string | null;
  lookbackSeconds: number[];
  thresholds: { operator: string; values: number[] }[];
  purpose: string;
  signal: string;
  evaluationNote: string;
};
function useData<T>(url: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!url) return;
    let live = true;
    const load = () =>
      fetch(url)
        .then(async (r) => {
          if (!r.ok) throw Error("Data source unavailable");
          return r.json();
        })
        .then((d) => {
          if (live) {
            setData(d);
            setError("");
          }
        })
        .catch(() => {
          if (live)
            setError(
              "Data source unavailable. Previously loaded values may be stale.",
            );
        });
    load();
    const timer = setInterval(load, 60000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url]);
  return { data, error };
}
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString() : "Not reported";
function value(m?: Metric) {
  const vals = m?.series.flatMap((s) => s.values) || [];
  const n = Number(vals.at(-1)?.[1]);
  return !vals.length || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString(undefined, { maximumFractionDigits: 1 }) +
        (m?.unit === "percent" ? "%" : m?.unit === "s" ? " s" : "");
}
export default function Workspace() {
  const [page, setPage] = useState(location.hash.slice(1) || "overview"),
    [drawer, setDrawer] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [notice, setNotice] = useState(""),
    [publishUid, setPublishUid] = useState("");
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const owner = location.pathname.startsWith("/owner");
  const { data: mine } = useData<{
    dashboards: { id: string; title: string; url: string }[];
  }>(owner ? "/api/owner/workspace" : "");
  const { data: inventory } = useData<Inventory>("/api/public/inventory");
  const { data: overview, error } = useData<{
    metrics: Metric[];
    services: { id: string; name: string; status: string }[];
    updatedAt: string;
  }>("/api/public/overview");
  const { data: catalog } = useData<{
    dashboards: Dashboard[];
    cloudCount: number;
    updatedAt: string;
  }>("/api/public/dashboards");
  const { data: issues } = useData<Issue[]>("/api/public/issues");
  const { data: reports } = useData<{ reports: Report[]; overdue: boolean }>(
    "/api/public/reports",
  );
  const { data: alerts, error: alertError } = useData<{ rules: Rule[] }>(
    "/api/public/rules",
  );
  useEffect(() => {
    const go = () => {
      setPage(location.hash.slice(1) || "overview");
      setDrawer(false);
      setSearch("");
      setFilter("all");
    };
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  useEffect(() => {
    if (!drawer) return;
    sidebar.current?.querySelector<HTMLButtonElement>(".ws-close")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const focusable = Array.from(
          sidebar.current?.querySelectorAll<HTMLElement>("a,button,summary") ||
            [],
        );
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
      if (e.key === "Escape") {
        setDrawer(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [drawer]);
  const active = issues?.filter((i) => i.status !== "Remediated") || [],
    selected = inventory?.servers.find((s) => page === "server/" + s.id),
    app = inventory?.applications.find((a) => page === "app/" + a.id),
    dashboard = catalog?.dashboards.find((d) => page === "dashboard/" + d.id);
  const title =
    selected?.name ||
    app?.name ||
    dashboard?.title ||
    {
      overview: "Fleet overview",
      dashboards: "All dashboards",
      issues: "Issues",
      reports: "Daily reports",
      alerts: "Alert rules",
      workspace: "My dashboards",
    }[page] ||
    "Fleet overview";
  const nav = (id: string, label: string, Icon = ChevronRight) => (
    <a
      className={page === id ? "selected" : ""}
      aria-current={page === id ? "page" : undefined}
      href={"#" + id}
    >
      <Icon size={17} />
      {label}
    </a>
  );
  const dashboardList = (list: Dashboard[]) => (
    <div className="ws-list">
      {list.map((d) => (
        <div className="ws-dashboard" key={d.id}>
          <div>
            <a href={"#dashboard/" + d.id}>{d.title}</a>
            <p>
              {d.panels} panels · {d.source}
              {d.restricted > 0 ? " · " + d.restricted + " restricted" : ""}
            </p>
          </div>
          <ArrowUpRight size={18} />
        </div>
      ))}
    </div>
  );
  return (
    <div className="ws">
      <a
        className="skip"
        href="#workspace-main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("workspace-main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="ws-mobile">
        <button
          ref={menuButton}
          aria-label="Open navigation"
          aria-expanded={drawer}
          onClick={() => setDrawer(!drawer)}
        >
          <Menu />
        </button>
        <strong>
          Observe<span> / fleet</span>
        </strong>
      </header>
      {drawer && (
        <button
          className="ws-scrim"
          aria-label="Close navigation"
          onClick={() => {
            setDrawer(false);
            menuButton.current?.focus();
          }}
        />
      )}
      <aside
        ref={sidebar}
        className={"ws-sidebar " + (drawer ? "open" : "")}
        aria-label="Main navigation"
      >
        <a href="#overview" className="ws-brand">
          <Activity /> Observe<span>Infrastructure workspace</span>
        </a>
        <button
          className="ws-close"
          aria-label="Close navigation"
          onClick={() => {
            setDrawer(false);
            menuButton.current?.focus();
          }}
        >
          <X />
        </button>
        <nav>
          {nav("overview", "Overview", Activity)}
          <p className="ws-nav-label">Servers & applications</p>
          {inventory?.servers.map((s) => (
            <details key={s.id} open={selected?.id === s.id || undefined}>
              <summary>
                <Server size={15} />
                {s.name}
              </summary>
              <div>
                {nav("server/" + s.id, "Server overview")}
                {s.applications.map((id) =>
                  nav(
                    "app/" + id,
                    inventory.applications.find((a) => a.id === id)?.name || id,
                  ),
                )}
              </div>
            </details>
          ))}
          <div className="ws-nav-shared">
            {nav("dashboards", "All dashboards", LayoutDashboard)}
            {nav("issues", "Issues", AlertTriangle)}
            {nav("reports", "Daily reports", Clock)}
            {nav("alerts", "Alert rules", Bell)}
            {owner && nav("workspace", "My dashboards", LayoutDashboard)}
          </div>
        </nav>
        <footer>
          <a href="https://localserver.wiki.ramideltoro.com">
            Documentation <ArrowUpRight size={13} />
          </a>
          {owner ? (
            <form action="/auth/logout" method="post">
              <button>Sign out</button>
            </form>
          ) : (
            <a href="/auth/google">
              Sign in with Google <ArrowUpRight size={13} />
            </a>
          )}
        </footer>
      </aside>
      <main
        inert={drawer}
        id="workspace-main"
        className="ws-main"
        tabIndex={-1}
      >
        <div className="ws-heading">
          <div>
            <p className="ws-eyebrow">
              OBSERVABILITY / {owner ? "OWNER WORKSPACE" : "PUBLIC VIEW"}
            </p>
            <h1>{title}</h1>
          </div>
          <span className="ws-updated">
            {overview
              ? "Updated " + new Date(overview.updatedAt).toLocaleTimeString()
              : "Connecting to telemetry…"}
          </span>
        </div>
        {notice && <p role="status">{notice}</p>}
        {error && <p className="ws-warning">{error}</p>}
        {page === "overview" && (
          <>
            <div className="ws-summary">
              <span>
                <strong>
                  {inventory?.servers.filter((s) => s.services.length > 0)
                    .length || "—"}
                </strong>{" "}
                servers
              </span>
              <span>
                <strong>{inventory?.applications.length || "—"}</strong>{" "}
                applications
              </span>
              <a href="#issues">
                <strong>{active.length}</strong> current issues
              </a>
              <a href="#dashboards">
                <strong>{catalog?.dashboards.length || "—"}</strong> dashboards
              </a>
            </div>
            {active.length > 0 && (
              <div className="ws-current">
                <h2>Needs attention</h2>
                {active.slice(0, 3).map((i) => (
                  <a key={i.id} href="#issues">
                    <span className="ws-dot" />
                    {i.summary}
                    <small>
                      {i.system} · {i.status}
                    </small>
                  </a>
                ))}
              </div>
            )}
            <section>
              <div className="ws-section-title">
                <h2>Your systems</h2>
                <span>CPU · memory · disk</span>
              </div>
              <div className="ws-fleet">
                {inventory?.servers.map((s) => (
                  <div className="ws-server-row" key={s.id}>
                    <div>
                      <a className="ws-server-name" href={"#server/" + s.id}>
                        {s.name}
                        <ChevronRight size={16} />
                      </a>
                      <div className="ws-app-links">
                        {s.applications.map((id) => (
                          <a key={id} href={"#app/" + id}>
                            {inventory.applications.find((a) => a.id === id)
                              ?.name || id}
                            {overview?.services.find(
                              (service) => service.id === id,
                            ) && (
                              <small className="ws-app-health">
                                {
                                  overview.services.find(
                                    (service) => service.id === id,
                                  )?.status
                                }
                              </small>
                            )}
                            {overview?.metrics.some(
                              (m) => m.id === id + "-latency",
                            ) && (
                              <small className="ws-app-health">
                                {value(
                                  overview.metrics.find(
                                    (m) => m.id === id + "-latency",
                                  ),
                                )}{" "}
                                response
                              </small>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                    {s.services.length > 0 && (
                      <div className="ws-resources">
                        {["cpu", "memory", "disk"].map((k) => {
                          const m = overview?.metrics.find(
                            (m) =>
                              m.id === (s.id === "local" ? k : s.id + "-" + k),
                          );
                          return (
                            <div key={k}>
                              <strong>{value(m)}</strong>
                              <small>{k}</small>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {s.limitation && (
                      <p className="ws-coverage">{s.limitation}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
            {reports?.overdue && (
              <p className="ws-warning">
                <a href="#reports">
                  Daily inspection is overdue or has not yet completed with full
                  coverage.
                </a>
              </p>
            )}
          </>
        )}
        {(selected || app) && (
          <>
            <p className="ws-description">
              {selected?.evidence || app?.coverage}
            </p>
            {selected?.limitation && (
              <p className="ws-warning">{selected.limitation}</p>
            )}
            {selected && (
              <>
                <h2>Applications</h2>
                <div className="ws-link-list">
                  {selected.applications.map((id) => (
                    <a key={id} href={"#app/" + id}>
                      {inventory?.applications.find((a) => a.id === id)?.name}
                      <ArrowUpRight size={16} />
                    </a>
                  ))}
                </div>
                <details className="ws-detail">
                  <summary>Expected services & telemetry</summary>
                  <p>{selected.services.join(", ") || "Managed externally"}</p>
                  <p>{selected.sources.join(" · ")}</p>
                </details>
              </>
            )}
            <h2>Dashboards</h2>
            {dashboardList(
              (catalog?.dashboards || []).filter(
                (d) =>
                  d.id === "fleet-metrics" ||
                  d.id.includes(
                    selected?.id === "local"
                      ? "node"
                      : selected?.id === "backend-vps"
                        ? "backend"
                        : selected?.id === "raspberry"
                          ? "raspberry"
                          : app?.id || "nutsnews",
                  ),
              ),
            )}
          </>
        )}
        {page === "dashboards" && (
          <>
            <div className="ws-search">
              <Search size={18} />
              <input
                aria-label="Find a dashboard"
                placeholder="Find a dashboard…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <p>
              {catalog?.cloudCount || 0} Cloud dashboards, plus portal
              dashboards. Private panels are explicitly identified.
            </p>
            {dashboardList(
              (catalog?.dashboards || []).filter((d) =>
                (d.title || "").toLowerCase().includes(search.toLowerCase()),
              ),
            )}
          </>
        )}
        {dashboard && (
          <>
            <p className="ws-description">{dashboard.limitation}</p>
            <div className="ws-actions">
              {dashboard.cloudUrl && (
                <a href={dashboard.cloudUrl} target="_blank" rel="noreferrer">
                  Original Cloud view ↗
                </a>
              )}
              {dashboard.ownerPath && (
                <a href={owner ? dashboard.ownerPath : "/auth/google"}>
                  Edit / full diagnostics ↗
                </a>
              )}
            </div>
            {dashboard.publicPath ? (
              <iframe
                className="ws-grafana"
                title={dashboard.title}
                src={dashboard.publicPath}
              />
            ) : (
              <p>Open the authenticated diagnostics view for this dashboard.</p>
            )}
          </>
        )}
        {page === "issues" && (
          <>
            <select
              aria-label="Issue status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {[
                "all",
                "New",
                "Ongoing",
                "Unverified",
                "Reopened",
                "Remediated",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {issues?.length === 0 && (
              <p>
                No recorded issues yet. Review daily report coverage before
                interpreting this as healthy.
              </p>
            )}
            {issues
              ?.filter((i) => filter === "all" || i.status === filter)
              .map((i) => (
                <details className="ws-detail" key={i.id}>
                  <summary>
                    <span>{i.summary}</span>
                    <small>
                      {i.system} · {i.status}
                    </small>
                  </summary>
                  <p>
                    {i.severity} · {i.occurrences} occurrences
                  </p>
                  <p>
                    First seen {when(i.firstSeen)} · Last seen{" "}
                    {when(i.lastSeen)}
                  </p>
                  <ol>
                    {i.history.map((h, n) => (
                      <li key={n}>
                        {when(h.at)} — {h.status}
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
          </>
        )}
        {page === "reports" && (
          <>
            {owner && (
              <button
                onClick={async () => {
                  const r = await fetch("/api/owner/scan", { method: "POST" });
                  setNotice(
                    (await r.json()).message || "Unable to queue inspection",
                  );
                }}
              >
                Run inspection
              </button>
            )}
            <p>
              Scheduled daily at 09:00 UTC. Coverage gaps remain visible;
              unavailable checks cannot resolve issues.
            </p>
            {reports?.overdue && (
              <p className="ws-warning">
                Inspection overdue or incomplete coverage.
              </p>
            )}
            {!reports?.reports.length && <p>No reports published yet.</p>}
            {reports?.reports.map((r) => (
              <details key={r.id} className="ws-detail">
                <summary>
                  {when(r.at)}
                  <small>
                    {r.checks.filter((c) => c.complete).length}/
                    {r.checks.length} checks complete
                  </small>
                </summary>
                <p>{r.summary}</p>
                {r.delaySeconds > 0 && (
                  <p>
                    Inspection window delay: {Math.round(r.delaySeconds / 60)}{" "}
                    minutes.
                  </p>
                )}
                <p>{r.ai.note}</p>
                <div className="ws-checks">
                  {r.checks.map((c, i) => (
                    <div key={i}>
                      <strong>
                        {c.system} / {c.id}
                      </strong>
                      <span>
                        {c.complete
                          ? c.failures.length
                            ? "Issue found"
                            : "Checked"
                          : "Incomplete"}
                      </span>
                      <p>{c.note}</p>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </>
        )}
        {page === "alerts" && (
          <>
            {alertError && <p role="alert">{alertError}</p>}
            <div className="ws-search">
              <Search size={18} />
              <input
                aria-label="Search alert rules"
                placeholder="Search rule, server, application or severity…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Rule state"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  "all",
                  "enabled",
                  "paused",
                  "silenced",
                  "firing",
                  "pending",
                  "inactive",
                  "no-data",
                  "evaluation-error",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <p>
              {alerts?.rules.length || 0} configured rules. Evaluation and
              notifications remain owned by Grafana Cloud.
            </p>
            {alerts?.rules
              .filter(
                (r) =>
                  (r.name + " " + r.system + " " + r.severity + " " + r.source)
                    .toLowerCase()
                    .includes(search.toLowerCase()) &&
                  (filter === "all" ||
                    (filter === "enabled" && r.enabled) ||
                    (filter === "paused" && r.paused) ||
                    (filter === "silenced" && r.silenced) ||
                    r.state === filter),
              )
              .map((r) => (
                <details key={r.id} className="ws-detail">
                  <summary>
                    <span>{r.name}</span>
                    <small>
                      {r.state}
                      {r.silenced ? " · silenced" : ""}
                    </small>
                  </summary>
                  <p>{r.purpose}</p>
                  <dl>
                    <dt>Evaluates every</dt>
                    <dd>
                      {r.intervalSeconds === null
                        ? "Unknown"
                        : r.intervalSeconds + " seconds"}
                    </dd>
                    <dt>Pending duration</dt>
                    <dd>{r.pending}</dd>
                    <dt>Lookback</dt>
                    <dd>
                      {r.lookbackSeconds.join(", ") || "Not supplied"} seconds
                    </dd>
                    <dt>Threshold</dt>
                    <dd>
                      {r.thresholds
                        .map((t) => t.operator + " " + t.values.join(", "))
                        .join("; ") || "Expression-defined; owner diagnostics"}
                    </dd>
                    <dt>Last evaluation</dt>
                    <dd>{when(r.lastEvaluation)}</dd>
                    <dt>Source</dt>
                    <dd>{r.source}</dd>
                    <dt>Enabled</dt>
                    <dd>{r.enabled ? "Yes" : "No — paused"}</dd>
                  </dl>
                  <p>
                    {r.evaluationNote}. Silences suppress notifications and do
                    not disable evaluation.
                  </p>
                  <a href="https://localserver.wiki.ramideltoro.com/technical/alerts/">
                    Runbook ↗
                  </a>
                </details>
              ))}
          </>
        )}
        {page === "workspace" && owner && (
          <>
            <p>
              Synced originals are read-only. Use Save as in Grafana to create a
              copy in My dashboards.
            </p>
            <a href="/owner/grafana/">Open owner Grafana ↗</a>
            <div className="ws-list">
              {mine?.dashboards.map((d) => (
                <div key={d.id} className="ws-dashboard">
                  <a href={d.url}>{d.title}</a>
                  <button onClick={() => setPublishUid(d.id)}>
                    Select for publishing
                  </button>
                </div>
              ))}
            </div>
            <div className="ws-actions">
              <input
                aria-label="Workspace dashboard UID"
                placeholder="Saved dashboard UID"
                value={publishUid}
                onChange={(e) => setPublishUid(e.target.value)}
              />
              <button
                onClick={async () => {
                  const r = await fetch("/api/owner/publish", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ uid: publishUid }),
                  });
                  const j = await r.json();
                  setNotice(
                    j.url
                      ? "Review your pull request: " + j.url
                      : j.error || "Publishing failed",
                  );
                }}
              >
                Publish to Git
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
