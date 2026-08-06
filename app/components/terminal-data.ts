import type { MtfLevelAnalysis, SetupModel, Side } from "../lib/mtf-level-strategy";

export const TERMINAL_SYMBOLS = [
  ["BTCUSDT", "Bitcoin", "Major"],
  ["ETHUSDT", "Ethereum", "Major"],
  ["SOLUSDT", "Solana", "Layer 1"],
  ["BNBUSDT", "BNB", "Exchange"],
  ["XRPUSDT", "XRP", "Payments"],
  ["ADAUSDT", "Cardano", "Layer 1"],
  ["AVAXUSDT", "Avalanche", "Layer 1"],
  ["SUIUSDT", "Sui", "Layer 1"],
  ["LINKUSDT", "Chainlink", "Oracle"],
  ["AAVEUSDT", "Aave", "DeFi"],
  ["UNIUSDT", "Uniswap", "DeFi"],
  ["ARBUSDT", "Arbitrum", "Layer 2"],
  ["OPUSDT", "Optimism", "Layer 2"],
  ["NEARUSDT", "NEAR", "Layer 1"],
  ["LTCUSDT", "Litecoin", "Payments"],
  ["BCHUSDT", "Bitcoin Cash", "Payments"],
  ["DOGEUSDT", "Dogecoin", "Meme"],
  ["TAOUSDT", "Bittensor", "AI"],
  ["ONDOUSDT", "Ondo", "RWA"],
] as const;

export type JournalEventType = "formed" | "cancelled";

export type JournalEvent = {
  id: string;
  signature: string;
  symbol: string;
  time: number;
  type: JournalEventType;
  side: Side | null;
  model: SetupModel | null;
  state: MtfLevelAnalysis["state"];
  confidence: number;
  weeklyBias: MtfLevelAnalysis["weeklyBias"];
  dailyBias: MtfLevelAnalysis["dailyBias"];
  rangePosition: "premium" | "discount" | "equilibrium" | null;
  route4h: MtfLevelAnalysis["route4h"]["state"];
  zoneId: string | null;
  zoneLabel: string | null;
  zoneSource: string | null;
  zoneTimeframe: string | null;
  reactionType: MtfLevelAnalysis["reaction"]["type"];
  reactionScore: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  reason: string;
  blockers: string[];
};

export function setupSignature(analysis: MtfLevelAnalysis): string {
  return [
    analysis.symbol,
    analysis.side ?? "none",
    analysis.activeZone?.id ?? "none",
    analysis.setupModel ?? "none",
    analysis.reaction.time ?? 0,
    analysis.entry ?? 0,
  ].join(":");
}

export function journalEventFromAnalysis(
  analysis: MtfLevelAnalysis,
  type: JournalEventType,
  previous?: MtfLevelAnalysis | null,
): JournalEvent {
  const source = type === "cancelled" && previous ? previous : analysis;
  const time = type === "formed"
    ? source.reaction.time ?? source.evaluatedAt
    : analysis.evaluatedAt;
  const signature = `${type}:${setupSignature(source)}:${Math.floor(time / 60_000)}`;
  return {
    id: `${signature}:${Math.random().toString(36).slice(2, 8)}`,
    signature,
    symbol: source.symbol,
    time,
    type,
    side: source.side,
    model: source.setupModel ?? null,
    state: analysis.state,
    confidence: source.confidence,
    weeklyBias: source.weeklyBias,
    dailyBias: source.dailyBias,
    rangePosition: source.range?.position ?? null,
    route4h: source.route4h.state,
    zoneId: source.activeZone?.id ?? null,
    zoneLabel: source.activeZone?.label ?? null,
    zoneSource: source.activeZone?.source ?? null,
    zoneTimeframe: source.activeZone?.timeframe ?? null,
    reactionType: source.reaction.type,
    reactionScore: source.reaction.score,
    entry: source.entry,
    stop: source.stop,
    target: source.target,
    rr: source.rr,
    reason: type === "cancelled"
      ? analysis.reason || "Сетап отменён изменением структуры или уровня"
      : source.reason,
    blockers: analysis.blockers,
  };
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (value >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 7 });
}

export function modelLabel(model: SetupModel | null | undefined): string {
  if (model === "location") return "LOCATION";
  if (model === "reversal") return "REVERSAL";
  if (model === "continuation") return "CONTINUATION";
  if (model === "blocked") return "BLOCKED";
  return "—";
}
