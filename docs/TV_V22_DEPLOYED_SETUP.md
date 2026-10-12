# SMOKE TV V2.2 v3.6.3: owner-scoped webhook setup
Updated: 2026-10-12
Status: **transport + candidate journal deployed on AppDeploy v17; no true strategy/arbiter approval or Binance private execution.**

## Runtime
- Existing AppDeploy app: `smoke-trading-terminal-0kl792`.
- Base UI: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#terminal
- Read-only candidate audit UI: https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/#alerts
- Candidate receiver: `POST https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/api/webhooks/tradingview`
- Signed-in endpoints: `GET /api/tradingview/status`, `GET /api/tradingview/candidates`.
- AppDeploy applied version: `1791826247723` (v17). Last get_app_status: READY with no reported frontend/backend errors.
- Secret name: `TV_WEBHOOK_SHARED_SECRET`; configure ONLY through AppDeploy's secure secret-entry, never store its value in GitHub/ChatGPT/client-side code.

## Updated Pine indicator
Use [Strategy_V2_2_Radar_LuxAlgo_v363_webhook.pine](../research/tradingview/Strategy_V2_2_Radar_LuxAlgo_v363_webhook.pine).

This is v3.6.2 signal logic with **only** changes to webhook transport: two string inputs, message fields, emission guard, and display version v3.6.3. `version` inside emitted JSON remains `v3.6.2-v2.2-radar` for parser compatibility. Do not assume Pine compile confirmed merely because source was added to GitHub; recompile in TradingView.

## Owner setup (external action)
1. Open the app's `#alerts` page, sign in, click `Обновить статус и журнал` and copy the displayed authenticated `Owner UUID`.
2. Via a one-time **secure** AppDeploy secret-entry link, enter a new random **32+ character alphanumeric** shared value as `TV_WEBHOOK_SHARED_SECRET`. The assistant then attaches the submitted secret to the app with `set_app_secrets` (no value is returned or stored in the chat). Never post the shared value in chat.
3. Replace/update the old TradingView Pine code with v3.6.3; in `Webhook (transport only)` set `AppDeploy Owner UUID` and the same shared secret. Secrets in Pine inputs and TradingView alert snapshots are visible to the TradingView account owner; restrict account access and never publish configured scripts.
4. Use the Binance USDⓈ-M 15m chart and create **Any alert() function call** with Webhook URL `https://smoke-trading-terminal-0kl792.v2.appdeploy.ai/api/webhooks/tradingview`. Do NOT override the `alert()` JSON with a static placeholder alertcondition message; rebuild existing alerts after Pine input changes.
5. The next **actual qualified v3.6.2 structural candidate**, on a closed 15m bar, should be stored under the signed-in owner's database partition. Reload `#alerts` and press `Обновить статус и журнал` to inspect delivery. No artificial trade candidate should be submitted as a smoke test.
6. If no candidate is generated, empty journal does not prove connection failed. Future E2E transport tests must use authenticated, isolated diagnostic calls, not fake trade signals.

## Fail-closed acceptance
- Receiver refuses operation without configured server secret, rejects wrong token, invalid body/time/side/price/RR, stale bar, and non-15m signals. Secret is not saved to the journal.
- Owner identity is sent as `owner_user_id` and must be UUID; stored under `tv_v22_candidates_<owner UUID>`; GET is protected with verified AppDeploy user identity to prevent cross-account journal access.
- Candidate stored with chosen ID, duplicate deliveries return non-executable duplicate acknowledgment. Database quota/network errors are not silently represented as success.
- The UI is a **diagnostic** display for `CANDIDATE` only; these do not feed an automatic exchange order or constitute an A/A+ signal.
- **Still missing:** independent Binance 15m/1D/4H validation, Ledger migration, background candidate orchestrator, 24/7 VPS, broker integration, exit guards, whole-system failover; no claim of AUTO-LIVE readiness.
