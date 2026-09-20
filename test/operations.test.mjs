import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  scoreSystem,
  forecast,
  objective,
  metricObservation,
} from "../server/health-engine.mjs";
import { openOperations } from "../server/operations-store.mjs";
import { createOperations, reconcileIncidents } from "../server/operations.mjs";
import { configurationProposal } from "../server/operations-publish.mjs";
const system = { id: "test", name: "Test", kind: "server" };
const checks = () =>
  ["availability", "performance", "resources", "recovery", "coverage"].map(
    (category) => ({
      id: category,
      title: category,
      category,
      severity: "warning",
      status: "pass",
      fresh: true,
    }),
  );
test("weighted scores, explicit applicability and each ceiling are deterministic", () => {
  assert.equal(scoreSystem(system, checks()).score, 100);
  let c = checks();
  c[2].status = "warning";
  assert.equal(scoreSystem(system, c).score, 90);
  c = checks();
  c[3].status = "unknown";
  assert.equal(scoreSystem(system, c).score, 85);
  assert.equal(scoreSystem(system, c).coverage, 80);
  c = checks();
  c[0] = { ...c[0], severity: "critical", status: "fail" };
  assert.equal(scoreSystem(system, c).score, 49);
  c[0].essential = true;
  assert.equal(scoreSystem(system, c).score, 25);
  assert.equal(
    scoreSystem(
      system,
      c.map((v) => ({ ...v, status: "unknown" })),
    ).status,
    "unknown",
  );
  assert.equal(
    scoreSystem(
      { ...system, notApplicable: { recovery: "Documented exclusion" } },
      checks().filter((c) => c.category !== "recovery"),
    ).score,
    100,
  );
});
test("deduplicated findings retain the worst evidence and critical unknown does not erase failure", () => {
  const c = checks();
  c[0].status = "fail";
  const result = scoreSystem(system, [
    ...c,
    { ...c[0], status: "pass", severity: "critical" },
  ]);
  assert.equal(result.checks.length, 5);
  assert.equal(result.checks[0].status, "fail");
  const unknown = scoreSystem(system, [{ ...c[0], status: "unknown" }, ...c]);
  assert.equal(unknown.checks[0].status, "fail");
  assert.equal(
    metricObservation(
      { fail: 90 },
      { state: "live", series: [{ values: [[Date.now() / 1000 - 600, "1"]] }] },
    ).status,
    "unknown",
  );
});
test("capacity forecasts reject flat, noisy, stale and incomplete history", () => {
  const now = Date.now();
  const points = Array.from({ length: 337 }, (_, i) => ({
    at: now - (336 - i) * 3600000,
    value: 20 + i / 24,
  }));
  const f = forecast(points, now, true);
  assert.equal(f.state, "forecast");
  assert(f.daysToFull > 60 && f.daysToFull < 70);
  assert.equal(
    forecast(
      points.map((p) => ({ ...p, value: 50 })),
      now,
      true,
    ).daysToFull,
    null,
  );
  assert.equal(
    forecast(
      points.map((p, i) => ({ ...p, value: i % 2 ? 80 : 10 })),
      now,
      true,
    ).daysToFull,
    null,
  );
  assert.equal(
    forecast(
      points.filter((_, i) => i % 2),
      now,
      true,
    ).state,
    "insufficient",
  );
  assert.equal(forecast(points.slice(-24), now, true).state, "insufficient");
  assert.equal(forecast(points, now + 86400000, true).state, "insufficient");
});
test("objectives do not count missing minutes as successful and deduplicate samples", () => {
  const now = Date.now(),
    samples = [
      { at: now, status: "pass" },
      { at: now, status: "pass" },
      { at: now - 60000, status: "fail" },
    ];
  const o = objective(samples, 99.9, now);
  assert.equal(o.observedMinutes, 2);
  assert.equal(o.availability, 50);
  assert(o.coverage < 1);
  assert(o.provisional);
  assert.equal(objective([], 99.9, now).availability, null);
});
test("operational database retains daily summaries and transitions across pruning and reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-store-"));
  try {
    let store = openOperations(dir);
    const old = Date.now() - 91 * 86400000;
    store.record({ ...system, score: 50, coverage: 60, status: "bad" }, old);
    store.transition("incident", old, { status: "New" });
    store.event({
      id: "same",
      system: "test",
      at: Date.now(),
      kind: "deployment",
      title: "Release",
    });
    store.event({
      id: "same",
      system: "test",
      at: Date.now(),
      kind: "deployment",
      title: "Release",
    });
    store.prune();
    assert.equal(store.events().length, 1);
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM snapshots").get().n,
      0,
    );
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM daily").get().n,
      1,
    );
    store.close();
    store = openOperations(dir);
    assert.equal(store.transitions("incident").length, 1);
    store.savePreferences("a", { favorites: ["one"] });
    assert.deepEqual(store.preferences("b"), { favorites: [] });
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("incident lifecycle and acknowledgement never change underlying issue state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-incident-"));
  try {
    const store = openOperations(dir);
    const issue = {
      id: "i",
      system: "test",
      check: "cpu",
      summary: "CPU pressure",
      severity: "critical",
      status: "New",
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    for (const [input, expected] of [
      ["New", "New"],
      ["Ongoing", "Ongoing"],
      ["Unverified", "Unverified"],
      ["Remediated", "Remediated"],
      ["Reopened", "Reopened"],
    ]) {
      issue.status = input;
      reconcileIncidents(store, [issue]);
      assert.equal(store.incidents()[0].status, expected);
    }
    const i = store.incidents()[0];
    store.incident({ ...i, acknowledged: true });
    reconcileIncidents(store, [issue]);
    assert(store.incidents()[0].acknowledged);
    assert.equal(issue.status, "Reopened");
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("configuration proposals validate targets and cannot introduce queries or lose existing checks", () => {
  const config = {
    systems: [
      {
        id: "app",
        kind: "application",
        objective: { availability: 99.9 },
        checks: [{ id: "cpu", metric: "cpu", warn: 80, fail: 90 }],
      },
    ],
  };
  assert.equal(
    configurationProposal({ system: "app", availabilityTarget: 99.95 }, config)
      .systems[0].objective.availability,
    99.95,
  );
  assert.throws(() =>
    configurationProposal({ system: "app", availabilityTarget: 100 }, config),
  );
  assert.throws(() =>
    configurationProposal(
      { system: "app", check: "cpu", warn: 95, fail: 90 },
      config,
    ),
  );
  assert.throws(() =>
    configurationProposal({ system: "app", expr: "secret" }, config),
  );
  assert.equal(config.systems[0].objective.availability, 99.9);
});
test("public operations are read-only, bounded, sanitized, and require verified owners for writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-api-"));
  let ops;
  try {
    const root = path.resolve(".");
    ops = await createOperations({
      root,
      dir,
      disabled: true,
      overview: async () => ({
        updatedAt: new Date().toISOString(),
        services: [],
        metrics: [],
      }),
      query: async () => [],
      rules: async () => ({ rules: [] }),
      owner: async (r) => r.headers.owner === "yes",
      identity: async () => "verified-owner",
      json: (res, code, data) => Object.assign(res, { code, data }),
      release: {},
    });
    await ops.collect();
    assert.equal(ops.health().systems.length, JSON.parse(fs.readFileSync("config/operations.json")).systems.length);
    assert(!JSON.stringify(ops.health()).includes("node_systemd_unit_state"));
    async function request(route, method = "GET", payload, headers = {}) {
      const req = Readable.from(
        payload ? [Buffer.from(JSON.stringify(payload))] : [],
      );
      Object.assign(req, { method, headers });
      const res = {};
      await ops.handle(
        req,
        res,
        new URL("https://observe.ramideltoro.com" + route),
      );
      return res;
    }
    for (const route of [
      "health",
      "history",
      "events",
      "dependencies",
      "objectives",
      "forecasts",
      "coverage",
      "recovery",
      "incidents",
      "qwen",
    ])
      assert.equal(
        (await request("/api/public/operations/" + route, "POST")).code,
        405,
      );
    assert.equal(
      (await request("/api/owner/operations/preferences", "POST", {})).code,
      401,
    );
    assert.equal(
      (
        await request(
          "/api/owner/operations/preferences",
          "POST",
          {},
          { owner: "yes", origin: "https://evil.example" },
        )
      ).code,
      403,
    );
    assert.equal(
      (await request("/api/public/operations/events?from=0")).code,
      400,
    );
    assert.equal(
      (await request("/api/public/operations/history?system=unknown")).code,
      400,
    );
    assert.equal((await request("/api/public/operations/health")).code, 200);
    assert.equal((await request("/grafana/api/annotations")).code, 200);
    for (const system of ["mookie", "fleet", "unassigned-service"]) ops.store.incident({id: system, system, status: "Ongoing", notes: "private"});
    const activeIncidents = await request("/api/public/operations/incidents");
    assert.deepEqual(activeIncidents.data.incidents.map(i => i.system).sort(), ["fleet", "unassigned-service"]);
    assert(!JSON.stringify(activeIncidents.data).includes("private"));
    assert(ops.store.incidents().some(i => i.system === "mookie"), "Retired history must remain stored");
  } finally {
    ops?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("current failures survive older warnings and unavailable evidence without leaking owner notes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observe-regression-"));
  let ops,
    missing = false;
  try {
    const at = new Date().toISOString();
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({
        issues: [
          {
            id: "cpu-issue",
            system: "local",
            check: "cpu",
            severity: "warning",
            status: "Ongoing",
            summary: "CPU warning",
            firstSeen: at,
            lastSeen: at,
          },
        ],
        reports: [],
      }),
    );
    ops = await createOperations({
      root: path.resolve("."),
      dir,
      disabled: true,
      overview: async () => {
        if (missing) throw Error("offline");
        return {
          updatedAt: at,
          services: [],
          metrics: [
            {
              id: "cpu",
              state: "live",
              series: [{ values: [[Date.now() / 1000, "99"]] }],
            },
          ],
        };
      },
      query: async () => [],
      rules: async () => ({ rules: [] }),
      owner: async (r) => r.headers.owner === "yes",
      identity: async () => "account-a",
      json: (res, code, data) => Object.assign(res, { code, data }),
      release: {},
    });
    await ops.collect();
    const get = () =>
      ops
        .health()
        .systems.find((s) => s.id === "local")
        .checks.find((c) => c.id === "cpu");
    assert.equal(get().status, "fail");
    missing = true;
    fs.writeFileSync(path.join(dir, "state.json"), "invalid");
    await ops.collect();
    assert.equal(get().status, "fail");
    assert.equal(get().fresh, false);
    const stored = ops.store.get("health");
    ops.store.put("health", {
      ...stored,
      at: new Date(Date.now() - 600001).toISOString(),
    });
    assert.equal(get().status, "fail");
    assert.equal(get().fresh, false);
    assert(ops.health().stale);
    const incident = ops.store.incidents()[0];
    const request = async (route, method = "GET", payload, headers = {}) => {
      const req = Readable.from(
        payload ? [Buffer.from(JSON.stringify(payload))] : [],
      );
      Object.assign(req, { method, headers });
      const res = {};
      await ops.handle(
        req,
        res,
        new URL("https://observe.ramideltoro.com" + route),
      );
      return res;
    };
    const saved = await request(
      "/api/owner/operations/incidents",
      "POST",
      {
        id: incident.id,
        note: "private regression note",
        group: "owner investigation",
        acknowledged: true,
      },
      { owner: "yes", origin: "https://observe.ramideltoro.com" },
    );
    assert.equal(saved.code, 200);
    const publicView = await request("/api/public/operations/incidents");
    assert(!JSON.stringify(publicView).includes("private regression note"));
    assert(!JSON.stringify(publicView).includes("owner investigation"));
    const ownerView = await request(
      "/api/owner/operations/incidents",
      "GET",
      undefined,
      { owner: "yes" },
    );
    assert(JSON.stringify(ownerView).includes("private regression note"));
    assert.equal(get().status, "fail");
  } finally {
    ops?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("inventory checks have unique identities, explicit applicability and accountable deductions", () => {
  const config = JSON.parse(fs.readFileSync("config/operations.json"));
  assert.equal(new Set(config.systems.map((s) => s.id)).size, config.systems.length);
  for (const s of config.systems) {
    assert.equal(new Set(s.checks.map((c) => c.id)).size, s.checks.length);
    for (const category of [
      "availability",
      "performance",
      "resources",
      "recovery",
      "coverage",
    ])
      assert(
        s.checks.some((c) => c.category === category) ||
          typeof s.notApplicable?.[category] === "string",
      );
    for (const c of s.checks) assert(c.improvement);
  }
  const c = checks();
  c[2].status = "warning";
  const score = scoreSystem(system, c);
  assert.equal(score.deductions[0].pointsLost, 10);
  const essential = { ...c[0], essential: true, status: "pass" };
  const failing = { ...c[0], status: "fail" };
  assert.equal(
    scoreSystem(system, [essential, failing, ...c.slice(1)]).score,
    25,
  );
  const now = Date.now(),
    points = Array.from({ length: 337 }, (_, i) => ({
      at: now - (336 - i) * 3600000,
      value: 200,
    }));
  assert.equal(forecast(points, now, false, null).sustainedPressure, null);
});

test('missing evidence has actionable reasons without earning health or coverage credit', () => {
  const result = scoreSystem(system, [
    {...checks()[0],status:'unknown',fresh:false,evidenceState:'collecting-history'},
    {...checks()[1],status:'unknown',fresh:false,evidenceState:'not-configured'},
    {...checks()[2],status:'unknown',fresh:false,note:'No fresh valid samples'},
  ]);
  assert.equal(result.score,0);
  assert.equal(result.coverage,0);
  assert.deepEqual(result.deductions.map(c=>c.evidenceState),['collecting-history','not-configured','no-data']);
  assert(result.deductions.every(c=>c.pointsLost>0));
  const failed=scoreSystem(system,[{...checks()[0],status:'fail',evidenceState:'no-data'}]);
  assert.equal(failed.checks[0].status,'fail');
  assert.equal(failed.checks[0].evidenceState,undefined);
});

test('registered live signals replace placeholder checks and probe names resolve', async () => {
  const {websites}=await import('../server/websites.mjs');
  const config=JSON.parse(fs.readFileSync('config/operations.json'));
  const byId=id=>config.systems.find(s=>s.id===id).checks;
  assert(byId('backend-vps').find(c=>c.id==='service:postgresql@18-main').expr.includes('pg_up'));
  for(const id of ['backend-vps','nutsnews-vps']) assert(byId(id).find(c=>c.id==='restart-patterns').expr);
  for(const id of ['backend-vps','nutsnews-vps']) assert(byId(id).find(c=>c.id==='backup-freshness').expr);
  for(const s of config.systems) for(const c of s.checks) {
    if(c.expr?.includes('website_probe_')) {
      const site=c.expr.match(/website="([^"]+)"/)?.[1];
      assert(websites.some(w=>w.id===site), `${s.id}/${c.id} references an absent website probe`);
    }
    if(!['expr','metric','probe','report','coverageSource','recovery','recoveryEvidence','logSelector','cloudLogEvidence','objective'].some(k=>c[k])) assert.equal(c.evidenceState,'not-configured');
  }
});
