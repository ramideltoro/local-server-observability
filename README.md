# Local Server Observability

A central observability portal for the local server and NutsNews, available at [observe.ramideltoro.com](https://observe.ramideltoro.com). It presents real telemetry in a dark charcoal interface with amber accents while preserving the existing Grafana Cloud storage and alerting setup.

## Experience

Public pages show allowlisted endpoint health and aggregate resource metrics. The authenticated owner workspace adds 42 curated dashboards with 308 panels, bounded log search, alerts, trace availability, backups, and deployment diagnostics. Time ranges, freshness labels, and service-level navigation help distinguish an actual failure from missing evidence.

## Architecture

React + TypeScript + Vite provide the interface. A Node.js server queries Grafana using server-side credentials, validates Google OpenID Connect sign-in and secure owner sessions, bounds queries, and keeps private responses out of public caches. A separate loopback metrics listener exposes service-health signals to Alloy.

## Development

```sh
npm ci
npm run check
npm run build
npm test
npm start
```

The HTTP server listens on `127.0.0.1:4310`; metrics use `127.0.0.1:4311`. Set the variables documented in `.env.example` through the process environment. Do not place production credentials in browser-side variables.

## Deployment

GitHub Actions builds and validates this repository, then dispatches the [infrastructure coordinator](https://github.com/ramideltoro/local-server-infra). The coordinator verifies matching wiki documentation and production Qwen compatibility before and after activation. The portal cannot restart, deploy, or mutate production applications through its UI.

## Telemetry ownership

The catalog imports existing local-host and NutsNews metrics. Existing source pipelines and alert owners remain authoritative. An unavailable or stale signal is shown explicitly; a Tempo datasource without traces does not imply tracing is configured. New collection must respect NutsNews signal budgets and privacy rules.

## Documentation

The [wiki](https://localserver.wiki.ramideltoro.com) contains Summary, Technical, and Expert explanations, architecture, runbooks, public/private boundaries, and release synchronization details. Full documentation lives in [local-server-wiki](https://github.com/ramideltoro/local-server-wiki).

## Google owner sign-in

Owner links go directly to Google OAuth. Register `https://observe.ramideltoro.com/auth/google/callback` on the web OAuth client. Supply `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, a random `SESSION_SECRET` of at least 32 bytes, and `OWNER_EMAILS` through the infrastructure runtime secret. Only verified Google emails on that allowlist receive a 12-hour Secure, HttpOnly session. State, PKCE, and nonce protect the one-use callback. Login returns to the selected diagnostics tab; expired sessions prompt a new sign-in. Cloudflare still carries tunnel traffic and protects deployment SSH, but is not the portal identity provider.

## Website telemetry

Dedicated Rami Del Toro and ShowAlgo views monitor `https://www.ramideltoro.com` and `https://www.showalgo.com` every 60 seconds from the local server. HTTPS probes validate certificates, measure time to headers, record HTTP status and certificate expiry, and export bounded Prometheus metrics through the existing Alloy scrape. Checks run without browser traffic, have an 8-second deadline, do not follow redirects, and discard response bodies. Historical panels include rolling-hour availability, response time, HTTP status, TLS lifetime, and collection freshness. No visitor tracking or provider-specific logs are collected.

## Application and host views

Fantasy Football Edge checks its website and database-backed `/healthz` every minute. Backend VPS and NutsNews VPS have individually scoped CPU, memory, root disk and load charts, grouped owner dashboards, and host-specific log filters. Existing collection and Qwen workers remain unchanged. Fantasy importer freshness and application process metrics are not yet instrumented.
