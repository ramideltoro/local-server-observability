import { createHash } from "node:crypto";
// No query strings, datasource credentials, labels, or template-expanded evidence cross this projection.
export function alertCatalog(
  config,
  groups,
  instances,
  now = new Date().toISOString(),
  silences = [],
) {
  const runtime = (groups.data?.groups || []).flatMap((g) =>
    (g.rules || []).map((r) => ({ ...r, interval: g.interval, group: g.name })),
  );
  return {
    updatedAt: now,
    rules: config.map((r) => {
      const run = runtime.find(
        (x) =>
          (x.uid && x.uid === r.uid) ||
          (x.name === r.title && x.group === r.ruleGroup),
      );
      const active = instances.filter(
        (a) =>
          a.labels?.__alert_rule_uid__ === r.uid ||
          a.labels?.alertname === r.title,
      );
      const labels = {
        ...r.labels,
        alertname: r.title,
        __alert_rule_uid__: r.uid,
      };
      const ruleSilenced = silences.some(
        (s) =>
          s.status?.state === "active" &&
          s.matchers?.length &&
          s.matchers.every((m) => {
            if (!(m.name in labels)) return false;
            try {
              const matches = m.isRegex
                ? new RegExp("^(?:" + m.value + ")$").test(labels[m.name])
                : labels[m.name] === m.value;
              return m.isEqual === false ? !matches : matches;
            } catch {
              return false;
            }
          }),
      );
      const silenced =
        ruleSilenced || active.some((a) => a.status?.silencedBy?.length > 0);
      const conditions = (r.data || [])
        .flatMap((d) =>
          (d.model?.conditions || []).map((c) => ({
            operator: c.evaluator?.type,
            values: c.evaluator?.params,
          })),
        )
        .filter((c) => c.operator);
      const lookbacks = [
        ...new Set(
          (r.data || [])
            .map((d) => d.relativeTimeRange?.from)
            .filter(Number.isFinite),
        ),
      ];
      return {
        id: createHash("sha256").update(r.uid).digest("hex").slice(0, 16),
        name: r.title,
        source: "Grafana Cloud",
        system: /backend/i.test(r.title)
          ? "backend-vps"
          : /raspberry/i.test(r.title)
            ? "raspberry"
            : /local/i.test(r.title)
              ? "local"
              : /nutsnews/i.test(r.title)
                ? "nutsnews"
                : "fleet",
        severity: ["critical", "warning", "info"].includes(r.labels?.severity)
          ? r.labels.severity
          : "unspecified",
        enabled: !r.isPaused,
        paused: !!r.isPaused,
        silenced,
        state: r.isPaused
          ? "paused"
          : run?.health === "error"
            ? "evaluation-error"
            : run?.health === "nodata" || run?.state === "no_data"
              ? "no-data"
              : run?.state || "unknown",
        intervalSeconds: run?.interval ?? null,
        pending: r.for || "0s",
        lastEvaluation: run?.lastEvaluation || null,
        lookbackSeconds: lookbacks,
        thresholds: conditions,
        purpose: `${r.title}. Evaluated by the existing Cloud rule group.`,
        signal: /cpu/i.test(r.title)
          ? "CPU utilization"
          : /memory|ram/i.test(r.title)
            ? "Memory pressure"
            : /backup/i.test(r.title)
              ? "Backup outcome or freshness"
              : /latency|duration/i.test(r.title)
                ? "Request or job latency"
                : /queue|rabbitmq/i.test(r.title)
                  ? "Queue and message broker health"
                  : /disk|filesystem/i.test(r.title)
                    ? "Storage capacity and I/O"
                    : /log/i.test(r.title)
                      ? "Log pipeline health"
                      : "Service metric or SLO expression",
        datasource: "Grafana Cloud",
        runbook: "https://localserver.wiki.ramideltoro.com/technical/alerts/",
        kind: run?.type || "alerting",
        silenceScope: ruleSilenced
          ? "rule"
          : silenced
            ? "active instances"
            : null,
        evaluationNote: run
          ? "Actual rule-group interval"
          : "Rule-group evaluation metadata unavailable",
      };
    }),
  };
}
