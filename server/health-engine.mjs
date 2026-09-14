export const categoryWeights = {
  availability: 35,
  performance: 20,
  resources: 20,
  recovery: 15,
  coverage: 10,
};
const importance = { critical: 3, warning: 2, info: 1 };
const credit = { pass: 1, warning: 0.5, fail: 0, unknown: 0 };
export function scoreSystem(system, observations, now = Date.now()) {
  const dedup = new Map();
  for (const check of observations) {
    const previous = dedup.get(check.id);
    // One canonical check, with the most severe observation authoritative.
    const rank = { fail: 0, unknown: 1, warning: 2, pass: 3 };
    if (
      !previous ||
      rank[check.status] < rank[previous.status] ||
      (rank[check.status] === rank[previous.status] &&
        check.severity === "critical" &&
        previous.severity !== "critical")
    )
      dedup.set(check.id, {
        ...previous,
        ...check,
        essential: previous?.essential || check.essential,
        configurable: previous?.configurable || check.configurable,
        issues: [
          ...new Set([...(previous?.issues || []), ...(check.issues || [])]),
        ],
      });
  }
  const checks = [...dedup.values()];
  const applicable = Object.keys(categoryWeights).filter(
    (k) => !system.notApplicable?.[k],
  );
  const totalWeight = applicable.reduce((n, k) => n + categoryWeights[k], 0);
  const categories = applicable.map((category) => {
    const items = checks.filter((c) => c.category === category);
    const total = items.reduce((n, c) => n + (importance[c.severity] || 1), 0);
    const earned = items.reduce(
      (n, c) => n + (importance[c.severity] || 1) * (credit[c.status] || 0),
      0,
    );
    const weight = (categoryWeights[category] / totalWeight) * 100;
    return {
      id: category,
      weight,
      earned: total ? (weight * earned) / total : 0,
      checks: items.length,
    };
  });
  const usable = checks.filter((c) => c.status !== "unknown");
  let ceiling = 100,
    ceilingReason = null;
  if (
    checks.some((c) => c.status !== "pass") ||
    categories.some((c) => !c.checks)
  ) {
    ceiling = 94;
    ceilingReason = "Warnings or incomplete required coverage";
  }
  if (checks.some((c) => c.status === "fail" && c.severity === "critical")) {
    ceiling = 49;
    ceilingReason = "Unresolved critical issue";
  }
  if (checks.some((c) => c.status === "fail" && c.essential)) {
    ceiling = 25;
    ceilingReason = "Confirmed essential-service outage";
  }
  const rawScore = categories.reduce((n, c) => n + c.earned, 0);
  const score = usable.length ? Math.min(Math.floor(rawScore), ceiling) : 0;
  const weightedChecks = checks.map((check) => {
    const category = categories.find((c) => c.id === check.category);
    const total = checks
      .filter((c) => c.category === check.category)
      .reduce((n, c) => n + (importance[c.severity] || 1), 0);
    const possiblePoints =
      category && total
        ? (category.weight * (importance[check.severity] || 1)) / total
        : 0;
    return {
      ...check,
      possiblePoints,
      pointsLost: possiblePoints * (1 - (credit[check.status] || 0)),
    };
  });
  return {
    id: system.id,
    name: system.name,
    kind: system.kind,
    at: new Date(now).toISOString(),
    score,
    rawScore: Math.round(rawScore * 10) / 10,
    ceiling,
    ceilingReason,
    coverage: checks.length
      ? Math.round(
          (usable.filter((c) => c.fresh !== false).length / checks.length) *
            100,
        )
      : 0,
    status: !usable.length
      ? "unknown"
      : score >= 95
        ? "good"
        : score >= 70
          ? "warning"
          : "bad",
    categories,
    checks: weightedChecks,
    deductions: weightedChecks.filter((c) => c.status !== "pass"),
    notApplicable: system.notApplicable || {},
  };
}
export function metricObservation(check, metric, now = Date.now()) {
  const samples = metric?.series?.map((s) => s.values?.at(-1)) || [];
  if (
    metric?.state !== "live" ||
    !samples.length ||
    samples.some(
      (s) =>
        !s ||
        s[1] === "" ||
        !Number.isFinite(Number(s[1])) ||
        now / 1000 - s[0] > (check.freshnessSeconds || 300),
    )
  )
    return { status: "unknown", fresh: false, note: "No fresh valid samples" };
  const values = samples.map((s) => Number(s[1]));
  const value =
    check.direction === "below" ? Math.min(...values) : Math.max(...values);
  const breached = (threshold) =>
    threshold != null &&
    (check.direction === "below" ? value < threshold : value >= threshold);
  return {
    status: breached(check.fail)
      ? "fail"
      : breached(check.warn)
        ? "warning"
        : "pass",
    fresh: true,
    value,
    at: new Date(Math.min(...samples.map((s) => s[0])) * 1000).toISOString(),
    note: "Latest registered metric sample",
  };
}
export function forecast(
  points,
  now = Date.now(),
  disk = false,
  pressureThreshold = 85,
) {
  const start = now - 14 * 86400000,
    bins = new Map();
  for (const p of points)
    if (p.at >= start && p.at <= now && Number.isFinite(p.value))
      bins.set(Math.floor(p.at / 3600000), p.value);
  const rows = [...bins].sort((a, b) => a[0] - b[0]);
  const duration = rows.length ? rows.at(-1)[0] - rows[0][0] + 1 : 0;
  const coverage = duration ? rows.length / duration : 0;
  if (
    duration < 7 * 24 ||
    coverage < 0.8 ||
    !rows.length ||
    now / 3600000 - rows.at(-1)[0] > 2
  )
    return {
      state: "insufficient",
      coverage: Math.round(coverage * 100),
      note: "Requires seven days, 80% hourly coverage, and fresh samples",
    };
  const ys = rows.map((r) => r[1]),
    xs = rows.map((r) => (r[0] - rows[0][0]) / 24);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length,
    my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope =
    xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) /
    xs.reduce((n, x) => n + (x - mx) ** 2, 0);
  const error = xs.reduce(
      (n, x, i) => n + (ys[i] - (my + slope * (x - mx))) ** 2,
      0,
    ),
    variance = ys.reduce((n, y) => n + (y - my) ** 2, 0);
  const r2 = variance ? Math.max(0, 1 - error / variance) : 0;
  const credible = disk && slope > 0.1 && r2 >= 0.6;
  return {
    state: credible ? "forecast" : "observed",
    coverage: Math.round(coverage * 100),
    perDay: slope,
    r2,
    mean: my,
    maximum: Math.max(...ys),
    sustainedPressure:
      pressureThreshold == null
        ? null
        : ys.slice(-24).filter((v) => v >= pressureThreshold).length >= 20,
    daysToFull: credible ? Math.max(0, (100 - ys.at(-1)) / slope) : null,
    note: credible
      ? "Linear estimate, not a guaranteed exhaustion date"
      : disk
        ? "No credible positive exhaustion trend"
        : pressureThreshold == null
          ? "Observed queue depth; a sustained-pressure threshold is not configured"
          : "Observed utilization; sustained pressure means at least 20 of 24 hourly samples at 85% or higher",
  };
}
export function objective(samples, target = 99.9, now = Date.now()) {
  const start = now - 30 * 86400000,
    bins = new Map();
  for (const s of samples)
    if (s.at >= start && s.at <= now && ["pass", "fail"].includes(s.status))
      bins.set(Math.floor(s.at / 60000), s.status);
  const observed = bins.size,
    passing = [...bins.values()].filter((s) => s === "pass").length;
  const coverage = observed / (30 * 1440),
    availability = observed ? (passing / observed) * 100 : null;
  return {
    target,
    windowDays: 30,
    observedMinutes: observed,
    coverage: Math.min(100, coverage * 100),
    availability,
    errorBudgetMinutes: 30 * 1440 * (1 - target / 100),
    usedMinutes: observed - passing,
    budgetConsumedPercent:
      ((observed - passing) / (30 * 1440 * (1 - target / 100))) * 100,
    provisional: coverage < 0.99,
    note:
      coverage < 0.99
        ? "Incomplete observation window; missing minutes are not successful requests"
        : "Complete observation window",
  };
}
