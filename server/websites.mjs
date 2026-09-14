import https from "node:https";
export const websites = [
  {
    id: "fantasy",
    name: "Fantasy Football Edge",
    description: "fantasy.ramideltoro.com · Website",
    url: "https://fantasy.ramideltoro.com",
  },
  {
    id: "fantasy-health",
    name: "Fantasy backend & database",
    description: "Database connectivity health check",
    url: "https://fantasy.ramideltoro.com/healthz",
  },
  {
    id: "ramideltoro",
    name: "Rami Del Toro",
    description: "www.ramideltoro.com · HTTPS availability",
    url: "https://www.ramideltoro.com",
  },
  {
    id: "showalgo",
    name: "ShowAlgo",
    description: "www.showalgo.com · HTTPS availability",
    url: "https://www.showalgo.com",
  },
];
export function probeWebsite(site, request = https.get) {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({
        id: site.id,
        checkedAt: Date.now() / 1000,
        statusCode: 0,
        success: 0,
        durationSeconds: (performance.now() - started) / 1000,
        certificateExpiry: null,
        ...result,
      });
    };
    const req = request(
      site.url,
      {
        headers: {
          "User-Agent": "LocalServerObservability/1.0",
          Accept: "text/html",
        },
        rejectUnauthorized: true,
      },
      (res) => {
        const certificateExpiry =
          Date.parse(res.socket.getPeerCertificate()?.valid_to) / 1000;
        const statusCode = res.statusCode || 0;
        // Measure time to response headers; never retain page contents or cookies.
        finish({
          statusCode,
          success: statusCode >= 200 && statusCode < 300 ? 1 : 0,
          certificateExpiry: Number.isFinite(certificateExpiry)
            ? certificateExpiry
            : null,
        });
        res.destroy();
      },
    );
    const deadline = setTimeout(() => {
      finish({});
      req.destroy();
    }, 8000);
    req.on("error", () => finish({}));
  });
}
export function websiteMetrics(samples) {
  return (
    samples
      .map((s) => {
        const label = `{website="${s.id}"}`;
        return [
          ["success", s.success],
          ["duration_seconds", s.durationSeconds],
          ["status_code", s.statusCode],
          ["last_check_timestamp_seconds", s.checkedAt],
          ...(s.certificateExpiry === null
            ? []
            : [["certificate_expiry_timestamp_seconds", s.certificateExpiry]]),
        ]
          .map(([name, value]) => `website_probe_${name}${label} ${value}`)
          .join("\n");
      })
      .join("\n") + "\n"
  );
}
export function startWebsiteMonitor({
  probe = probeWebsite,
  intervalMs = 60000,
} = {}) {
  let samples = [],
    pending;
  const refresh = () =>
    (pending ||= Promise.all(websites.map((site) => probe(site)))
      .then((v) => {
        samples = v;
      })
      .finally(() => {
        pending = null;
      }));
  const timer = setInterval(refresh, intervalMs);
  timer.unref();
  void refresh();
  return {
    metrics: () => websiteMetrics(samples),
    services: () =>
      websites.map((s) => {
        const sample = samples.find((v) => v.id === s.id);
        return {
          id: s.id,
          name: s.name,
          description: s.description,
          status:
            !sample || Date.now() / 1000 - sample.checkedAt > 180
              ? "unknown"
              : sample.success
                ? "healthy"
                : "degraded",
          latencyMs: sample ? Math.round(sample.durationSeconds * 1000) : null,
        };
      }),
    stop: () => clearInterval(timer),
  };
}
