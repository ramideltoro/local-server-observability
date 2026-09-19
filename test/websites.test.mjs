import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  websites,
  probeWebsite,
  websiteMetrics,
  startWebsiteMonitor,
} from "../server/websites.mjs";
function request(status, error = false) {
  return (_url, options, callback) => {
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent, false);
    const req = new EventEmitter();
    req.destroy = () => {};
    queueMicrotask(() =>
      error
        ? req.emit("error", Error("network"))
        : callback({
            statusCode: status,
            socket: {
              getPeerCertificate: () => ({ valid_to: "Jan 1 2030 GMT" }),
            },
            destroy() {},
          }),
    );
    return req;
  };
}
test("Probes distinguish successful HTTP, errors, and failed connections", async () => {
  for (const [status, error, success] of [
    [200, false, 1],
    [503, false, 0],
    [302, false, 0],
    [0, true, 0],
  ]) {
    const s = await probeWebsite(
      { id: "showalgo", url: "https://www.showalgo.com" },
      request(status, error),
    );
    assert.equal(s.success, success);
    assert.equal(s.statusCode, status);
    assert(s.durationSeconds >= 0);
    assert(s.checkedAt > 0);
  }
});
test("Exports failure and freshness without fabricated certificate expiry", () => {
  const result = websiteMetrics([
    {
      id: "showalgo",
      success: 0,
      statusCode: 0,
      durationSeconds: 8,
      checkedAt: 123,
      certificateExpiry: null,
    },
  ]);
  assert.match(result, /website_probe_success\{website="showalgo"\} 0/);
  assert.match(result, /last_check_timestamp_seconds/);
  assert(!result.includes("certificate_expiry"));
});
test("Scheduled monitoring works without page visits", async () => {
  let calls = 0;
  const m = startWebsiteMonitor({
    probe: async (s) => {
      calls++;
      return {
        id: s.id,
        success: 1,
        durationSeconds: 0.1,
        checkedAt: Date.now() / 1000,
        certificateExpiry: null,
        statusCode: 200,
      };
    },
    intervalMs: 10,
  });
  try {
    await new Promise((r) => setTimeout(r, 25));
    assert(calls >= 4);
    assert.equal(m.services().length, websites.length);
    assert(m.services().every((s) => s.status === "healthy"));
    assert(m.metrics().includes("website_probe_success"));
  } finally {
    m.stop();
  }
});
