import http from "node:http";
import fs from "node:fs/promises";
import { validateQuery, boundedJSON, sanitizeResult } from "./gateway.mjs";
export async function body(req, limit = 262144) {
  let n = 0,
    chunks = [];
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw Error("Request budget exceeded");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
export function publicRoute(method, pathname) {
  if (method === "POST") return pathname === "/api/ds/query";
  if (method !== "GET") return false;
  return (
    /^\/(?:public\/|d\/|d-solo\/)/.test(pathname) ||
    [
      "/",
      "/api/frontend/settings",
      "/api/health",
      "/api/search",
      "/api/user",
      "/api/user/preferences",
      "/api/org",
      "/api/org/preferences",
      "/api/datasources",
      "/api/plugins",
      "/api/annotations",
    ].includes(pathname) ||
    /^\/api\/(?:dashboards\/uid\/[a-zA-Z0-9_-]+|datasources\/uid\/[a-zA-Z0-9_-]+|plugins\/[a-zA-Z0-9_-]+\/settings)$/.test(
      pathname,
    )
  );
}
export async function proxyGrafana(req, res, url, isOwner) {
  const prefix = isOwner ? "/owner/grafana" : "/grafana";
  const route = url.pathname.slice(prefix.length) || "/";
  if (/%|\\|\.\./.test(route)) {
    res.writeHead(400);
    return res.end("Invalid path");
  }
  if (!isOwner && !publicRoute(req.method, route)) {
    res.writeHead(403);
    return res.end("Public Grafana is read-only");
  }
  if (
    isOwner &&
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.origin !== "https://observe.ramideltoro.com"
  ) {
    res.writeHead(403);
    return res.end("Invalid origin");
  }
  const payload = await body(req);
  if (!isOwner && req.method === "POST") {
    let b;
    try {
      b = JSON.parse(payload);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (
      !Array.isArray(b.queries) ||
      !b.queries.length ||
      b.queries.length > 8
    ) {
      res.writeHead(400);
      return res.end();
    }
    for (const q of b.queries) {
      if (
        q.datasource?.uid !== "public-metrics" ||
        q.datasource?.type !== "prometheus" ||
        typeof q.expr !== "string"
      ) {
        res.writeHead(403);
        return res.end("Unregistered datasource");
      }
      try {
        validateQuery(
          new URLSearchParams({
            query: q.expr,
            start: String(Number(b.from) / 1000),
            end: String(Number(b.to) / 1000),
            step: String(
              Math.max(
                30,
                Math.ceil((Number(b.to) - Number(b.from)) / 1000 / 180),
              ),
            ),
          }),
        );
      } catch {
        res.writeHead(403);
        return res.end("Unregistered or unbounded query");
      }
    }
  }
  const headers = {
    host: "observe.ramideltoro.com",
    "x-forwarded-proto": "https",
    "content-type": req.headers["content-type"] || "application/json",
    ...(isOwner ? { "x-webauth-user": "portal-owner" } : {}),
  };
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: isOwner ? 4321 : 4320,
      path: url.pathname + url.search,
      method: req.method,
      headers,
      timeout: 20000,
    },
    (response) => {
      res.removeHeader("Content-Security-Policy");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
      for (const key of [
        "content-type",
        "content-encoding",
        "location",
        "etag",
      ])
        if (response.headers[key]) res.setHeader(key, response.headers[key]);
      res.setHeader(
        "Cache-Control",
        isOwner ? "private, no-store" : "no-store",
      );
      res.writeHead(response.statusCode);
      response.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("Grafana temporarily unavailable");
  });
  upstream.end(payload);
}
export function startGateway(env) {
  let active = 0;
  const s = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (
        !["/api/v1/query_range", "/api/v1/query"].includes(u.pathname) ||
        !["GET", "POST"].includes(req.method)
      )
        throw Error("Unsupported endpoint");
      const p =
        req.method === "POST"
          ? new URLSearchParams((await body(req, 16384)).toString())
          : u.searchParams;
      const { metric, start, end, step } = validateQuery(p);
      if (active >= 6) throw Error("Query concurrency exceeded");
      active++;
      try {
        const params = new URLSearchParams({
          query: metric.expr,
          start: String(start),
          end: String(end),
          step: String(step),
          time: String(end),
        });
        const upstream = await fetch(
          env.GRAFANA_URL.replace(/\/$/, "") +
            "/api/datasources/proxy/uid/" +
            encodeURIComponent(env.PROMETHEUS_UID) +
            u.pathname +
            "?" +
            params,
          {
            headers: {
              Authorization: "Bearer " + env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
            },
            signal: AbortSignal.timeout(12000),
          },
        );
        const data = sanitizeResult(await boundedJSON(upstream));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } finally {
        active--;
      }
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "error",
          error: "Query unavailable or outside approved bounds",
        }),
      );
    }
  });
  s.listen(Number(env.GATEWAY_PORT || 4312), "127.0.0.1");
  return s;
}
export async function nativeCatalog() {
  try {
    return JSON.parse(
      await fs.readFile(
        (process.env.DATA_DIR || "/var/lib/local-server-observability") +
          "/catalog.json",
        "utf8",
      ),
    );
  } catch {
    return { dashboards: [], state: "Synchronization has not completed" };
  }
}
