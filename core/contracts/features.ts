import type { MarketHealth } from "./market.ts";

export type BrainFeatureSnapshot = Readonly<{
  snapshotId: string;
  symbol: string;
  capturedAt: number;
  macroContextId: string;
  monthlyState: "UP" | "DOWN" | "RANGE" | "PRICE_DISCOVERY" | "UNKNOWN";
  weeklyState: "UP" | "DOWN" | "RANGE" | "ACCUMULATION" | "DISTRIBUTION" | "UNKNOWN";
  dailyState: "TREND" | "RANGE" | "COMPRESSION" | "EXPANSION" | "BREAKDOWN" | "RECLAIM" | "UNKNOWN";
  sideHint: "LONG" | "SHORT" | "NONE";
  priceAcceleration: number;
  relativeStrength: number;
  relativeVolume: number;
  oiChangePct: number;
  takerImbalance: number;
  compressionScore: number;
  breakoutAcceptance: number;
  sweepReclaimScore: number;
  exhaustionScore: number;
  rangeLocation: number;
  fundingRate: number;
  freshness: Readonly<Record<string, MarketHealth>>;
}>;
