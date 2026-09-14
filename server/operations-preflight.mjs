import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOperations } from "./operations.mjs";
import { alertCatalog } from "./alerts.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function cloud(route) {
  const r = await fetch(process.env.GRAFANA_URL.replace(/\/$/, "") + route, {
    headers: {
      Authorization: "Bearer " + process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("Telemetry unavailable");
  return r.json();
}
const ops = await createOperations({
  root,
  disabled: true,
  release: {},
  owner: async () => false,
  identity: async () => false,
  json: () => {},
  overview: async () => {
    const r = await fetch("http://127.0.0.1:4310/api/public/overview");
    if (!r.ok) throw Error();
    return r.json();
  },
  query: async (expr) => {
    const now = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      query: expr,
      start: String(now - 300),
      end: String(now),
      step: "60",
    });
    const j = await cloud(
      "/api/datasources/proxy/uid/" +
        process.env.PROMETHEUS_UID +
        "/api/v1/query_range?" +
        params,
    );
    if (j.status !== "success") throw Error();
    return j.data.result.slice(0, 24);
  },
  rules: async () => {
    const [rules, groups, alerts, silences] = await Promise.all(
      [
        "/api/v1/provisioning/alert-rules",
        "/api/prometheus/grafana/api/v1/rules",
        "/api/alertmanager/grafana/api/v2/alerts",
        "/api/alertmanager/grafana/api/v2/silences",
      ].map(cloud),
    );
    return alertCatalog(
      rules,
      groups,
      alerts,
      new Date().toISOString(),
      silences,
    );
  },
});
await ops.collect();
const result = ops.health();
if (
  !result.at ||
  !result.systems.length ||
  !result.systems.some((s) => s.coverage > 0)
)
  throw Error("Operational evidence preflight failed");
ops.close();
console.log("Operational storage and evidence preflight passed.");
