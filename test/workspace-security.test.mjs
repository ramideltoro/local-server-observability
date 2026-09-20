import test from "node:test";
import assert from "node:assert/strict";
import { publicRoute } from "../server/native.mjs";
import { publishable } from "../server/publish.mjs";
import { alertCatalog } from "../server/alerts.mjs";
test("public Grafana allows read queries but blocks mutating and proxy routes", () => {
  assert.equal(publicRoute("POST", "/api/ds/query"), true);
  for (const [method, path] of [
    ["POST", "/api/dashboards/db"],
    ["DELETE", "/api/dashboards/uid/x"],
    ["GET", "/api/datasources/proxy/uid/cloud/api/v1/query"],
    [
      "POST",
      "/apis/dashboard.grafana.app/v1beta1/namespaces/default/dashboards",
    ],
    ["GET", "/api/admin/settings"],
  ])
    assert.equal(publicRoute(method, path), false);
});
test("publication rejects unregistered queries and private content", () => {
  const base = {
    title: "Metric",
    panels: [
      { id: 1, type: "timeseries", targets: [{ expr: "public_metric_0" }] },
    ],
  };
  assert.ok(publishable(base).uid.startsWith("published-"));
  assert.throws(() => publishable({ ...base, panels: [{ type: "text" }] }));
  assert.throws(() =>
    publishable({
      ...base,
      panels: [{ type: "timeseries", targets: [{ expr: "up" }] }],
    }),
  );
});
test("alert group interval is independent from pending duration and silence", () => {
  const config = [
    { uid: "x", title: "CPU", ruleGroup: "g", for: "10m", data: [] },
  ];
  const groups = {
    data: {
      groups: [
        {
          name: "g",
          interval: 300,
          rules: [
            { uid: "x", name: "CPU", state: "firing", lastEvaluation: "now" },
          ],
        },
      ],
    },
  };
  const data = alertCatalog(config, groups, [
    { labels: { alertname: "CPU" }, status: { silencedBy: ["s"] } },
  ]);
  assert.equal(data.rules[0].intervalSeconds, 300);
  assert.equal(data.rules[0].pending, "10m");
  assert.equal(data.rules[0].silenced, true);
  assert.equal(data.rules[0].enabled, true);
  assert.equal(
    alertCatalog(config, { data: { groups: [] } }, []).rules[0].intervalSeconds,
    null,
  );
});
import fs from "node:fs";
test("published dashboard files contain only approved public projections", () => {
  const dir = new URL("../config/published/", import.meta.url);
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const d = JSON.parse(fs.readFileSync(new URL(file, dir), "utf8"));
    assert.match(d.uid, /^published-[a-zA-Z0-9-]+$/);
    assert.deepEqual({ ...publishable(d), uid: d.uid }, d);
  }
});
test("Grafana stable and beta read APIs are supported without writes", () => {
  for (const version of ["v1", "v2", "v1beta1", "v2beta1"]) {
    const path =
      "/apis/dashboard.grafana.app/" +
      version +
      "/namespaces/default/dashboards/fleet-metrics/dto";
    assert.equal(publicRoute("GET", path), true);
    assert.equal(publicRoute("POST", path), false);
  }
});
test("healthy silenced rules stay enabled and no-data remains distinct", () => {
  const config = [
    { uid: "r", title: "CPU", labels: { severity: "warning" }, data: [] },
  ];
  const groups = {
    data: {
      groups: [
        {
          interval: 60,
          rules: [{ uid: "r", state: "inactive", health: "nodata" }],
        },
      ],
    },
  };
  const r = alertCatalog(config, groups, [], "2026-09-13", [
    {
      status: { state: "active" },
      matchers: [
        { name: "alertname", value: "CPU", isEqual: true, isRegex: false },
      ],
    },
  ]).rules[0];
  assert.equal(r.silenced, true);
  assert.equal(r.enabled, true);
  assert.equal(r.state, "no-data");
});
import { mookieMetrics, raspberryMetrics } from '../server/core.mjs';
import { registeredQueries, queryKey } from '../server/gateway.mjs';
test('Retired Mookie is absent from inventory and query registry; Raspberry remains monitored',()=>{
  const inventory=JSON.parse(fs.readFileSync(new URL('../config/inventory.json',import.meta.url)));
  assert.ok(!inventory.servers.some(s=>s.id==='mookie'));
  assert.ok(inventory.retired.some(s=>s.id==='mookie'));
  for(const metric of raspberryMetrics) assert.ok(registeredQueries.has(queryKey(metric.expr)));
  assert.ok(!inventory.applications.some(a=>['skyglow','antenna'].includes(a.id)));
  for(const metric of mookieMetrics){assert.ok(metric.expr.includes('instance="mookie"'));assert.ok(!registeredQueries.has(queryKey(metric.expr)));}
});
