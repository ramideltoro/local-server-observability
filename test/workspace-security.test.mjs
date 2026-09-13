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
