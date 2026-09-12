export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    service: "SMOKE_TRADING_OS",
    mode: "AUTO_OBSERVE",
    liveExecutionEnabled: false,
    manualIsolation: "REQUIRED",
    autoMarginCapUsdt: 1,
    chartEngine: "lightweight-charts@5.2.1",
    timestamp: Date.now(),
  }, { headers: { "cache-control": "no-store" } });
}
