import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { fantasyWorkloadEvidence } from "./workload-evidence.mjs";
const run = promisify(execFile);
export const units = [
  "pricedip.service", "pricedip-worker.service", "pricedip-search.service",
  "kubequest.service",
  "fantasy-qwen.service",
  "observe-grafana-public.service",
  "observe-grafana-owner.service",
  "nutsnews-local-ai.service",
  "ollama.service",
  "cloudflared.service",
  "alloy.service",
  "local-server-observability.service",
];
export async function snapshot() {
  const services = await Promise.all(
    units.map(async (unit) => {
      try {
        const { stdout } = await run(
          "systemctl",
          [
            "show",
            unit,
            "-p",
            "ActiveState",
            "-p",
            "SubState",
            "-p",
            "NRestarts",
            "-p",
            "MainPID",
            "-p",
            "MemoryCurrent",
            "-p",
            "CPUUsageNSec",
          ],
          { timeout: 5000 },
        );
        const p = Object.fromEntries(
          stdout
            .trim()
            .split("\n")
            .map((l) => {
              const n = l.indexOf("=");
              return [l.slice(0, n), l.slice(n + 1)];
            }),
        );
        return { unit, ...p };
      } catch {
        return { unit, ActiveState: "unknown" };
      }
    }),
  );
  let processes = [];
  try {
    const { stdout } = await run(
      "ps",
      ["-eo", "pid,comm,%cpu,%mem,rss", "--sort=-rss"],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    processes = stdout
      .trim()
      .split("\n")
      .slice(1, 21)
      .map((line) => {
        const [pid, name, cpu, memory, rss] = line.trim().split(/\s+/);
        return {
          pid: Number(pid),
          name,
          cpu: Number(cpu),
          memoryPercent: Number(memory),
          rssBytes: Number(rss) * 1024,
        };
      });
  } catch {}
  let timers = "";
  try {
    timers = (
      await run(
        "systemctl",
        ["list-timers", "--all", "--no-pager", "--no-legend"],
        { timeout: 5000 },
      )
    ).stdout;
  } catch {}
  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    load: os.loadavg(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
    services,
    processes,
    timers,
  };
}
export async function metrics() {
  const s = await snapshot();
  const out = [
    "# HELP local_server_service_active Whether a required local service is active.",
    "# TYPE local_server_service_active gauge",
  ];
  for (const u of s.services) {
    out.push(
      `local_server_service_active{service="${u.unit}"} ${u.ActiveState === "active" ? 1 : 0}`,
    );
    if (u.NRestarts !== undefined)
      out.push(
        `local_server_service_restarts_total{service="${u.unit}"} ${Number(u.NRestarts) || 0}`,
      );
    const cpu = Number(u.CPUUsageNSec);
    if (Number.isFinite(cpu) && cpu >= 0 && cpu < 1e19) out.push(`local_server_service_cpu_seconds_total{service="${u.unit}"} ${cpu / 1e9}`);
    const memory = Number(u.MemoryCurrent);
    if (Number.isFinite(memory) && memory < 1e15)
      out.push(
        `local_server_service_memory_bytes{service="${u.unit}"} ${memory}`,
      );
  }
  try {
    const r = await fetch("http://127.0.0.1:8788/health", {
      signal: AbortSignal.timeout(5000),
    });
    const j = await r.json();
    out.push(
      `local_server_qwen_health ${r.ok && j.ok && j.availableModels?.includes("qwen2.5:3b") ? 1 : 0}`,
    );
  } catch {
    out.push("local_server_qwen_health 0");
  }
  try {
    const state=JSON.parse(await fs.readFile("/var/lib/local-server-observability/state.json","utf8"));
    const attempts=(state.reports||[]).map(r=>r.ai).filter(a=>a?.attempted);
    out.push('local_qwen_background_requests_total '+attempts.length);
    out.push('local_qwen_background_errors_total '+attempts.filter(a=>a.mode!=="qwen").length);
    out.push('local_qwen_background_duration_seconds_sum '+attempts.reduce((n,a)=>n+(a.durationMs||0)/1000,0));
  } catch {}
  for (const [application, url] of [["kubequest", "http://127.0.0.1:4340/healthz"], ["fantasy-qwen", "http://127.0.0.1:11435/api/tags"]]) {
    try {
      const r = await fetch(url, {signal: AbortSignal.timeout(3000)});
      const j = await r.json();
      const healthy = r.ok && (application === "kubequest" ? j.status === "ok" && j.application === "KubeQuest" : Array.isArray(j.models) && j.models.length > 0);
      out.push(`local_application_health{application="${application}"} ${healthy ? 1 : 0}`);
      if (application === "kubequest") for (const [capability, ready] of [["labs", j.labReady === true], ["authentication", j.authentication === "google"]]) out.push(`local_application_capability{application="kubequest",capability="${capability}"} ${healthy && ready ? 1 : 0}`);
    } catch { out.push(`local_application_health{application="${application}"} 0`); }
  }
  try {
    const pid = s.services.find(u => u.unit === "fantasy-qwen.service")?.MainPID;
    if (Number(pid) > 0) {
      const evidence = JSON.parse(await fs.readFile("/var/lib/observe-recovery/public/cloud-logs.json", "utf8"));
      const workload = fantasyWorkloadEvidence(evidence, pid);
      if (workload) {
        out.push("fantasy_qwen_workload_deadline_met " + workload.met);
        out.push("fantasy_qwen_workload_requests " + workload.count);
        out.push("fantasy_qwen_workload_max_seconds " + workload.maxSeconds);
        out.push("fantasy_qwen_workload_latest_timestamp_seconds " + workload.latest);
      }
    }
  } catch { /* Missing, inaccessible or oversized logs cannot award performance. */ }
  try {
    const r=await fetch("http://127.0.0.1:4350/internal/metrics",{headers:{Authorization:"Bearer "+process.env.PRICEDIP_METRICS_TOKEN},signal:AbortSignal.timeout(4000)});
    if(!r.ok)throw Error("PriceDip metrics unavailable");
    const text=await r.text();
    for(const line of text.split("\n"))if(/^pricedip_[a-z_]+ [0-9.e+\-]+$/.test(line))out.push(line);
  } catch { out.push("pricedip_up 0"); }
  out.push(`local_server_collector_timestamp_seconds ${Date.now() / 1000}`);
  return out.join("\n") + "\n";
}
