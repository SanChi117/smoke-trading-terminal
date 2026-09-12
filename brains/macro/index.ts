import type { BrainFeatureSnapshot } from "../../core/contracts/features.ts";

export type MacroContext = Readonly<{ contextId: string; regime: "RISK_ON" | "RANGE" | "RISK_OFF" | "HIGH_VOL"; bias: "BULLISH" | "BEARISH" | "NEUTRAL"; tacticalCounterTrendAllowed: boolean; narrative: string }>;

export function analyzeMacro(snapshot: BrainFeatureSnapshot): MacroContext {
  const highVol = Math.abs(snapshot.priceAcceleration) >= 2 || snapshot.relativeVolume >= 3;
  const bullish = snapshot.monthlyState === "UP" && ["UP", "ACCUMULATION"].includes(snapshot.weeklyState);
  const bearish = snapshot.monthlyState === "DOWN" && ["DOWN", "DISTRIBUTION"].includes(snapshot.weeklyState);
  const regime = highVol ? "HIGH_VOL" : bullish ? "RISK_ON" : bearish ? "RISK_OFF" : "RANGE";
  const bias = bullish ? "BULLISH" : bearish ? "BEARISH" : "NEUTRAL";
  const tacticalCounterTrendAllowed = snapshot.sweepReclaimScore >= 0.7 || Math.abs(snapshot.oiChangePct) >= 3;
  return Object.freeze({ contextId: snapshot.macroContextId, regime, bias, tacticalCounterTrendAllowed, narrative: `${snapshot.monthlyState} 1M → ${snapshot.weeklyState} 1W → ${snapshot.dailyState} 1D` });
}
