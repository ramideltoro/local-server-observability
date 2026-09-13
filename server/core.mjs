export const ranges = { "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800 };
export function windowFor(value, now = Date.now() / 1000) {
  const duration = ranges[value] || 3600;
  return {
    start: Math.floor(now - duration),
    end: Math.floor(now),
    step: Math.max(30, Math.ceil(duration / 180)),
  };
}
export function redact(text) {
  return String(text)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /((?:password|token|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;}]+/gi,
      "$1[redacted]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
}
export function publicSeries(results) {
  return results.map((r, i) => ({
    name: `Series ${i + 1}`,
    values: r.values || [r.value],
  }));
}
export function metricState(series, now = Date.now() / 1000) {
  const values = series
    .flatMap((s) => s.values || [])
    .filter((v) => Number.isFinite(Number(v[1])));
  if (!values.length) return "unavailable";
  return now - Math.max(...values.map((v) => Number(v[0]))) > 180
    ? "stale"
    : "live";
}
export const publicMetrics = [
  {
    id: "cpu",
    title: "CPU utilization",
    unit: "percent",
    expr: '100 * (1 - avg(rate(node_cpu_seconds_total{instance="chingadera",job="integrations/node_exporter",mode="idle"}[5m])))',
  },
  {
    id: "memory",
    title: "Memory used",
    unit: "percent",
    expr: '100 * (1 - max(node_memory_MemAvailable_bytes{instance="chingadera",job="integrations/node_exporter"}) / max(node_memory_MemTotal_bytes{instance="chingadera",job="integrations/node_exporter"}))',
  },
  {
    id: "disk",
    title: "Disk used",
    unit: "percent",
    expr: '100 * (1 - max(node_filesystem_avail_bytes{instance="chingadera",job="integrations/node_exporter",mountpoint="/"}) / max(node_filesystem_size_bytes{instance="chingadera",job="integrations/node_exporter",mountpoint="/"}))',
  },
  {
    id: "load",
    title: "System load",
    unit: "short",
    expr: 'max(node_load1{instance="chingadera",job="integrations/node_exporter"})',
  },
  {
    id: "network",
    title: "Network receive",
    unit: "Bps",
    expr: 'sum(rate(node_network_receive_bytes_total{instance="chingadera",job="integrations/node_exporter",device!="lo"}[5m]))',
  },
  {
    id: "uptime",
    title: "Uptime",
    unit: "s",
    expr: 'time() - max(node_boot_time_seconds{instance="chingadera",job="integrations/node_exporter"})',
  },
  {
    id: "nutsnews-cpu",
    title: "NutsNews host CPU",
    unit: "percent",
    expr: '100 * (1 - avg(rate(node_cpu_seconds_total{instance=~"(vps|backend).nutsnews.com",mode="idle"}[5m])))',
  },
  {
    id: "nutsnews-queues",
    title: "Queued worker messages",
    unit: "short",
    expr: "sum(rabbitmq_queue_messages_ready)",
  },
];

for (const id of ["ramideltoro", "showalgo", "fantasy"]) {
  for (const [metric, title, unit, expr] of [
    [
      "availability",
      "Availability",
      "percent",
      `100 * avg_over_time(website_probe_success{website="${id}"}[1h])`,
    ],
    [
      "latency",
      "HTTPS response time",
      "s",
      `website_probe_duration_seconds{website="${id}"}`,
    ],
    [
      "status",
      "HTTP status",
      "short",
      `website_probe_status_code{website="${id}"}`,
    ],
    [
      "certificate",
      "Certificate remaining",
      "s",
      `website_probe_certificate_expiry_timestamp_seconds{website="${id}"} - time()`,
    ],
  ])
    publicMetrics.push({ id: `${id}-${metric}`, title, unit, expr });
}

publicMetrics.push({
  id: "fantasy-database",
  title: "Backend & database health",
  unit: "percent",
  expr: '100 * website_probe_success{website="fantasy-health"}',
});
for (const [id, instance] of [
  ["backend-vps", "backend.nutsnews.com"],
  ["nutsnews-vps", "vps.nutsnews.com"],
]) {
  for (const [metric, title, unit, expr] of [
    [
      "cpu",
      "CPU utilization",
      "percent",
      `100 * (1 - avg(rate(node_cpu_seconds_total{instance="${instance}",mode="idle"}[5m])))`,
    ],
    [
      "memory",
      "Memory used",
      "percent",
      `100 * (1 - max(node_memory_MemAvailable_bytes{instance="${instance}"}) / max(node_memory_MemTotal_bytes{instance="${instance}"}))`,
    ],
    [
      "disk",
      "Root disk used",
      "percent",
      `100 * (1 - max(node_filesystem_avail_bytes{instance="${instance}",mountpoint="/"}) / max(node_filesystem_size_bytes{instance="${instance}",mountpoint="/"}))`,
    ],
    ["load", "System load", "short", `max(node_load1{instance="${instance}"})`],
  ])
    publicMetrics.push({ id: id + "-" + metric, title, unit, expr });
}

publicMetrics.push({id:'raspberry-cpu',title:'Raspberry CPU',unit:'percent',expr:'100*sum(rate(pi_public_cpu_seconds_total{project="raspberry",mode!="idle"}[5m]))/sum(rate(pi_public_cpu_seconds_total{project="raspberry"}[5m]))'},{id:'raspberry-temperature',title:'Raspberry temperature',unit:'celsius',expr:'pi_public_temperature_celsius{project="raspberry"}'},{id:'raspberry-memory-available',title:'Raspberry available memory',unit:'bytes',expr:'pi_public_memory_available_bytes{project="raspberry"}'});
