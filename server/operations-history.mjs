import fs from "node:fs";
import { openOperations } from "./operations-store.mjs";
import { publicMetrics } from "./core.mjs";
const config = JSON.parse(
  fs.readFileSync(new URL("../config/operations.json", import.meta.url)),
);
const store = openOperations(),
  end = Math.floor(Date.now() / 60000) * 60,
  gaps = [];
const jobs = config.systems.flatMap((s) =>
  s.checks
    .filter((c) => c.metric && c.category === "resources")
    .map((c) => ({
      system: s.id,
      signal: c.id,
      expr: publicMetrics.find((m) => m.id === c.metric)?.expr,
      days: 14,
      step: 3600,
    })),
);
for (const id of ["fantasy", "ramideltoro", "showalgo"])
  jobs.push({
    system: id,
    signal: "endpoint:" + id,
    expr: `min(website_probe_success{website="${id}"} and (time() - timestamp(website_probe_success{website="${id}"}) < 120))`,
    days: 30,
    step: 60,
  });
for (const job of jobs) {
  if (!job.expr) continue;
  try {
    const params = new URLSearchParams({
      query: job.expr,
      start: String(end - job.days * 86400),
      end: String(end),
      step: String(job.step),
    });
    const r = await fetch(
      process.env.GRAFANA_URL.replace(/\/$/, "") +
        "/api/datasources/proxy/uid/" +
        encodeURIComponent(process.env.PROMETHEUS_UID) +
        "/api/v1/query_range?" +
        params,
      {
        headers: {
          Authorization: "Bearer " + process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) throw Error();
    const text = await r.text();
    if (text.length > 2500000) throw Error();
    const j = JSON.parse(text);
    if (j.status !== "success" || j.data.result.length > 24) throw Error();
    const points = new Map();
    for (const series of j.data.result)
      for (const [at, v] of series.values || [])
        if (Number.isFinite(Number(v)))
          points.set(at, Math.max(points.get(at) ?? -Infinity, Number(v)));
    if (!points.size)
      gaps.push(job.system + ": " + job.signal + " history unavailable");
    store.db.exec("BEGIN");
    try {
      const insert = store.db.prepare(
        "INSERT OR IGNORE INTO samples VALUES (?,?,?,?,?)",
      );
      for (const [at, value] of points)
        insert.run(
          job.system,
          job.signal,
          at * 1000,
          value,
          job.signal.startsWith("endpoint:")
            ? value === 1
              ? "pass"
              : "fail"
            : "unknown",
        );
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
  } catch {
    gaps.push(
      job.system + ": " + job.signal + " bounded history import failed",
    );
  }
}
store.put("historyCoverage", { at: Date.now(), gaps });
store.close();
console.log(
  "Bounded history import completed; " + gaps.length + " gaps recorded.",
);
