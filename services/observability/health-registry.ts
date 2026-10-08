import type { MarketHealth } from "../../core/contracts/market.ts";

export type ComponentName = "BINANCE_REST" | "BINANCE_WS" | "OPENAI" | "DATABASE" | "TELEGRAM" | "EXECUTION" | "GUARDIAN";
export type ComponentHealth = Readonly<{ component: ComponentName; status: MarketHealth; checkedAt: number; latencyMs?: number; detail?: string }>;

export class HealthRegistry {
  private readonly values = new Map<ComponentName, ComponentHealth>();
  report(health: ComponentHealth): void { this.values.set(health.component, Object.freeze({ ...health })); }
  snapshot(now = Date.now()): readonly ComponentHealth[] {
    return Object.freeze([...this.values.values()].map((item) => now - item.checkedAt > 60_000 ? Object.freeze({ ...item, status: "STALE" as const, detail: "HEARTBEAT_MISSED" }) : item));
  }
}
