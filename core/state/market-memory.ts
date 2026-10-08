import type { BrainOpinion } from "../contracts/brain.ts";
import type { MarketDatum } from "../contracts/market.ts";
import type { TradePlan } from "../contracts/trade-plan.ts";

export class MarketMemory {
  private readonly latest = new Map<string, MarketDatum<unknown>>();
  private readonly opinions = new Map<string, readonly BrainOpinion[]>();
  private readonly plans = new Map<string, TradePlan>();

  ingest(datum: MarketDatum<unknown>): void {
    const key = `${datum.symbol}:${datum.source}`;
    const current = this.latest.get(key);
    if (!current || datum.exchangeTs >= current.exchangeTs) this.latest.set(key, Object.freeze({ ...datum }));
  }

  rememberOpinions(symbol: string, next: readonly BrainOpinion[]): void {
    this.opinions.set(symbol, Object.freeze([...next]));
  }

  arm(plan: TradePlan): void { this.plans.set(plan.planId, plan); }
  close(planId: string): void { this.plans.delete(planId); }
  snapshot(symbol: string) {
    return Object.freeze({
      market: Object.freeze([...this.latest.values()].filter((item) => item.symbol === symbol)),
      opinions: this.opinions.get(symbol) ?? Object.freeze([]),
      activePlans: Object.freeze([...this.plans.values()].filter((plan) => plan.symbol === symbol)),
    });
  }
}
