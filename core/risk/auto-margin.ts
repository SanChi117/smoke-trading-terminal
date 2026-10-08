export type ExchangeQuantityRules = Readonly<{
  stepSize: number;
  tickSize?: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
}>;

export type AutoQuantityResult = Readonly<{
  ok: boolean;
  quantity: number;
  notional: number;
  marginUsdt: number;
  reason?: "MARGIN_CAP_NOT_FEASIBLE" | "INVALID_INPUT";
}>;

const OBSERVATION_MARGIN_CAP_USDT = 1;

function floorToStep(value: number, step: number): number {
  const precision = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number((Math.floor((value + Number.EPSILON) / step) * step).toFixed(precision));
}

export function calculateAutoQuantity(price: number, requestedMarginUsdt: number, leverage: number, rules: ExchangeQuantityRules): AutoQuantityResult {
  if (![price, requestedMarginUsdt, leverage, rules.stepSize, rules.minQty, rules.maxQty, rules.minNotional].every((value) => Number.isFinite(value) && value > 0)) {
    return { ok: false, quantity: 0, notional: 0, marginUsdt: 0, reason: "INVALID_INPUT" };
  }
  const marginCap = Math.min(requestedMarginUsdt, OBSERVATION_MARGIN_CAP_USDT);
  const quantity = floorToStep((marginCap * leverage) / price, rules.stepSize);
  const notional = quantity * price;
  const marginUsdt = notional / leverage;
  if (quantity < rules.minQty || quantity > rules.maxQty || notional < rules.minNotional || marginUsdt > OBSERVATION_MARGIN_CAP_USDT + 1e-9) {
    return { ok: false, quantity, notional, marginUsdt, reason: "MARGIN_CAP_NOT_FEASIBLE" };
  }
  return Object.freeze({ ok: true, quantity, notional, marginUsdt });
}
