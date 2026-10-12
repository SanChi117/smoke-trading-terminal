# AppDeploy ↔ GitHub source reconciliation — Phase 0
Date: 2026-10-12
Status: **MANIFEST ONLY. DEPLOYED SOURCE BACKUP IS STILL INCOMPLETE.**

## Evidence
- The **applied AppDeploy source snapshot** was `1791388190004` for app ID `smoke-trading-terminal-0kl792`. An earlier successful connector inspection listed **68 paths**.
- GitHub pre-integration `main` tree `40b773693295a1ad27fec8f33a10d3f9897ffb5f` had 300 tracked blobs.
- A path-set comparison of the 68 reported AppDeploy paths to that GitHub tree found **40 identical *path names*** and **28 paths only in the AppDeploy snapshot list**. Matching paths do **not** imply matching content.
- GitHub `main` uses Next/Vinext/Cloudflare and includes a separate `backend/server.py`; AppDeploy uses Vite/React and `@appdeploy/sdk` in `backend/index.ts`. These are materially different deployment architectures, so copying either entire project into the other is unsafe.

## 28 AppDeploy-only paths at inspected snapshot
| Group | Missing from GitHub `main` |
| --- | --- |
| AppDeploy runtime, backend and configuration | `backend/index.ts`, `backend/observations.ts`, `index.html`, `postcss.config.js`, `source.json`, `src/App.tsx`, `src/index.css`, `src/main.tsx`, `src/vite-env.d.ts`, `tailwind.config.ts`, `tests/tests.txt` |
| Observation/orchestration | `services/market-data/observation-features.ts`, `services/orchestrator/observe-cycle.ts`, `services/orchestrator/safe-mode.ts` |
| Chart, view state and exchange utilities | `app/components/ObservationPanel.module.css`, `app/components/ObservationPanel.tsx`, `app/components/TradingOS.module.css`, `app/components/chart-drawings.ts`, `app/components/chart-layer-store.ts`, `app/components/chart-view.ts`, `app/components/terminal-view-store.ts`, `app/lib/exchange-rules.ts`, `app/lib/latest-request.ts` |
| Generated CSS type declarations | `app/audit/audit.module.css.d.ts`, `app/components/ObservationPanel.module.css.d.ts`, `app/components/ProfessionalChart.module.css.d.ts`, `app/components/TerminalV6.module.css.d.ts`, `app/components/TradingOS.module.css.d.ts` |

## Key GitHub-only capabilities absent from AppDeploy path list
- `services/execution/engine.ts` contains **an interface for an order gateway**, not a connected Binance private broker. Current health endpoint `app/api/os/health/route.ts` reports `liveExecutionEnabled: false`.
- `services/exit-guardian/state-machine.ts` has a deterministic transition function but not proof of a live market/exchange adapter.
- `core/ledger/store.ts` uses D1; deployment-grade transactional PostgreSQL and backup/restore workflows remain outstanding.
- `db/schema.ts`, `core/state/event-bus.ts`, `services/market-data/binance-normalizer.ts` form reusable pieces not established as integrated in applied AppDeploy snapshot.

## Recover and reconcile without destructive changes
1. Reconnect AppDeploy read tools. Fetch `get_app_versions` and `src_glob` to confirm **current** applied version — do not assume the older ID still applies.
2. Fetch **all current source files** in the app snapshot. Archive them with a file manifest/checksum in protected backup storage. Before any public GitHub import, secret-scan contents and remove any stored credentials/personal data.
3. Compare actual file contents and dependencies. Mark each changed file `KEEP_APPDEPLOY`, `KEEP_GITHUB`, or `ADAPTER_REQUIRED`; prepare a deterministic migration checklist.
4. Identify backend/DB durability guarantees and validate restores; do not assume current browser localStorage or AppDeploy tables are a complete Ledger.
5. Publish only an incremental, fully tested release to the existing app. Never deploy the older GitHub build over the AppDeploy site as a shortcut.

## Current hard boundary
No new public AppDeploy webhook URL is operational or guaranteed. The GitHub V2.2 parser is a **pure, tested candidate-validation component**, not a deployed ingress service. Existing live terminal not modified.
