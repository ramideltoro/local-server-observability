import { recoveryObservation, applicationLogObservation, cloudLogObservation } from "./recovery-evidence.mjs";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { openOperations } from "./operations-store.mjs";
import {
  scoreSystem,
  metricObservation,
  forecast,
  objective,
} from "./health-engine.mjs";
import { readState } from "./store.mjs";
import { body, nativeCatalog } from "./native.mjs";
import { proposeConfiguration } from "./operations-publish.mjs";
const digest = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
const safeCheck = (c) =>
  Object.fromEntries(
    [
      "id",
      "title",
      "category",
      "severity",
      "essential",
      "improvement",
      "status",
      "fresh",
      "note",
      "value",
      "at",
      "issues",
      "dependencies",
      "source",
      "scope",
      "unit",
      "configurable",
      "evidenceState",
    ]
      .filter((k) => c[k] !== undefined)
      .map((k) => [k, c[k]]),
  );
export function reconcileIncidents(store, issues, now = Date.now()) {
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.system + ":" + issue.check;
    const g = groups.get(key) || [];
    g.push(issue);
    groups.set(key, g);
  }
  const previous = new Map(store.incidents().map((i) => [i.id, i]));
  for (const [key, items] of groups) {
    const id = digest(key),
      old = previous.get(id),
      active = items.filter((i) => i.status !== "Remediated");
    const status = active.length
      ? active.some((i) => i.status === "Unverified")
        ? "Unverified"
        : old?.status === "Remediated"
          ? "Reopened"
          : old
            ? "Ongoing"
            : "New"
      : "Remediated";
    const value = {
      ...old,
      id,
      system: items[0].system,
      check: items[0].check,
      title: items[0].summary,
      issues: items.map((i) => i.id),
      status,
      severity: active.some((i) => i.severity === "critical")
        ? "critical"
        : "warning",
      firstSeen: old?.firstSeen || items[0].firstSeen,
      lastSeen: items.reduce((a, i) => (a > i.lastSeen ? a : i.lastSeen), ""),
      acknowledged: old?.acknowledged || false,
    };
    if (!old || old.status !== status)
      store.transition(id, now, { status, source: "deterministic-inspection" });
    store.incident(value);
  }
}
export async function createOperations({
  root,
  overview,
  query,
  logPresence,
  rules,
  owner,
  identity,
  json,
  release,
  dir,
  disabled = false,
}) {
  let config = JSON.parse(
    await fs.readFile(root + "/config/operations.json", "utf8"),
  );
  const store = openOperations(dir);
  if (!store.get("operationsInitializedAt"))
    store.put("operationsInitializedAt", Date.now());
  let running = false,
    lastRules = { rules: [] },
    lastOverview = { metrics: [], services: [] };
  const baseCheck = (c, observation) =>
    safeCheck({ ...c, configurable: !!(c.metric || c.expr), ...observation });
  const configSystem = (id) => config.systems.find((s) => s.id === id);
  async function collect() {
    if (running) return;
    running = true;
    try {
      const now = Date.now(),
        at = Math.floor(now / 60000) * 60000;
      let state = { issues: [], reports: [] };
      try {
        await fs.access(
          (dir ||
            process.env.DATA_DIR ||
            "/var/lib/local-server-observability") + "/state.json",
        );
        state = await readState(dir);
        store.put("lastIssues", state.issues);
      } catch {
        state = {
          issues: store
            .get("lastIssues", [])
            .map((i) =>
              i.status === "Remediated" ? i : { ...i, status: "Unverified" },
            ),
          reports: [],
        };
      }
      const previousHealth = store.get("health");
      try {
        lastOverview = await overview("1h");
      } catch {
        lastOverview = { metrics: [], services: [] };
      }
      try {
        lastRules = await rules();
        store.put("rules", lastRules);
      } catch {
        lastRules = store.get("rules", { rules: [] });
      }

      // Inspection reports are stored newest first in older deployments; use timestamps.
      const latestReport = [...(state.reports || [])].sort(
        (a, b) => Date.parse(b.at) - Date.parse(a.at),
      )[0];
      const reportFresh =
        latestReport && now - Date.parse(latestReport.at) < 97200000;
      const expressions = [
        ...new Set(
          config.systems
            .flatMap((s) => [
              ...s.checks.map((c) => c.expr),
              s.restartCounterExpr,
            ])
            .filter(Boolean),
        ),
      ];
      const expressionResults = new Map();
      let nextExpression = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (nextExpression < expressions.length) {
            const expr = expressions[nextExpression++];
            try {
              expressionResults.set(expr, await query(expr, "1h"));
            } catch {
              expressionResults.set(expr, []);
            }
          }
        }),
      );
      let recoveryEvidence;
      try { recoveryEvidence = JSON.parse(await fs.readFile("/var/lib/observe-recovery/public/evidence.json", "utf8")); } catch {}
      let cloudLogs;
      try { cloudLogs=JSON.parse(await fs.readFile("/var/lib/observe-recovery/public/cloud-logs.json", "utf8")); } catch {}
      const logResults = new Map();
      for (const s of config.systems) for (const c of s.checks) if(c.logSelector) { try { logResults.set(c.logSelector, await logPresence?.(c.logSelector)); } catch {} }
      const observations = new Map();
      for (const system of config.systems) {
        const checks = [];
        for (const c of system.checks) {
          let o = {
            status: "unknown",
            fresh: false,
            evidenceState: c.evidenceState || "no-data",
            note: c.evidenceNote || "The registered source has no current evidence; verify its collection and latest report",
          };
          if (c.probe) {
            const p = lastOverview.services.find((p) => p.id === c.probe);
            if (p && now - Date.parse(lastOverview.updatedAt) < 300000)
              o = {
                status:
                  p.status === "healthy"
                    ? "pass"
                    : ["degraded", "unavailable"].includes(p.status)
                      ? "fail"
                      : "unknown",
                fresh: true,
                at: lastOverview.updatedAt,
                note: "Current endpoint probe",
              };
            if (c.probe === "observability")
              o = {
                status: "pass",
                fresh: true,
                at: new Date(now).toISOString(),
                note: "Portal collector is running",
              };
          }
          if (c.metric)
            o = metricObservation(
              c,
              lastOverview.metrics.find((m) => m.id === c.metric),
              now,
            );
          if (c.expr) {
            try {
              o = metricObservation(
                c,
                { state: "live", series: expressionResults.get(c.expr) || [] },
                now,
              );
            } catch {
              o = {
                status: "unknown",
                fresh: false,
                note: "Registered telemetry query unavailable",
              };
            }
          }
          if (c.report) {
            const r = latestReport?.checks.find(
              (r) => r.system === system.id && r.id === c.report,
            );
            if (r && reportFresh)
              o = {
                status: !r.complete
                  ? "unknown"
                  : r.failures?.length
                    ? "warning"
                    : "pass",
                fresh: r.complete,
                at: latestReport.at,
                note: r.note,
              };
          }
          if (c.coverageSource) {
            const related = system.checks
              .filter((x) => x.metric)
              .map((x) => lastOverview.metrics.find((m) => m.id === x.metric));
            if (c.coverageSource === "metrics")
              o = {
                status:
                  related.length && related.every((m) => m?.state === "live")
                    ? "pass"
                      : !related.length && now - Date.parse(lastOverview.updatedAt) < 300000 &&
                        system.checks.some((x) => x.probe) &&
                        system.checks.filter((x) => x.probe).every((x) =>
                          x.probe === "observability" || lastOverview.services.some((p) => p.id === x.probe && p.status !== "unknown"),
                        )
                      ? "pass"
                      : "unknown",
                fresh: true,
                at: lastOverview.updatedAt,
                note: "Expected metric or probe sources",
              };
            else {
              const ids =
                c.coverageSource === "logs"
                  ? ["recurring-errors"]
                  : system.checks
                      .filter((x) => x.id.startsWith("service:"))
                      .map((x) => x.id);
              const found =
                latestReport?.checks.filter(
                  (x) => x.system === system.id && ids.includes(x.id),
                ) || [];
              o = {
                status:
                  reportFresh &&
                  ids.length &&
                  ids.every((id) =>
                    found.some((x) => x.id === id && x.complete),
                  )
                    ? "pass"
                    : "unknown",
                fresh: !!reportFresh,
                at: latestReport?.at,
                note: "Daily inspection source coverage",
              };
            }
          }
          if(c.cloudLogEvidence) o=cloudLogObservation(cloudLogs,system.id,now);
          if(c.logSelector) { const at=logResults.get(c.logSelector); o=applicationLogObservation(at,now); }
          if (c.recoveryEvidence) o = recoveryObservation(recoveryEvidence, system.id, c.recoveryEvidence, now);
          if (c.recovery) {
            const recovery = store.get("workspaceRecovery");
            if (recovery)
              o = {
                status: now - recovery.at < 97200000 ? "pass" : "unknown",
                fresh: now - recovery.at < 97200000,
                at: new Date(recovery.at).toISOString(),
                note: "Encrypted backup round-trip and SQLite integrity verified; full application recovery not tested",
              };
          }
          if (c.objective) {
            const first = system.checks.find((x) => x.probe);
            const slo = objective(
              store.samples(system.id, first?.id || "endpoint"),
              system.objective?.availability || 99.9,
              now,
            );
            o = {
              status:
                slo.coverage < 99
                  ? "unknown"
                  : slo.availability < slo.target
                    ? "warning"
                    : "pass",
              fresh: slo.coverage >= 99,
              evidenceState: slo.coverage < 99 ? "collecting-history" : undefined,
              note: `${slo.note}; ${slo.coverage.toFixed(1)}% of the 30-day window observed`,
              value: slo.availability,
            };
          }
          if (c.measureOnly)
            o = {
              ...o,
              status: "unknown",
              fresh: false,
              evidenceState: "policy-required",
              note: "Value observed, but no verified freshness target is configured",
            };
          // Historical issues remain authoritative until the inspection reconciles them.
          const measured = { ...o };
          const prior = previousHealth?.systems
            .find((s) => s.id === system.id)
            ?.checks.find((x) => x.id === c.id);
          if (
            o.status === "unknown" &&
            prior &&
            ["fail", "warning"].includes(prior.status)
          )
            o = {
              ...o,
              status: prior.status,
              severity: prior.severity,
              fresh: false,
              note: "Previous failure remains unverified until this check completes",
              at: prior.at,
            };
          const matching = state.issues.filter(
            (i) =>
              i.system === system.id &&
              (i.check === (c.report || c.id) || i.check === c.metric) &&
              i.status !== "Remediated",
          );
          if (matching.length)
            o = {
              ...o,
              status:
                o.status === "fail" ||
                matching.some((i) => i.severity === "critical")
                  ? "fail"
                  : "warning",
              fresh:
                matching.every((i) => i.status !== "Unverified") && o.fresh,
              severity: matching.some((i) => i.severity === "critical")
                ? "critical"
                : c.severity,
              issues: matching.map((i) => i.id),
              note: "Unresolved daily finding; a completed relevant inspection must establish remediation",
            };
          checks.push(baseCheck(c, o));
          store.sample(
            system.id,
            c.id,
            at,
            measured.value ??
              (measured.status === "pass"
                ? 1
                : measured.status === "fail"
                  ? 0
                  : null),
            measured.status,
          );
        }
        // Preserve all remaining findings, once per canonical check.
        for (const issue of state.issues.filter(
          (i) => i.system === system.id && i.status !== "Remediated",
        )) {
          const alias = config.ruleAliases[issue.check] || issue.check;
          if (
            checks.some((c) => c.id === alias || c.issues?.includes(issue.id))
          )
            continue;
          checks.push(
            baseCheck(
              {
                id: alias,
                title: issue.summary,
                category: /backup|restore/.test(alias)
                  ? "recovery"
                  : "performance",
                severity: issue.severity,
                improvement:
                  "Open the issue evidence and runbook; verify a completed follow-up check.",
                issues: [issue.id],
              },
              {
                status: issue.severity === "critical" ? "fail" : "warning",
                fresh:
                  issue.status !== "Unverified" &&
                  now - Date.parse(issue.lastSeen) < 97200000,
                at: issue.lastSeen,
                note: "Unresolved daily inspection finding",
              },
            ),
          );
        }
        for (const rule of lastRules.rules.filter(
          (r) => r.system === system.id && r.enabled,
        )) {
          const id =
            config.ruleAliases["alert:" + rule.id] || "alert:" + rule.id;
          const ruleFresh =
            now - Date.parse(rule.lastEvaluation || "") <
            Math.max(300000, (rule.intervalSeconds || 60) * 3000);
          const status =
            !ruleFresh ||
            ["no-data", "evaluation-error", "unknown"].includes(rule.state)
              ? "unknown"
              : ["firing", "alerting"].includes(rule.state)
                ? rule.severity === "critical"
                  ? "fail"
                  : "warning"
                : rule.state === "pending"
                  ? "warning"
                  : "pass";
          const prior = previousHealth?.systems
            .find((s) => s.id === system.id)
            ?.checks.find((x) => x.id === id);
          const retained =
            status === "unknown" &&
            prior &&
            ["fail", "warning"].includes(prior.status);
          const observation = baseCheck(
            {
              id,
              title: rule.name,
              category: /backup|restore/i.test(rule.name)
                ? "recovery"
                : /cpu|memory|disk/i.test(rule.name)
                  ? "resources"
                  : "performance",
              severity: rule.severity,
              improvement:
                "Review the enabled Cloud alert rule and its runbook.",
              source: "Grafana Cloud",
            },
            {
              status: retained ? prior.status : status,
              fresh: retained ? false : ruleFresh,
              at: rule.lastEvaluation,
              note: retained
                ? "Previous alert failure remains unverified"
                : rule.silenced
                  ? "Notifications silenced; evaluation still affects health"
                  : "Existing Cloud evaluation",
            },
          );
          checks.push(observation);
        }
        observations.set(system.id, checks);
      }
      // A dependency outage is assessed from essential service evidence, not from a host's backup score.
      for (const edge of config.dependencies.filter((e) => e.essential)) {
        const source = observations.get(edge.from),
          target = observations.get(edge.to);
        if (!source) continue;
        const relevant =
          target?.filter((c) => c.category === "availability") || [];
        const status =
          !edge.verified || !relevant.length
            ? "unknown"
            : relevant.some((c) => c.status === "fail" && c.essential)
              ? "fail"
              : relevant.some((c) => c.status === "unknown")
                ? "unknown"
                : "pass";
        source.push(
          baseCheck(
            {
              id: "dependency:" + edge.to,
              title: "Dependency: " + edge.to,
              category: "availability",
              severity: "critical",
              essential: true,
              dependencies: [edge.to],
              improvement:
                "Inspect the required dependency and its availability checks.",
            },
            {
              status,
              fresh: status !== "unknown",
              note: edge.evidence,
              at: new Date(now).toISOString(),
            },
          ),
        );
      }
      const queue = lastOverview.metrics.find(
        (m) => m.id === "nutsnews-queues",
      );
      const queueValue = queue?.series?.[0]?.values?.at(-1);
      if (queue?.state === "live" && queueValue)
        store.sample("nutsnews", "queue", at, Number(queueValue[1]), "unknown");
      const systems = config.systems.map((s) =>
        scoreSystem(s, observations.get(s.id), now),
      );
      for (const s of systems) store.record(s, at);
      const unassignedRules = lastRules.rules
        .filter((r) => r.enabled && !configSystem(r.system))
        .map((r) => ({
          id: r.id,
          name: r.name,
          state: r.state,
          severity: r.severity,
        }));
      for (const system of config.systems.filter((s) => s.restartCounterExpr)) {
        try {
          const series = expressionResults.get(system.restartCounterExpr) || [];
          const values = series.flatMap((s) => s.values?.slice(-1) || []);
          if (!values.length) continue;
          const value = Math.max(...values.map((v) => Number(v[1])));
          if (!Number.isFinite(value)) continue;
          if (values.some((v) => now / 1000 - Number(v[0]) > 300)) continue;
          const previous = store.get("restarts:" + system.id);
          if (previous && value > previous.value)
            store.event({
              id: "restart:" + system.id + ":" + at,
              system: system.id,
              at: now,
              kind: "restart",
              title: "Observed service restart increase",
              outcome: "observed",
              count: value - previous.value,
            });
          store.put("restarts:" + system.id, { value, at: now });
        } catch {}
      }
      const result = {
        unassignedRules,
        at: new Date(now).toISOString(),
        version: config.version,
        score: Math.floor(
          systems.reduce((n, s) => n + s.score, 0) / systems.length,
        ),
        coverage: Math.round(
          systems.reduce((n, s) => n + s.coverage, 0) / systems.length,
        ),
        systems,
        critical: systems.flatMap((s) =>
          s.deductions
            .filter((c) => c.severity === "critical" && c.status === "fail")
            .map((c) => ({ system: s.id, ...c })),
        ),
        note: "Verified operational health, not a probability of failure. Missing checks earn no credit.",
      };
      result.critical.push(
        ...unassignedRules
          .filter(
            (r) =>
              r.severity === "critical" &&
              ["firing", "alerting"].includes(r.state),
          )
          .map((r) => ({
            system: "fleet",
            id: r.id,
            title: r.name,
            status: "fail",
            severity: "critical",
            note: "System assignment unverified",
          })),
      );
      store.put("health", result);
      reconcileIncidents(store, state.issues, now);
      const previous = store.get("release");
      if (release.portal && previous?.portal !== release.portal) {
        store.event({
          id: "release:" + release.portal,
          system: "observability",
          at: now,
          kind: "deployment",
          title: "Portal release activated",
          outcome: "success",
          revision: release.portal.slice(0, 12),
        });
        store.put("release", release);
      }
      store.put("lastCollection", now);
      // Log real completed work, even when nobody opens the health endpoint.
      // Do not include queries, credentials, request data, or individual findings.
      console.log(JSON.stringify({event: "operations-collection-completed", systems: systems.length}));
    } finally {
      running = false;
    }
  }
  async function collectGitHub() {
    if (!process.env.AUTOMATION_TOKEN) return;
    let gaps = [];
    for (const repository of config.repositories) {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${repository.repo}/actions/runs?per_page=100&branch=main`,
          {
            headers: {
              Authorization: "Bearer " + process.env.AUTOMATION_TOKEN,
              Accept: "application/vnd.github+json",
            },
            signal: AbortSignal.timeout(12000),
          },
        );
        if (!response.ok) throw Error();
        const data = await response.json();
        for (const run of data.workflow_runs || []) {
          if (
            run.event === "pull_request" ||
            !/deploy|release|manage local server|daily fleet inspection|backup|restore/i.test(
              run.name,
            ) ||
            run.status !== "completed"
          )
            continue;
          const at = Date.parse(run.updated_at);
          if (at < Date.now() - 90 * 86400000) continue;
          store.event({
            id: "github:" + repository.repo + ":" + run.id,
            system: repository.system,
            at,
            kind: /backup|inspection|restore/i.test(run.name)
              ? "recovery"
              : "deployment-pipeline",
            title: run.name.slice(0, 120),
            outcome: run.conclusion,
            revision: run.head_sha?.slice(0, 12),
            url: `https://github.com/${repository.repo}/actions/runs/${run.id}`,
          });
          if (
            repository.repo === "ramideltoro/local-server-infra" &&
            run.name === "Daily fleet inspection" &&
            run.conclusion === "success" &&
            at >= store.get("operationsInitializedAt")
          ) {
            const old = store.get("workspaceRecovery");
            if (!old || at > old.at)
              store.put("workspaceRecovery", {
                at,
                type: "encrypted-round-trip-and-integrity",
                fullRecovery: false,
              });
          }
        }
        if (data.total_count > 100)
          gaps.push(
            repository.repo + ": history limited to the latest 100 runs",
          );
      } catch {
        gaps.push(repository.repo + ": deployment source unavailable");
      }
    }
    store.put("eventCoverage", {
      at: Date.now(),
      gaps: [
        ...gaps,
        ...config.systems
          .filter(
            (s) =>
              s.kind === "application" &&
              !config.repositories.some((r) => r.system === s.id) &&
              !["qwen"].includes(s.id),
          )
          .map((s) => s.name + ": deployment source not yet verified"),
      ],
      note: "Workflow outcomes are distinct from verified release activation. Earlier history may be unavailable.",
    });
  }
  function daily() {
    const data = [];
    for (const system of config.systems)
      for (const check of system.checks.filter((c) =>
        ["resources"].includes(c.category),
      ))
        data.push({
          system: system.id,
          signal: check.id,
          ...forecast(
            store.samples(system.id, check.id, Date.now() - 14 * 86400000),
            Date.now(),
            check.id === "disk",
          ),
        });
    store.put("forecasts", { at: Date.now(), items: data });
    store.prune();
  }
  function healthResult() {
    const data = store.get("health");
    if (!data)
      return {
        at: null,
        score: 0,
        coverage: 0,
        systems: config.systems.map((s) =>
          scoreSystem(
            s,
            s.checks.map((c) =>
              baseCheck(c, {
                status: "unknown",
                fresh: false,
                note: "Collection pending",
              }),
            ),
          ),
        ),
      };
    if (Date.now() - Date.parse(data.at) > 300000) {
      const systems = config.systems.map((system) =>
        scoreSystem(
          system,
          (
            data.systems.find((s) => s.id === system.id)?.checks ||
            system.checks
          ).map((check) => ({
            ...check,
            status: ["fail", "warning"].includes(check.status)
              ? check.status
              : "unknown",
            fresh: false,
            evidenceState: "no-data",
            note: "Collector stale; prior failures remain unverified until collection completes",
          })),
        ),
      );
      return {
        ...data,
        stale: true,
        coverage: 0,
        score: Math.floor(
          systems.reduce((n, s) => n + s.score, 0) / systems.length,
        ),
        systems,
        critical: systems.flatMap((s) =>
          s.deductions
            .filter((c) => c.severity === "critical" && c.status === "fail")
            .map((c) => ({ system: s.id, ...c })),
        ),
      };
    }
    return data;
  }
  async function handle(req, res, u) {
    const p = u.pathname;
    const annotations = p === "/grafana/api/annotations";
    if (
      !p.startsWith("/api/public/operations/") &&
      !p.startsWith("/api/owner/operations/") &&
      !annotations
    )
      return false;
    const privateView = p.startsWith("/api/owner/");
    if (privateView && !(await owner(req))) {
      json(res, 401, { error: "Google owner sign-in required" }, true);
      return true;
    }
    if (!privateView && req.method !== "GET") {
      json(res, 405, { error: "Read-only endpoint" });
      return true;
    }
    const route = p.split("/").at(-1),
      now = Date.now();
    let from = u.searchParams.has("from")
        ? Number(u.searchParams.get("from"))
        : now - 86400000,
      to = u.searchParams.has("to") ? Number(u.searchParams.get("to")) : now;
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 0 ||
      to < from ||
      to - from > 90 * 86400000 ||
      to > now + 60000
    ) {
      json(res, 400, { error: "Time window must be bounded to 90 days" });
      return true;
    }
    const id = u.searchParams.get("system");
    if (id && !configSystem(id)) {
      json(res, 400, { error: "Unknown system" });
      return true;
    }
    if (privateView) {
      const account = await identity(req);
      if (!account) {
        json(res, 401, { error: "Session expired" }, true);
        return true;
      }
      if (req.method === "GET" && route === "preferences") {
        json(res, 200, store.preferences(account), true);
        return true;
      }
      if (req.method === "GET" && route === "incidents") {
        json(res, 200, store.incidents(), true);
        return true;
      }
      if (
        req.method !== "POST" ||
        req.headers.origin !== "https://observe.ramideltoro.com"
      ) {
        json(res, 403, { error: "Same-origin owner POST required" }, true);
        return true;
      }
      let input;
      try {
        input = JSON.parse((await body(req, 16384)).toString());
      } catch {
        json(res, 400, { error: "Invalid input" }, true);
        return true;
      }
      if (route === "preferences") {
        const catalog = await nativeCatalog();
        const ids = new Set(catalog.dashboards.map((d) => d.id));
        if (
          !Array.isArray(input.favorites) ||
          input.favorites.length > 100 ||
          input.favorites.some((v) => typeof v !== "string" || !ids.has(v))
        ) {
          json(
            res,
            400,
            { error: "Favorites must reference discovered dashboards" },
            true,
          );
          return true;
        }
        const value = { favorites: [...new Set(input.favorites)] };
        store.savePreferences(account, value);
        json(res, 200, value, true);
        return true;
      }
      if (route === "incidents") {
        const incident = store.incidents().find((i) => i.id === input.id);
        if (!incident) {
          json(res, 404, { error: "Incident not found" }, true);
          return true;
        }
        if (
          typeof input.acknowledged !== "boolean" &&
          typeof input.note !== "string" &&
          typeof input.group !== "string"
        ) {
          json(res, 400, { error: "No valid incident update" }, true);
          return true;
        }
        if (
          (input.note !== undefined &&
            (typeof input.note !== "string" || input.note.length > 2000)) ||
          (input.group !== undefined &&
            (typeof input.group !== "string" || input.group.length > 80))
        ) {
          json(res, 400, { error: "Incident update too long" }, true);
          return true;
        }
        if (typeof input.acknowledged === "boolean")
          incident.acknowledged = input.acknowledged;
        if (input.group !== undefined) incident.group = input.group;
        if (input.note)
          incident.notes = [
            ...(incident.notes || []),
            { at: now, text: input.note, owner: account },
          ].slice(-100);
        store.incident(incident);
        store.transition(incident.id, now, {
          action: "owner-update",
          acknowledged: incident.acknowledged,
        });
        json(res, 200, incident, true);
        return true;
      }
      if (route === "proposals") {
        try {
          json(
            res,
            201,
            await proposeConfiguration(
              input,
              config,
              process.env.AUTOMATION_TOKEN,
            ),
            true,
          );
        } catch {
          json(
            res,
            400,
            {
              error:
                "Proposal failed validation or Git publishing is unavailable",
            },
            true,
          );
        }
        return true;
      }
      json(res, 404, { error: "Unknown owner operation" }, true);
      return true;
    }
    const health = healthResult();
    let result;
    if (annotations)
      result = store.events(from, to).map((e, i) => ({
        id: i + 1,
        time: e.at,
        text: e.title + " · " + e.outcome,
        tags: ["workspace-events", e.system, e.kind],
      }));
    else if (route === "health") result = health;
    else if (route === "history")
      result = {
        system: id,
        points: id ? store.history(id, from, to) : [],
        daily: id
          ? store.db
              .prepare(
                "SELECT day,score,coverage FROM daily WHERE system=? ORDER BY day DESC LIMIT 3660",
              )
              .all(id)
          : [],
      };
    else if (route === "events")
      result = {
        events: store.events(from, to, id),
        coverage: store.get("eventCoverage", {
          gaps: ["Initial event collection pending"],
        }),
      };
    else if (route === "dependencies")
      result = {
        nodes: [...config.systems, ...(config.components || [])].map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
        })),
        edges: config.dependencies.map((e) => ({
          ...e,
          status: e.verified
            ? health.systems.find((s) => s.id === e.to)?.status || "unknown"
            : "unknown",
        })),
      };
    else if (route === "coverage")
      result = {
        systems: health.systems.map((s) => ({
          id: s.id,
          name: s.name,
          coverage: s.coverage,
          checks: s.checks,
        })),
        unassignedRules: health.unassignedRules || [],
      };
    else if (route === "recovery")
      result = {
        systems: health.systems.map((s) => ({
          id: s.id,
          name: s.name,
          checks: s.checks.filter((c) => c.category === "recovery"),
        })),
        workspace: store.get("workspaceRecovery"),
        note: "Integrity verification is not a full application restore test.",
      };
    else if (route === "forecasts")
      result = {
        ...store.get("forecasts", {
          items: [],
          note: "First daily forecast pending",
        }),
        historyCoverage: store.get("historyCoverage"),
      };
    else if (route === "objectives")
      result = {
        items: config.systems
          .filter((s) => s.kind === "application")
          .map((s) => ({
            system: s.id,
            name: s.name,
            ...objective(
              store.samples(
                s.id,
                s.checks.find((c) => c.probe)?.id || "endpoint",
              ),
              s.objective?.availability || 99.9,
            ),
            targetProvisional: s.objective?.provisional !== false,
            latency:
              "Existing alert objectives remain authoritative; no unconfigured latency target is assumed.",
            relatedRules: lastRules.rules
              .filter(
                (r) =>
                  r.system === s.id &&
                  /SLO|burn|latency|freshness/i.test(r.name),
              )
              .map((r) => ({ id: r.id, name: r.name, state: r.state })),
          })),
      };
    else if (route === "incidents")
      result = {
        incidents: store.incidents().map(({ notes, group, ...i }) => ({
          ...i,
          history: store.transitions(i.id),
          related: config.dependencies.filter(
            (e) => e.verified && (e.from === i.system || e.to === i.system),
          ),
          runbook: "https://localserver.wiki.ramideltoro.com/technical/alerts/",
        })),
      };
    else if (route === "qwen")
      result = {
        metrics: lastOverview.metrics.filter((m) => m.id.startsWith("qwen-")),
        note: "Production request aggregates only. Queue depth inside Ollama is not exposed; in-flight requests are not queue depth.",
        background: store.get("background", null),
      };
    else {
      json(res, 404, { error: "Unknown operation" });
      return true;
    }
    json(res, 200, result);
    return true;
  }
  const timers = [];
  if (!disabled) {
    setTimeout(() => collect().catch(() => {}), 100).unref();
    setTimeout(() => collectGitHub().catch(() => {}), 1000).unref();
    timers.push(
      setInterval(() => collect().catch(() => {}), 60000),
      setInterval(() => collectGitHub().catch(() => {}), 900000),
    );
    for (const t of timers) t.unref();
  }
  return {
    handle,
    collect,
    daily,
    store,
    health: healthResult,
    close() {
      timers.forEach(clearInterval);
      store.close();
    },
  };
}
