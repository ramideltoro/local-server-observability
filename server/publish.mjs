import { randomUUID } from "node:crypto";
import { registeredQueries, queryKey } from "./gateway.mjs";
export function publishable(dashboard) {
  if (
    !dashboard ||
    typeof dashboard.title !== "string" ||
    dashboard.title.length > 180 ||
    !Array.isArray(dashboard.panels) ||
    dashboard.panels.length > 100
  )
    throw Error("Invalid dashboard");
  const text = JSON.stringify(dashboard);
  if (
    text.length > 250000 ||
    /(?:Bearer\s+[A-Za-z0-9._-]{15}|gh[pousr]_[A-Za-z0-9]+|AIza[\w-]+|-----BEGIN .*PRIVATE KEY)/.test(
      text,
    )
  )
    throw Error("Dashboard contains unsupported or sensitive content");
  const panels = dashboard.panels.map((p) => {
    if (
      ![
        "timeseries",
        "stat",
        "gauge",
        "bargauge",
        "table",
        "heatmap",
        "piechart",
        "barchart",
        "histogram",
        "row",
      ].includes(p.type)
    )
      throw Error("Only reviewed native metric panels can be published");
    const targets = (p.targets || []).map((t, i) => {
      const expr = registeredQueries.has(t.expr)
        ? t.expr
        : queryKey(t.expr || "");
      if (!registeredQueries.has(expr))
        throw Error("Query must first be registered and reviewed in Git");
      return {
        refId: String.fromCharCode(65 + i),
        expr,
        datasource: { type: "prometheus", uid: "public-metrics" },
      };
    });
    return {
      id: p.id,
      title: String(p.title || "Metric").slice(0, 160),
      type: p.type,
      gridPos: p.gridPos,
      targets,
      datasource: { type: "prometheus", uid: "public-metrics" },
      fieldConfig: {
        defaults: { unit: p.fieldConfig?.defaults?.unit || "short" },
        overrides: [],
      },
      options: {},
    };
  });
  return {
    uid: "published-" + randomUUID().slice(0, 12),
    title: dashboard.title,
    editable: false,
    schemaVersion: 39,
    panels,
    time: { from: "now-1h", to: "now" },
    annotations: { list: [] },
    templating: { list: [] },
  };
}
export async function publishDashboard(uid, token) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(uid)) throw Error("Invalid dashboard UID");
  const r = await fetch(
    "http://127.0.0.1:4321/owner/grafana/api/dashboards/uid/" + uid,
    {
      headers: { "X-WEBAUTH-USER": "portal-owner" },
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!r.ok) throw Error("Workspace dashboard unavailable");
  const { dashboard, meta } = await r.json();
  if (meta?.provisioned)
    throw Error("Create an editable copy before publishing");
  const safe = publishable(dashboard),
    repo =
      "https://api.github.com/repos/ramideltoro/local-server-observability";
  async function api(path, method = "GET", body) {
    const r = await fetch(repo + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("Git publishing failed: " + r.status);
    return r.json();
  }
  const main = await api("/git/ref/heads/main"),
    branch = "publish/" + safe.uid;
  await api("/git/refs", "POST", {
    ref: "refs/heads/" + branch,
    sha: main.object.sha,
  });
  await api("/contents/config/published/" + safe.uid + ".json", "PUT", {
    message: "Publish reviewed metric dashboard: " + safe.title,
    branch,
    content: Buffer.from(JSON.stringify(safe, null, 2) + "\n").toString(
      "base64",
    ),
  });
  const pr = await api("/pulls", "POST", {
    title: "Publish dashboard: " + safe.title,
    head: branch,
    base: "main",
    body: "Publishes a sanitized native metric dashboard. Queries are restricted to the Git-managed registry; private text, links, variables and labels are omitted. The editable workspace copy is preserved. Merge after CI and documentation synchronization.",
  });
  return { url: pr.html_url };
}
