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

publicMetrics.push(
  {
    id: "raspberry-cpu",
    title: "Raspberry CPU",
    unit: "percent",
    expr: '100*(1-avg(rate(node_cpu_seconds_total{instance="rpi4",mode="idle"}[5m])))',
  },
  {
    id: "raspberry-temperature",
    title: "Raspberry temperature",
    unit: "celsius",
    expr: 'raspberry_temperature_celsius{instance="rpi4"}',
  },
  {
    id: "raspberry-memory-available",
    title: "Raspberry available memory",
    unit: "bytes",
    expr: 'node_memory_MemAvailable_bytes{instance="rpi4"}',
  },
);

// Fixed host scope; public results strip all private labels.
export const mookieMetrics = [
  {
    "id": "mookie-cpu",
    "title": "CPU utilization",
    "unit": "percent",
    "expr": "100*(1-avg(rate(node_cpu_seconds_total{instance=\"mookie\",mode=\"idle\"}[5m])))",
    "inspectionThreshold": 90
  },
  {
    "id": "mookie-memory",
    "title": "Memory used",
    "unit": "percent",
    "expr": "100*(1-max(node_memory_MemAvailable_bytes{instance=\"mookie\"})/max(node_memory_MemTotal_bytes{instance=\"mookie\"}))",
    "inspectionThreshold": 90
  },
  {
    "id": "mookie-disk",
    "title": "Root disk used",
    "unit": "percent",
    "expr": "100*(1-max(node_filesystem_avail_bytes{instance=\"mookie\",mountpoint=\"/\"})/max(node_filesystem_size_bytes{instance=\"mookie\",mountpoint=\"/\"}))",
    "inspectionThreshold": 85
  },
  {
    "id": "mookie-load",
    "title": "System load",
    "unit": "short",
    "expr": "max(node_load1{instance=\"mookie\"})"
  },
  {
    "id": "mookie-availability",
    "title": "Collector availability",
    "unit": "percent",
    "expr": "100*min(up{instance=\"mookie\",job=\"integrations/node_exporter\"})"
  },
  {
    "id": "mookie-uptime",
    "title": "Uptime",
    "unit": "s",
    "expr": "time()-max(node_boot_time_seconds{instance=\"mookie\"})"
  },
  {
    "id": "mookie-temperature",
    "title": "CPU temperature",
    "unit": "celsius",
    "expr": "max(mookie_temperature_celsius{instance=\"mookie\"})",
    "inspectionThreshold": 80
  },
  {
    "id": "mookie-undervoltage",
    "title": "Undervoltage now",
    "unit": "short",
    "expr": "max(mookie_undervoltage{instance=\"mookie\"})",
    "inspectionThreshold": 0
  },
  {
    "id": "mookie-throttled",
    "title": "Thermal throttling now",
    "unit": "short",
    "expr": "max(mookie_throttled{instance=\"mookie\"})",
    "inspectionThreshold": 0
  },
  {
    "id": "mookie-hardware-history",
    "title": "Hardware warning since boot",
    "unit": "short",
    "expr": "max(mookie_hardware_warning_since_boot{instance=\"mookie\"})"
  },
  {
    "id": "mookie-receive",
    "title": "Network receive",
    "unit": "Bps",
    "expr": "sum(rate(node_network_receive_bytes_total{instance=\"mookie\",device!=\"lo\"}[5m]))"
  },
  {
    "id": "mookie-transmit",
    "title": "Network transmit",
    "unit": "Bps",
    "expr": "sum(rate(node_network_transmit_bytes_total{instance=\"mookie\",device!=\"lo\"}[5m]))"
  },
  {
    "id": "mookie-disk-read",
    "title": "Disk read throughput",
    "unit": "Bps",
    "expr": "sum(rate(node_disk_read_bytes_total{instance=\"mookie\",device=\"mmcblk0\"}[5m]))"
  },
  {
    "id": "mookie-disk-write",
    "title": "Disk write throughput",
    "unit": "Bps",
    "expr": "sum(rate(node_disk_written_bytes_total{instance=\"mookie\",device=\"mmcblk0\"}[5m]))"
  },
  {
    "id": "mookie-iowait",
    "title": "CPU I/O wait",
    "unit": "percent",
    "expr": "100*avg(rate(node_cpu_seconds_total{instance=\"mookie\",mode=\"iowait\"}[5m]))"
  },
  {
    "id": "mookie-inodes",
    "title": "Root inodes used",
    "unit": "percent",
    "expr": "100*(1-max(node_filesystem_files_free{instance=\"mookie\",mountpoint=\"/\"})/max(node_filesystem_files{instance=\"mookie\",mountpoint=\"/\"}))"
  },
  {
    "id": "mookie-swap",
    "title": "Swap used",
    "unit": "percent",
    "expr": "100*(1-max(node_memory_SwapFree_bytes{instance=\"mookie\"})/clamp_min(max(node_memory_SwapTotal_bytes{instance=\"mookie\"}),1))"
  },
  {
    "id": "mookie-processes",
    "title": "Processes",
    "unit": "short",
    "expr": "sum(node_processes_pids{instance=\"mookie\"})"
  },
  {
    "id": "mookie-services-failed",
    "title": "Failed services",
    "unit": "short",
    "expr": "sum(node_systemd_unit_state{instance=\"mookie\",state=\"failed\"})",
    "inspectionThreshold": 0
  },
  {
    "id": "mookie-restarts",
    "title": "Service restarts over 1 hour",
    "unit": "short",
    "expr": "sum(increase(node_systemd_service_restart_total{instance=\"mookie\"}[1h]))",
    "inspectionThreshold": 3
  },
  {
    "id": "mookie-telemetry-age",
    "title": "Hardware telemetry age",
    "unit": "s",
    "expr": "time()-max(mookie_collector_timestamp_seconds{instance=\"mookie\"})",
    "inspectionThreshold": 180
  }
];
publicMetrics.push(...mookieMetrics);
export const qwenMetrics = [
  {id:'qwen-model',title:'Production model available',unit:'short',expr:'min(local_server_qwen_health)'},
  {id:'qwen-requests',title:'Production requests per minute',unit:'short',expr:'60 * sum(rate(local_qwen_requests_total[5m]))'},
  {id:'qwen-errors',title:'Production errors per minute',unit:'short',expr:'60 * sum(rate(local_qwen_errors_total[5m]))'},
  {id:'qwen-inflight',title:'Production requests in flight',unit:'short',expr:'sum(local_qwen_inflight)'},
  {id:'qwen-p95',title:'Production request latency p95',unit:'s',expr:'histogram_quantile(0.95, sum by(le) (rate(local_qwen_duration_seconds_bucket[5m])))'},
  {id:'qwen-background',title:'Background summary requests',unit:'short',expr:'max(local_qwen_background_requests_total)'},
  {id:'qwen-background-errors',title:'Background summary failures',unit:'short',expr:'max(local_qwen_background_errors_total)'},
];
publicMetrics.push(...qwenMetrics);

export const raspberryMetrics = mookieMetrics.map(m => ({...m,id:m.id.replace("mookie-","raspberry-"),expr:m.expr.replaceAll("mookie_","raspberry_").replaceAll('instance="mookie"','instance="rpi4"')})).filter(m=>!publicMetrics.some(p=>p.id===m.id));
publicMetrics.push(...raspberryMetrics);
