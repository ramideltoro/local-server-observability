export type Signal = {
  state: string;
  series: { values: [number, string][] }[];
};
export type Health = "good" | "bad" | "unknown";
// A fresh response must not turn old or missing samples green.
export function latestMetric(metric?: Signal, now = Date.now()): number | null {
  if (metric?.state !== "live" || !metric.series.length) return null;
  const values = metric.series.map((series) => series.values.at(-1));
  if (values.some((sample) => !sample || sample[1].trim() === "" ||
    !Number.isFinite(Number(sample[1])) || now / 1000 - sample[0] > 300 || sample[0] > now / 1000 + 60)) return null;
  return Math.max(...values.map((sample) => Number(sample![1])));
}
export function resourceHealth(metrics: (Signal | undefined)[], now = Date.now()): Health {
  const values = metrics.map((metric) => latestMetric(metric, now));
  if (values.some((value, index) => value !== null && value >= (index === 2 ? 85 : 90))) return "bad";
  return values.length !== 3 || values.some((value) => value === null) ? "unknown" : "good";
}
export function endpointHealth(status: string, fresh: boolean): Health {
  if (!fresh) return "unknown";
  if (status === "healthy") return "good";
  return ["degraded", "unavailable"].includes(status) ? "bad" : "unknown";
}
