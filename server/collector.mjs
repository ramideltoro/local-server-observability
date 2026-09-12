import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
const run = promisify(execFile);
export const units = [
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
  out.push(`local_server_collector_timestamp_seconds ${Date.now() / 1000}`);
  return out.join("\n") + "\n";
}
