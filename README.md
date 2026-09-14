# Observe — public infrastructure workspace

[Open the portal](https://observe.ramideltoro.com) · [Read the wiki](https://localserver.wiki.ramideltoro.com/technical/observability/)

Dark amber, responsive server/application navigation, public native Grafana dashboards, daily issue reports and a complete Cloud alert-rule catalog. Google sign-in protects owner diagnostics, dashboard edits, publishing and manual inspections.

## Architecture

- React portal and Node gateway run on the local server.
- Separate loopback public and owner Grafana instances preserve the public credential boundary.
- Public Prometheus requests use a Git-managed query registry, bounded windows/results and anonymous series labels.
- Cloud remains the telemetry store and alert evaluator.
- Inventory lives in `config/inventory.json`; unsupported panels and missing instrumentation remain visible.
- Workspace copies are separate from synchronized originals. Publish to Git creates a validated PR.

## Develop and validate

```sh
npm ci
npm run check
npm run build
npm test
```

Deployment is coordinated by [local-server-infra](https://github.com/ramideltoro/local-server-infra). Changes require matching wiki source fingerprints. Production Qwen inference is checked before and after activation; portal deployment does not restart Qwen or Ollama.

Detailed operation, coverage limits, lifecycle and recovery belong in the [three-mode wiki](https://localserver.wiki.ramideltoro.com).

Mookie is a separate Raspberry Pi server with a dedicated 21-panel resource/hardware dashboard and Google-protected journal view. Active fleet inventory excludes the retired Skyglow and Antenna Observatory applications; historical reports are retained.

## Operational health workspace

The portal provides explainable 0–100 verified health and coverage for every canonical system, deployment events, dependencies, objectives, Qwen workload telemetry, capacity estimates, incidents, recovery readiness, command search, owner favorites, and shared time ranges. Missing evidence remains visible and reduces verified health. Minute collection and daily 09:00 UTC inspection preserve history in an additive SQLite database with encrypted backup verification.

See the [health guide](https://localserver.wiki.ramideltoro.com/technical/verified-health/), [workspace guide](https://localserver.wiki.ramideltoro.com/technical/operational-workspace/), and [storage recovery guide](https://localserver.wiki.ramideltoro.com/expert/operational-storage/) for scoring, scope, limitations, and recovery. Google authentication protects all changes; deployment remains GitHub-managed. Qwen instrumentation preserves production routing and uses an idle-gated wrapper upgrade with compatibility checks.
