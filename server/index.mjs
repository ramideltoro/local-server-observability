import { createOperations } from "./operations.mjs";
import { alertCatalog } from "./alerts.mjs";
import { workspace } from "./workspace.mjs";
import { startGateway } from "./native.mjs";
import http from "node:http";
import { startWebsiteMonitor } from "./websites.mjs";
const websiteMonitor = startWebsiteMonitor();
import { snapshot, metrics as collectorMetrics } from "./collector.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGoogleAuth } from "./google-auth.mjs";
import {
  windowFor,
  redact,
  publicSeries,
  metricState,
  publicMetrics,
} from "./core.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  await fs.readFile(root + "/config/catalog.json", "utf8"),
);
let release = {};
try {
  release = JSON.parse(await fs.readFile(root + "/release.json", "utf8"));
} catch {}
const env = process.env,
  base = (env.GRAFANA_URL || "").replace(/\/$/, "");
const cache = new Map();
let activeQueries = 0;
async function cached(key, fn, ttl = 30000) {
  const c = cache.get(key);
  if (c && c.expires > Date.now()) return c.value;
  if (c?.promise) return c.promise;
  const promise = fn()
    .then((value) => {
      cache.set(key, { value, expires: Date.now() + ttl });
      return value;
    })
    .catch((e) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, { promise });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return promise;
}
async function grafana(route) {
  if (!base || !env.GRAFANA_SERVICE_ACCOUNT_TOKEN)
    throw Error("Telemetry source is not configured");
  if (activeQueries >= 24) throw Error("Telemetry source is busy");
  activeQueries++;
  try {
    const r = await fetch(base + route, {
      headers: { Authorization: "Bearer " + env.GRAFANA_SERVICE_ACCOUNT_TOKEN },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw Error(`Telemetry source returned ${r.status}`);
    return await r.json();
  } finally {
    activeQueries--;
  }
}
const prom =
  env.PROMETHEUS_UID || env.NUTSNEWS_GRAFANA_CLOUD_PROMETHEUS_DATASOURCE_UID;
const loki = env.LOKI_UID || env.NUTSNEWS_GRAFANA_CLOUD_LOKI_DATASOURCE_UID;
async function query(expr, range, uid = prom) {
  const w = windowFor(range);
  const key = JSON.stringify([expr, range, uid]);
  return cached(key, async () => {
    const p = new URLSearchParams({
      query: expr,
      start: String(w.start),
      end: String(w.end),
      step: String(w.step),
    });
    const j = await grafana(
      `/api/datasources/proxy/uid/${encodeURIComponent(uid)}/api/v1/query_range?${p}`,
    );
    if (j.status !== "success") throw Error("Metric query unavailable");
    return (j.data?.result || []).slice(0, 24);
  });
}
const { owner, identity, handle: handleAuth } = createGoogleAuth(env);
function json(res, code, data, privateData = false) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": privateData ? "private, no-store" : "public, max-age=15",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}
async function health(url) {
  const start = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return {
      status: r.ok ? "healthy" : "degraded",
      latencyMs: Date.now() - start,
    };
  } catch {
    return { status: "unavailable", latencyMs: null };
  }
}
async function mapBounded(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}
async function overview(range) {
  return cached("overview:" + range, async () => {
    const metrics = await mapBounded(publicMetrics, async (m) => {
      try {
        const series = publicSeries(await query(m.expr, range));
        return {
          id: m.id,
          title: m.title,
          unit: m.unit,
          series,
          state: metricState(series),
        };
      } catch {
        return {
          id: m.id,
          title: m.title,
          unit: m.unit,
          series: [],
          state: "unavailable",
        };
      }
    });
    const services = await Promise.all(
      [
        {
          id: "nutsnews",
          name: "NutsNews",
          description: "Public application",
          url: "https://nutsnews.com",
        },
        {
          id: "qwen",
          name: "Qwen local AI",
          description: "Production inference endpoint",
          url: "https://ai.nutsnews.com/health",
        },
        {
          id: "backend",
          name: "NutsNews backend",
          description: "Backend API",
          url: "https://backend.nutsnews.com/readyz",
        },
      ].map(async (s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        ...(await health(s.url)),
      })),
    );
    return {
      updatedAt: new Date().toISOString(),
      metrics,
      services: [...services, ...websiteMonitor.services()],
      release: release.portal?.slice(0, 12) || "development",
    };
  });
}
function substitute(expr, application) {
  if (application === "local")
    expr = expr.replace(/\$\{?instance(?::regex)?\}?/g, "chingadera");
  return expr
    .replace(/\$\{?__rate_interval\}?/g, "5m")
    .replace(/\$\{?__interval\}?/g, "5m")
    .replace(/\$\{?__range_s\}?/g, "3600")
    .replace(/\$\{?__range\}?/g, "1h")
    .replace(/\$\{?__auto\}?/g, "5m")
    .replace(/\$\{?[a-zA-Z_][a-zA-Z0-9_]*(?::[a-z]+)?\}?/g, ".*");
}
async function dashboard(id, range) {
  const d = catalog.find((x) => x.id === id);
  if (!d) return null;
  const panels = [];
  for (let start = 0; start < d.panels.length; start += 6) {
    panels.push(
      ...(await Promise.all(
        d.panels.slice(start, start + 6).map(async (p) => {
          try {
            const results = await Promise.all(
              p.queries.map((q) =>
                query(
                  substitute(q, d.application),
                  range,
                  p.datasource === "grafanacloud-usage"
                    ? "grafanacloud-usage"
                    : prom,
                ),
              ),
            );
            const series = results.flat().map((r, i) => ({
              name:
                Object.entries(r.metric || {})
                  .filter(([k]) => k !== "__name__")
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ") || `Series ${i + 1}`,
              values: r.values || [r.value],
            }));
            return {
              ...p,
              queries: undefined,
              series,
              state: metricState(series),
            };
          } catch (e) {
            return {
              ...p,
              queries: undefined,
              series: [],
              state: "unavailable",
              error: e.message,
            };
          }
        }),
      )),
    );
  }
  return { ...d, panels };
}
const loadRules = () => cached("operations-rules", async () => {
 const [config, groups, alerts, silences] = await Promise.all([grafana("/api/v1/provisioning/alert-rules"),grafana("/api/prometheus/grafana/api/v1/rules"),grafana("/api/alertmanager/grafana/api/v2/alerts"),grafana("/api/alertmanager/grafana/api/v2/silences")]);
 return alertCatalog(config,groups,alerts,new Date().toISOString(),silences);
},60000);
async function logPresence(selector) {
  const end=Date.now(), p=new URLSearchParams({query:selector,start:String(BigInt(end-3600000)*1000000n),end:String(BigInt(end)*1000000n),limit:"1",direction:"backward"});
  const j=await grafana('/api/datasources/proxy/uid/'+encodeURIComponent(loki)+'/loki/api/v1/query_range?'+p);
  const ts=(j.data?.result||[]).flatMap(s=>s.values||[]).map(v=>Number(BigInt(v[0])/1000000n));
  if(j.status!=="success"||!ts.length) return null;
  return new Date(Math.max(...ts)).toISOString();
}
const operations = await createOperations({root,overview,query,logPresence,rules:loadRules,owner,identity,json,release,disabled:env.OPERATIONS_DISABLED === "true"});
const handleWorkspace = workspace({ owner, grafana, json, cached, root, operations });
startGateway(env);
const rates = new Map();
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://localhost");
  const pathname = u.pathname;
  if (pathname === "/healthz") res.once("finish", () => console.log(JSON.stringify({event:"health-response",status:res.statusCode})));
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  );
  try {
    if (await handleAuth(req, res, u)) return;
    if (await handleWorkspace(req, res, u)) return;
    if (req.method !== "GET")
      return json(res, 405, { error: "Read-only endpoint" });
    if (pathname === "/healthz")
      return json(res, 200, {
        ok: true,
        authentication: "google",
        release: release.portal || "development",
      });
    if (pathname.startsWith("/api/")) {
      const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress;
      const now = Date.now(),
        r = rates.get(ip) || { n: 0, until: now + 60000 };
      if (r.until < now) {
        r.n = 0;
        r.until = now + 60000;
      }
      r.n++;
      rates.set(ip, r);
      if (rates.size > 2000) rates.delete(rates.keys().next().value);
      if (r.n > 120)
        return json(res, 429, { error: "Please wait before refreshing again" });
    }
    if (pathname === "/api/public/release") {
      res.setHeader(
        "Access-Control-Allow-Origin",
        "https://localserver.wiki.ramideltoro.com",
      );
      return json(res, 200, release);
    }
    if (pathname === "/api/public/overview")
      return json(res, 200, { ...await overview(u.searchParams.get("range")), health: operations.health() });
    if (pathname.startsWith("/api/owner/") || pathname.startsWith("/owner")) {
      if (!(await owner(req))) {
        if (pathname.startsWith("/api/"))
          return json(res, 401, { error: "Owner sign-in required" }, true);
        res.writeHead(302, {
          Location: "/auth/google",
          "Cache-Control": "private, no-store",
        });
        return res.end();
      }
      res.setHeader("Cache-Control", "private, no-store");
    }
    if (pathname === "/api/owner/catalog")
      return json(
        res,
        200,
        catalog.map(({ panels, ...d }) => ({
          ...d,
          panelCount: panels.length,
        })),
        true,
      );
    if (pathname.startsWith("/api/owner/dashboard/")) {
      const d = await dashboard(
        pathname.split("/").pop(),
        u.searchParams.get("range"),
      );
      return json(
        res,
        d ? 200 : 404,
        d || { error: "Unknown dashboard" },
        true,
      );
    }
    if (pathname === "/api/owner/alerts") {
      const alerts = await cached("alerts", () =>
        grafana("/api/alertmanager/grafana/api/v2/alerts"),
      );
      return json(
        res,
        200,
        alerts.map((a) => ({
          name: a.labels?.alertname,
          state: a.status?.state,
          severity: a.labels?.severity,
          summary: redact(a.annotations?.summary || ""),
          since: a.startsAt,
        })),
        true,
      );
    }
    if (pathname === "/api/owner/logs") {
      const w = windowFor(u.searchParams.get("range"));
      const application = ["local", "backend-vps", "nutsnews-vps", "raspberry", "mookie"].includes(
        u.searchParams.get("application"),
      )
        ? u.searchParams.get("application")
        : "nutsnews";
      const term = (u.searchParams.get("search") || "").slice(0, 120);
      const selector =
        application === "raspberry"
          ? '{instance="rpi4",project="raspberry"}'
          : application === "mookie"
          ? '{instance="mookie"}'
          : application === "local"
          ? '{instance="chingadera"}'
          : application === "backend-vps"
            ? '{instance="backend.nutsnews.com"}'
            : application === "nutsnews-vps"
              ? '{instance="vps.nutsnews.com"}'
              : '{instance=~"(vps|backend).nutsnews.com"}';
      const p = new URLSearchParams({
        query: selector + (term ? " |= " + JSON.stringify(term) : ""),
        start: String(BigInt(w.start) * 1000000000n),
        end: String(BigInt(w.end) * 1000000000n),
        limit: "150",
        direction: "backward",
      });
      const j = await grafana(
        `/api/datasources/proxy/uid/${encodeURIComponent(loki)}/loki/api/v1/query_range?${p}`,
      );
      return json(
        res,
        200,
        {
          entries: (j.data?.result || [])
            .flatMap((s) =>
              s.values.map(([t, line]) => ({
                time: new Date(Number(BigInt(t) / 1000000n)).toISOString(),
                service: s.stream.service_name || s.stream.unit || s.stream.job,
                line: redact(line),
              })),
            )
            .sort((a, b) => b.time.localeCompare(a.time))
            .slice(0, 150),
        },
        true,
      );
    }
    if (pathname === "/api/owner/traces") {
      const w = windowFor(u.searchParams.get("range"));
      const ds = await cached(
        "sources",
        () => grafana("/api/datasources"),
        3600000,
      );
      const tempo = ds.find((d) => d.type === "tempo");
      if (!tempo)
        return json(res, 200, { traces: [], state: "not-configured" }, true);
      const j = await grafana(
        `/api/datasources/proxy/uid/${encodeURIComponent(tempo.uid)}/api/search?start=${w.start}&end=${w.end}&limit=20`,
      );
      return json(
        res,
        200,
        {
          traces: j.traces || [],
          state: j.traces?.length ? "live" : "no-traces",
          note: "Worker trace export follows the existing telemetry policy; no traces is not a healthy-status assertion.",
        },
        true,
      );
    }
    if (pathname === "/api/owner/host")
      return json(res, 200, await cached("host", snapshot), true);
    if (pathname === "/api/owner/local") {
      const r = await fetch("http://127.0.0.1:8788/stats", {
        headers: { "x-nutsnews-ai-key": env.LOCAL_AI_API_KEY || "" },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error("Local AI statistics unavailable");
      return json(res, 200, await r.json(), true);
    }
    if (pathname.startsWith("/api/"))
      return json(res, 404, { error: "Unknown endpoint" });
    const safe = path.resolve(root, "dist", "." + decodeURIComponent(pathname));
    if (safe !== root + "/dist" && !safe.startsWith(root + "/dist/"))
      return json(res, 404, { error: "Not found" });
    let file = safe;
    let body;
    try {
      body = await fs.readFile(file);
    } catch {
      file = root + "/dist/index.html";
      body = await fs.readFile(file);
    }
    const ext = path.extname(file);
    const types = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    res.setHeader("Content-Type", types[ext] || "application/octet-stream");
    res.end(body);
  } catch (e) {
    json(res, 502, { error: redact(e.message) }, true);
  }
});
server.listen(Number(env.PORT || 4310), "127.0.0.1", () =>
  console.log("Observability portal listening on loopback"),
);
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => server.close(() => process.exit(0)));

const metricsServer = http.createServer(async (req, res) => {
  if (req.url !== "/metrics") {
    res.writeHead(404);
    return res.end();
  }
  try {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.end(
      (await cached("collector", collectorMetrics, 15000)) +
        "\n" +
        websiteMonitor.metrics(),
    );
  } catch {
    res.writeHead(503);
    res.end("Collector unavailable");
  }
});
metricsServer.listen(Number(env.METRICS_PORT || 4311), "127.0.0.1");
