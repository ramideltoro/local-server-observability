import { useEffect, useRef, useState } from "react";
import { Search, Star, ArrowRight, X } from "lucide-react";
import "./operations.css";
export type Check = {
  id: string;
  title: string;
  category: string;
  severity: string;
  status: string;
  evidenceState?: string;
  fresh: boolean;
  note: string;
  improvement: string;
  value?: number;
  at?: string;
  dependencies?: string[];
  issues?: string[];
  unit?: string;
  configurable?: boolean;
  pointsLost?: number;
};
export type SystemHealth = {
  id: string;
  name: string;
  kind: string;
  score: number;
  coverage: number;
  status: string;
  at: string;
  ceilingReason?: string;
  categories: { id: string; weight: number; earned: number }[];
  checks: Check[];
  deductions: Check[];
};
export type HealthData = {
  score: number;
  coverage: number;
  at: string;
  stale?: boolean;
  systems: SystemHealth[];
  critical?: Check[];
  note?: string;
};
type Event = {
  id: string;
  system: string;
  at: number;
  title: string;
  kind: string;
  outcome: string;
  revision?: string;
  url?: string;
};
type Incident = {
  id: string;
  system: string;
  title: string;
  status: string;
  severity: string;
  issues: string[];
  acknowledged: boolean;
  group?: string;
  notes?: { at: number; text: string }[];
  history?: { at: number; status?: string; action?: string }[];
  runbook?: string;
};
const api = "/api/public/operations/";
export function useOperation<T>(url: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState("");
  useEffect(() => {
    if (!url) return;
    let live = true;
    setData(undefined);
    const load = () =>
      fetch(url)
        .then(async (r) => {
          if (!r.ok) throw Error("Data unavailable");
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
              "Data unavailable. Previously loaded information may be stale.",
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
const date = (v?: string | number) =>
  v ? new Date(v).toLocaleString() : "Not verified";
const num = (v?: number | null) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : "—";
export const timeRanges: Record<string, number> = {
  "1h": 3600000,
  "6h": 21600000,
  "24h": 86400000,
  "7d": 604800000,
};
export function nativeRange(path: string, range: string) {
  const url = new URL(path, location.origin);
  url.searchParams.set("from", "now-" + range);
  url.searchParams.set("to", "now");
  return url.pathname + url.search;
}
export function Score({ system }: { system?: SystemHealth }) {
  return system ? (
    <a
      className={"ops-score ops-" + system.status}
      href={"#health/" + system.id}
      aria-label={
        system.name +
        ": " +
        system.score +
        "% verified health, " +
        system.coverage +
        "% coverage"
      }
    >
      <strong>{system.score}%</strong>
      <span>
        {system.status === "unknown"
          ? "verified · health unknown"
          : system.coverage + "% coverage"}
      </span>
    </a>
  ) : (
    <span className="ops-muted">Awaiting score</span>
  );
}
export function FleetHealth({ health }: { health?: HealthData }) {
  return (
    <section className="ops-fleet-health" aria-label="Verified fleet health">
      <div>
        <p className="ws-eyebrow">VERIFIED FLEET HEALTH · CURRENT</p>
        <h2>
          <span
            className={
              health?.systems.every((s) => s.status === "unknown")
                ? "ops-unknown"
                : health && health.score >= 95
                  ? "ops-good"
                  : health && health.score >= 70
                    ? "ops-warning"
                    : "ops-bad"
            }
          >
            {health ? health.score + "%" : "—"}
          </span>{" "}
          <small>
            {health
              ? health.coverage + "% monitored coverage"
              : "Collecting evidence"}
          </small>
        </h2>
        <p>
          Failures, warnings, recovery readiness, and missing checks all count.
        </p>
      </div>
      <a href="#health">
        Explain health scores <ArrowRight size={16} />
      </a>
      {!!health?.critical?.length && (
        <a className="ops-critical" href="#health">
          {health.critical.length} critical check
          {health.critical.length === 1 ? "" : "s"} need attention
        </a>
      )}
      {health?.stale && (
        <p className="ops-warning">
          Collector is stale. Current health is unverified.
        </p>
      )}
    </section>
  );
}
export function CommandSearch({
  items,
}: {
  items: { title: string; url: string; kind: string }[];
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      input.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        className="ops-command-button"
        onClick={() => setOpen(true)}
        aria-label="Search workspace"
      >
        <Search size={15} />
        <span>Search workspace</span>
        <kbd>⌘ K</kbd>
      </button>
      <dialog
        className="ops-command"
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label="Search workspace"
      >
        <div>
          <Search size={18} />
          <input
            ref={input}
            aria-label="Search systems, dashboards, incidents, reports and runbooks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                dialog.current?.querySelector<HTMLAnchorElement>("a")?.focus();
              }
            }}
            placeholder="Find a system, dashboard, issue…"
          />
          <button onClick={() => setOpen(false)} aria-label="Close search">
            <X size={18} />
          </button>
        </div>
        <nav>
          {items
            .filter((i) => i.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 20)
            .map((i, n) => (
              <a key={i.url + n} href={i.url} onClick={() => setOpen(false)}>
                <span>{i.title}</span>
                <small>{i.kind}</small>
              </a>
            ))}
        </nav>
        <p>Type to search · ↓ to results · Tab to move · Esc to close</p>
      </dialog>
    </>
  );
}
export function Favorite({ id, owner }: { id: string; owner: boolean }) {
  const { data } = useOperation<{ favorites: string[] }>(
    owner ? "/api/owner/operations/preferences" : "",
  );
  const [saved, setSaved] = useState<boolean>(),
    [message, setMessage] = useState("");
  const selected = saved ?? data?.favorites.includes(id);
  return owner ? (
    <span>
      <button
        className="ops-favorite"
        aria-label={selected ? "Remove favorite" : "Add favorite"}
        aria-pressed={!!selected}
        onClick={async () => {
          try {
            const latest = await fetch(
              "/api/owner/operations/preferences",
            ).then((r) => {
              if (!r.ok) throw Error();
              return r.json();
            });
            const favorites = selected
              ? latest.favorites.filter((v: string) => v !== id)
              : [...latest.favorites, id];
            const response = await fetch("/api/owner/operations/preferences", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ favorites }),
            });
            if (!response.ok) throw Error();
            setSaved(!selected);
            setMessage("");
          } catch {
            setMessage("Could not save favorite.");
          }
        }}
      >
        <Star size={16} fill={selected ? "currentColor" : "none"} />
      </button>
      {message && <small role="status">{message}</small>}
    </span>
  ) : (
    <a
      className="ops-favorite"
      href="/auth/google"
      aria-label="Sign in with Google to save favorite"
    >
      <Star size={16} />
    </a>
  );
}
function CheckList({ checks }: { checks: Check[] }) {
  return (
    <div className="ops-checks">
      {checks.map((c) => (
        <details key={c.id}>
          <summary>
            <span
              className={
                "ops-status ops-" +
                (c.status === "pass"
                  ? "good"
                  : c.status === "fail"
                    ? "bad"
                    : c.status)
              }
            >
              {c.status === "unknown"
                ? ({"not-configured": "Setup required", "no-data": "No data", "collecting-history": "Collecting history", "policy-required": "Policy required"}[c.evidenceState || "no-data"] || "No data")
                : c.status}
            </span>
            <span>{c.title}</span>
            <small>
              {c.category}
              {c.pointsLost ? " · −" + num(c.pointsLost) + " points" : ""}
              {c.value !== undefined
                ? " · " + num(c.value) + (c.unit === "s" ? " s" : "")
                : ""}
            </small>
          </summary>
          <p>
            {c.note} · {date(c.at)}
            {c.fresh === false ? " · Unverified evidence" : ""}
          </p>
          {c.status !== "pass" && (
            <p>
              <strong>Improve:</strong> {c.improvement}
            </p>
          )}
          {!!c.issues?.length && (
            <a href="#issues">View underlying issue evidence →</a>
          )}
          {c.dependencies?.map((id) => (
            <a key={id} href={"#health/" + id}>
              Inspect {id} →
            </a>
          ))}
        </details>
      ))}
    </div>
  );
}
function ScoreHistory({ system, range }: { system: string; range: string }) {
  const [end] = useState(Date.now());
  const from = end - timeRanges[range];
  const { data } = useOperation<{
    points: { at: number; score: number }[];
    daily: { day: string; score: number; coverage: number }[];
  }>(
    api + `history?system=${encodeURIComponent(system)}&from=${from}&to=${end}`,
  );
  const { data: events } = useOperation<{ events: Event[] }>(
    api + `events?system=${encodeURIComponent(system)}&from=${from}&to=${end}`,
  );
  const points = data?.points || [];
  return (
    <section className="ops-history">
      <h3>
        Health over time{" "}
        <small>Selected range · current score remains live</small>
      </h3>
      {points.length > 1 ? (
        <svg
          viewBox="0 0 800 140"
          role="img"
          aria-label="Verified health score history from zero to one hundred percent"
        >
          <text x="0" y="14">
            100%
          </text>
          <text x="0" y="120">
            0%
          </text>
          <line x1="45" x2="800" y1="120" y2="120" stroke="#ffffff20" />
          <polyline
            fill="none"
            stroke="#efb04f"
            strokeWidth="2"
            points={points
              .map(
                (p) =>
                  `${45 + ((p.at - from) / (end - from)) * 750},${120 - p.score}`,
              )
              .join(" ")}
          />
          {events?.events.map((e) => (
            <line
              key={e.id}
              x1={45 + ((e.at - from) / (end - from)) * 750}
              x2={45 + ((e.at - from) / (end - from)) * 750}
              y1="15"
              y2="120"
              stroke="#8e98ac"
              strokeDasharray="3 4"
            >
              <title>
                {e.title} · {date(e.at)}
              </title>
            </line>
          ))}
        </svg>
      ) : (
        <p className="ops-muted">
          History is accumulating. No earlier health score is inferred.
        </p>
      )}
      <div className="ops-history-times">
        <small>{date(from)}</small>
        <small>{date(end)}</small>
      </div>
      <details>
        <summary>Retained daily summaries</summary>
        {data?.daily?.length ? (
          data.daily.map((d) => (
            <p key={d.day}>
              {d.day} · {num(d.score)}% health · {num(d.coverage)}% coverage
            </p>
          ))
        ) : (
          <p>First daily summary pending.</p>
        )}
      </details>
    </section>
  );
}
function Proposal({ system }: { system: SystemHealth }) {
  const [message, setMessage] = useState("");
  return (
    <details className="ws-detail">
      <summary>Propose an operational target in Git</summary>
      <form
        className="ops-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const check = String(form.get("check"));
          const input =
            check === "availability"
              ? {
                  system: system.id,
                  availabilityTarget: Number(form.get("fail")),
                }
              : {
                  system: system.id,
                  check,
                  warn: Number(form.get("warn")),
                  fail: Number(form.get("fail")),
                };
          try {
            const r = await fetch("/api/owner/operations/proposals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            });
            const body = await r.json();
            if (!r.ok) throw Error(body.error);
            setMessage(body.url);
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Proposal failed");
          }
        }}
      >
        <label>
          Target
          <select name="check">
            {system.kind === "application" && (
              <option value="availability">Availability objective (%)</option>
            )}
            {system.checks
              .filter((c) => c.configurable)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Warning threshold
          <input
            name="warn"
            type="number"
            min="0"
            step="any"
            defaultValue="80"
          />
        </label>
        <label>
          Failure threshold / availability target
          <input
            name="fail"
            type="number"
            min="0"
            step="any"
            required
            defaultValue={system.kind === "application" ? "99.9" : "90"}
          />
        </label>
        <button>Create validated PR</button>
        <p>Changes take effect after Git review and deployment.</p>
      </form>
      {message.startsWith("https://github.com/") ? (
        <a href={message}>Open configuration PR →</a>
      ) : (
        <p role="status">{message}</p>
      )}
    </details>
  );
}
export function HealthDetail({
  system,
  owner,
  range,
}: {
  system: SystemHealth;
  owner: boolean;
  range: string;
}) {
  return (
    <>
      <div className="ops-detail-score">
        <Score system={system} />
        <p>
          {system.ceilingReason || "All required checks are verified."}
          <br />
          <small>Current score · {date(system.at)}</small>
        </p>
      </div>
      <div className="ops-contributions">
        {system.categories.map((c) => (
          <div key={c.id}>
            <span>{c.id}</span>
            <strong>
              {num(c.earned)} / {num(c.weight)}
            </strong>
            <meter min="0" max={c.weight} value={c.earned} />
          </div>
        ))}
      </div>
      <h3>What needs improvement</h3>
      {system.deductions.length ? (
        <CheckList checks={system.deductions} />
      ) : (
        <p className="ops-good">All required checks are passing.</p>
      )}
      <details className="ws-detail">
        <summary>All expected checks ({system.checks.length})</summary>
        <CheckList checks={system.checks} />
      </details>
      <ScoreHistory system={system.id} range={range} />
      {owner && <Proposal system={system} />}
    </>
  );
}
export const operationPages: Record<string, string> = {
  health: "System health",
  events: "Deployment timeline",
  dependencies: "Dependencies",
  objectives: "Service objectives",
  qwen: "Qwen workload",
  forecasts: "Capacity forecasts",
  incidents: "Incident workspace",
  coverage: "Monitoring coverage",
  recovery: "Recovery readiness",
  favorites: "Favorite dashboards",
};
export default function Operations({
  page,
  owner,
  health,
  range,
}: {
  page: string;
  owner: boolean;
  health?: HealthData;
  range: string;
}) {
  const key = page.split("/")[0],
    id = page.split("/")[1];
  const [end] = useState(Date.now());
  const { data, error } = useOperation<any>(
    !["health", "favorites"].includes(key)
      ? api +
          key +
          (key === "events" ? `?from=${end - timeRanges[range]}&to=${end}` : "")
      : "",
  );
  const { data: prefs } = useOperation<{ favorites: string[] }>(
    key === "favorites" && owner ? "/api/owner/operations/preferences" : "",
  );
  const { data: catalog } = useOperation<{
    dashboards: { id: string; title: string }[];
  }>(key === "favorites" ? "/api/public/dashboards" : "");
  const { data: privateIncidents } = useOperation<Incident[]>(
    key === "incidents" && owner ? "/api/owner/operations/incidents" : "",
  );
  const [notice, setNotice] = useState(""),
    [filter, setFilter] = useState("all"),
    [incidentGroup, setIncidentGroup] = useState("all");
  const names = Object.fromEntries(
    [...(health?.systems || []), ...(data?.nodes || [])].map((s) => [
      s.id,
      s.name,
    ]),
  );
  const selected = health?.systems.find((s) => s.id === id);
  async function updateIncident(
    e: React.FormEvent<HTMLFormElement>,
    incident: Incident,
  ) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/owner/operations/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: incident.id,
          acknowledged: f.get("acknowledged") === "on",
          note: String(f.get("note") || ""),
          group: String(f.get("group") || ""),
        }),
      });
      if (!r.ok) throw Error();
      setNotice(
        "Incident updated. It remains scored until a completed check verifies recovery.",
      );
    } catch {
      setNotice("Incident update failed.");
    }
  }
  return (
    <div className="ops-view">
      {error && <p className="ws-warning">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {key === "health" &&
        (selected ? (
          <HealthDetail system={selected} owner={owner} range={range} />
        ) : (
          <>
            <p className="ws-description">
              Scores include failures, warnings, recovery readiness, and missing
              evidence. Select a system to see every deduction.
            </p>
            <div className="ops-system-list">
              {health?.systems.map((s) => (
                <div key={s.id}>
                  <a href={"#health/" + s.id}>
                    {s.name}
                    <small>
                      {s.kind} · {s.deductions.length} improvements
                    </small>
                  </a>
                  <Score system={s} />
                </div>
              ))}
            </div>
          </>
        ))}
      {key === "events" && (
        <>
          <p className="ws-description">
            Deployments, pipeline outcomes, and observed restarts in the
            selected range. Timing shows correlation, not causation.
          </p>
          {data?.coverage?.gaps?.map((g: string) => (
            <p key={g} className="ops-muted">
              {g}
            </p>
          ))}
          <div className="ops-timeline">
            {data?.events?.map((e: Event) => (
              <article key={e.id}>
                <time>{date(e.at)}</time>
                <div>
                  <strong
                    className={e.outcome === "success" ? "ops-good" : "ops-bad"}
                  >
                    {e.title}
                  </strong>
                  <p>
                    {names[e.system] || e.system} · {e.kind} · {e.outcome}
                    {e.revision ? " · " + e.revision : ""}
                  </p>
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      View source run ↗
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
          {data?.events?.length === 0 && (
            <p>
              No recorded events in this range. Earlier history may be
              unavailable.
            </p>
          )}
        </>
      )}
      {key === "dependencies" && (
        <>
          <p className="ws-description">
            Verified hosting and service relationships. Unknown connections are
            explicitly marked; a diagram does not prove network reachability.
          </p>
          <div className="ops-dependencies">
            {data?.edges?.map((edge: any, i: number) => (
              <div key={i}>
                <a href={"#health/" + edge.from}>
                  {names[edge.from] || edge.from}
                </a>
                <span>
                  <ArrowRight size={18} />
                  {edge.type}
                </span>
                {names[edge.to] ? (
                  <a
                    href={"#health/" + edge.to}
                    className={"ops-" + edge.status}
                  >
                    {names[edge.to]}
                  </a>
                ) : (
                  <strong className="ops-unknown">{edge.to}</strong>
                )}
                <small>
                  {edge.verified
                    ? "Verified relationship"
                    : "Unverified relationship"}
                </small>
                <details>
                  <summary>Evidence</summary>
                  <p>{edge.evidence}</p>
                </details>
              </div>
            ))}
          </div>
        </>
      )}
      {key === "objectives" && (
        <>
          <p className="ws-description">
            Availability across 30 days. New targets are provisional at 99.9%;
            missing minutes are never counted as successful. Existing Cloud SLO
            alerts remain authoritative.
          </p>
          {data?.items?.map((o: any) => (
            <section className="ops-objective" key={o.system}>
              <h3>{o.name}</h3>
              <div className="ops-objective-values">
                <span>
                  <strong>{num(o.availability)}%</strong> observed availability
                </span>
                <span>
                  <strong>{o.target}%</strong> target
                  {o.targetProvisional ? " · provisional" : ""}
                </span>
                <span>
                  <strong>{num(o.coverage)}%</strong> coverage
                </span>
                <span>
                  <strong>{num(o.budgetConsumedPercent)}%</strong> error budget
                  used
                </span>
              </div>
              <p>
                {o.note} · {num(o.usedMinutes)} failed minutes /{" "}
                {num(o.errorBudgetMinutes)} allowed minutes.
              </p>
              <details>
                <summary>Latency, freshness, and existing objectives</summary>
                <p>{o.latency}</p>
                {o.relatedRules?.map((r: any) => (
                  <p key={r.id}>
                    <a href="#alerts">
                      {r.name} · {r.state}
                    </a>
                  </p>
                ))}
              </details>
            </section>
          ))}
        </>
      )}
      {key === "forecasts" && (
        <>
          <p className="ws-description">
            Daily estimates use up to 14 days of samples. A forecast requires
            seven days, 80% coverage, and a credible positive trend.
          </p>
          {data?.note && <p>{data.note}</p>}
          {data?.items?.map((f: any) => (
            <div className="ws-dashboard" key={f.system + f.signal}>
              <div>
                <a href={"#health/" + f.system}>
                  {names[f.system] || f.system} · {f.signal}
                </a>
                <p>
                  {f.note} · {f.coverage}% coverage
                </p>
              </div>
              <strong
                className={
                  f.sustainedPressure ||
                  (f.daysToFull != null && f.daysToFull < 14)
                    ? "ops-bad"
                    : "ops-muted"
                }
              >
                {f.daysToFull != null
                  ? num(f.daysToFull) + " days to full"
                  : f.mean != null
                    ? "Average " +
                      num(f.mean) +
                      (f.signal === "queue" ? " messages" : "%")
                    : "Collecting history"}
              </strong>
            </div>
          ))}
        </>
      )}
      {key === "coverage" && (
        <>
          <p className="ws-description">
            Every required check stays in the denominator. Missing
            instrumentation and stale sources lower verified health.
          </p>
          {!!data?.unassignedRules?.length && (
            <details className="ws-detail">
              <summary>
                {data.unassignedRules.length} enabled rules need verified system
                assignment
              </summary>
              <p>
                These rules remain evaluated by Cloud. They are not assigned to
                a server score without evidence; critical firing rules are
                highlighted at fleet level.
              </p>
              {data.unassignedRules.map((r: any) => (
                <p key={r.id}>
                  <a href="#alerts">
                    {r.name} · {r.state}
                  </a>
                </p>
              ))}
            </details>
          )}
          {data?.systems?.map((s: any) => (
            <details className="ws-detail" key={s.id}>
              <summary>
                {s.name}
                <strong>{s.coverage}% verified coverage</strong>
              </summary>
              <CheckList checks={s.checks} />
            </details>
          ))}
        </>
      )}
      {key === "recovery" && (
        <>
          <p className="ws-description">
            {data?.note} Backup scope and missing restore evidence remain
            visible.
          </p>
          <p>
            Portal encrypted backup and integrity test:{" "}
            {date(data?.workspace?.at)} · Full application restore: not verified
          </p>
          {data?.systems?.map((s: any) => (
            <details className="ws-detail" key={s.id}>
              <summary>
                {s.name}
                <small>
                  {s.checks.filter((c: Check) => c.status !== "pass").length}{" "}
                  improvements
                </small>
              </summary>
              <CheckList checks={s.checks} />
            </details>
          ))}
        </>
      )}
      {key === "qwen" && (
        <>
          <p className="ws-description">{data?.note}</p>
          <div className="ops-qwen-values">
            {data?.metrics?.map((m: any) => (
              <div key={m.id}>
                <strong>
                  {m.state === "live"
                    ? num(Number(m.series?.[0]?.values?.at(-1)?.[1]))
                    : "—"}
                </strong>
                <span>
                  {m.title}
                  {m.unit === "s" ? " (seconds)" : ""}
                </span>
              </div>
            ))}
          </div>
          <a className="ws-actions" href="#dashboard/qwen-workload">
            Open native Qwen dashboard →
          </a>
          <p className="ops-muted">
            No prompts, generated content, credentials, or user identifiers are
            collected. Background summaries run only when Qwen is idle.
          </p>
        </>
      )}
      {key === "incidents" && (
        <>
          <p className="ws-description">
            Related findings share a canonical check. Verified dependencies
            provide investigation context; they do not establish a root cause.
            Acknowledgements never improve health scores.
          </p>
          <label>
            Status{" "}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {[
                "all",
                "New",
                "Ongoing",
                "Reopened",
                "Unverified",
                "Remediated",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {owner && (
            <label>
              Owner group{" "}
              <select
                value={incidentGroup}
                onChange={(e) => setIncidentGroup(e.target.value)}
              >
                <option value="all">All groups</option>
                {[
                  ...new Set(
                    privateIncidents?.map((i) => i.group).filter(Boolean),
                  ),
                ].map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data?.incidents
            ?.filter(
              (i: Incident) =>
                incidentGroup === "all" ||
                privateIncidents?.find((p) => p.id === i.id)?.group ===
                  incidentGroup,
            )
            .filter((i: Incident) => filter === "all" || i.status === filter)
            .map((i: Incident) => {
              const privateValue = privateIncidents?.find((p) => p.id === i.id);
              return (
                <details className="ws-detail" key={i.id}>
                  <summary>
                    <span>{i.title}</span>
                    <small
                      className={
                        i.status === "Remediated"
                          ? "ops-good"
                          : i.severity === "critical"
                            ? "ops-bad"
                            : "ops-warning"
                      }
                    >
                      {i.status}
                    </small>
                  </summary>
                  <p>
                    {names[i.system] || i.system}
                    {owner && privateValue?.group
                      ? " · Group: " + privateValue.group
                      : ""}{" "}
                    · {i.issues.length} linked findings ·{" "}
                    {i.acknowledged ? "Acknowledged" : "Not acknowledged"}
                  </p>
                  <a href="#issues">Underlying issue evidence →</a> ·{" "}
                  <a href={i.runbook}>Recovery runbook ↗</a>
                  {i.history?.map((h, n) => (
                    <p key={n}>
                      {date(h.at)} · {h.status || h.action}
                    </p>
                  ))}
                  {owner && (
                    <form
                      className="ops-form"
                      onSubmit={(e) => updateIncident(e, i)}
                    >
                      <label>
                        <input
                          type="checkbox"
                          name="acknowledged"
                          defaultChecked={
                            privateValue?.acknowledged || i.acknowledged
                          }
                        />{" "}
                        Acknowledge
                      </label>
                      <label>
                        Owner incident group
                        <input
                          name="group"
                          maxLength={80}
                          defaultValue={privateValue?.group}
                        />
                      </label>
                      <label>
                        Private owner note
                        <textarea name="note" maxLength={2000} />
                      </label>
                      <button>Save incident update</button>
                      {privateValue?.notes?.map((n, j) => (
                        <p key={j}>
                          {date(n.at)} · {n.text}
                        </p>
                      ))}
                    </form>
                  )}
                </details>
              );
            })}
          {data?.incidents?.length === 0 && (
            <p>
              No incidents have been recorded. Check monitoring coverage before
              interpreting this as healthy.
            </p>
          )}
        </>
      )}
      {key === "favorites" &&
        (!owner ? (
          <p>
            <a href="/auth/google">
              Sign in with Google to save and view your favorite dashboards.
            </a>
          </p>
        ) : (
          <>
            {catalog?.dashboards
              .filter((d) => prefs?.favorites.includes(d.id))
              .map((d) => (
                <div className="ws-dashboard" key={d.id}>
                  <a href={"#dashboard/" + d.id}>{d.title}</a>
                  <Favorite id={d.id} owner={owner} />
                </div>
              ))}
            {prefs?.favorites.length === 0 && (
              <p>Use the star beside a dashboard to save it here.</p>
            )}
          </>
        ))}
    </div>
  );
}
