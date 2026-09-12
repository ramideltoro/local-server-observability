# Local Server Observability

A central observability portal for the local server and NutsNews, available at [observe.ramideltoro.com](https://observe.ramideltoro.com). It presents real telemetry in a modern amber-accented interface while preserving the existing Grafana Cloud storage and alerting setup.

## Experience

Public pages show allowlisted endpoint health and aggregate resource metrics. The authenticated owner workspace adds 38 curated dashboards with 279 panels, bounded log search, alerts, trace availability, backups, and deployment diagnostics. Time ranges, freshness labels, and service-level navigation help distinguish an actual failure from missing evidence.

## Architecture

React + TypeScript + Vite provide the interface. A Node.js server queries Grafana using server-side credentials, validates Cloudflare Access JWTs, bounds queries, and keeps private responses out of public caches. A separate loopback metrics listener exposes service-health signals to Alloy.

## Development

```sh
npm ci
npm run check
npm test
npm run build
npm start
```

The HTTP server listens on `127.0.0.1:4310`; metrics use `127.0.0.1:4311`. Set the variables documented in `.env.example` through the process environment. Do not place production credentials in browser-side variables.

## Deployment

GitHub Actions builds and validates this repository, then dispatches the [infrastructure coordinator](https://github.com/ramideltoro/local-server-infra). The coordinator verifies matching wiki documentation and production Qwen compatibility before and after activation. The portal cannot restart, deploy, or mutate production applications through its UI.

## Telemetry ownership

The catalog imports existing local-host and NutsNews metrics. Existing source pipelines and alert owners remain authoritative. An unavailable or stale signal is shown explicitly; a Tempo datasource without traces does not imply tracing is configured. New collection must respect NutsNews signal budgets and privacy rules.

## Documentation

The [wiki](https://localserver.wiki.ramideltoro.com) contains Summary, Technical, and Expert explanations, architecture, runbooks, public/private boundaries, and release synchronization details. Full documentation lives in [local-server-wiki](https://github.com/ramideltoro/local-server-wiki).
