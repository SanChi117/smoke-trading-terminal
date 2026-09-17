export const dynamic = "force-dynamic";

export async function GET() {
  const openaiReady = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_ARBITER_MODEL);
  const binanceReady = Boolean(process.env.BINANCE_AUTO_API_KEY && process.env.BINANCE_AUTO_SECRET_KEY);
  const telegramReady = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_AUTHORIZED_CHAT_ID);
  const leverageReady = Boolean(process.env.SMOKE_AUTO_LEVERAGE);
  const liveRequested = process.env.SMOKE_AUTO_LIVE_ENABLED === "true";
  const accountIsolated = process.env.SMOKE_AUTO_ACCOUNT_ISOLATED === "true";
  // Credentials are configuration, not proof of a reconciled runtime.
  const liveEnabled = false;
  return Response.json({
    service: "SMOKE_TRADING_OS", mode: liveEnabled ? "AUTO_LIVE" : "AUTO_OBSERVE", safeMode: liveRequested && !liveEnabled,
    manualDesk: { isolated: true, automationCanModify: false },
    autoDesk: { liveEnabled, marginCapUsdt: 1, credentialsReady: binanceReady, accountIsolated, leveragePolicyReady: leverageReady },
    modules: { marketData: "UNVERIFIED", macro: "IMPLEMENTED", brains: "IMPLEMENTED", conflicts: "IMPLEMENTED", aiArbiter: openaiReady ? "CONFIGURED_UNVERIFIED" : "WAITING_SECRET", execution: liveEnabled ? "READY" : "SAFE_LOCKED", guardian: "NOT_CONNECTED", ledger: "UNVERIFIED", telegram: telegramReady ? "CONFIGURED_UNVERIFIED" : "WAITING_SECRET", replay: "READY" },
    requiredSecrets: ["OPENAI_API_KEY", "BINANCE_AUTO_API_KEY", "BINANCE_AUTO_SECRET_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_AUTHORIZED_CHAT_ID"],
    timestamp: Date.now(),
  }, { headers: { "cache-control": "no-store" } });
}
