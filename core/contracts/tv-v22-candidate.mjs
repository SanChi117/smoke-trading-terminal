/**
 * TradingView Structure V2.2 radar v3.6.2 candidate boundary.
 * PURE NORMALIZER ONLY. No order submit, authorization, or persistence.
 * Webhook ingress MUST authenticate the sender, rate limit, deduplicate on
 * candidate.id in durable storage, and re-check Binance context before orders.
 */
export const TV_V22_RADAR_VERSION = 'v3.6.2-v2.2-radar';
export const TV_V22_CANDLE_MS = 15 * 60_000;
export const TV_V22_DEFAULT_MAX_AGE_MS = 30 * 60_000;
export const TV_V22_MAX_BODY_BYTES = 8_192;

export class CandidateValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CandidateValidationError';
    this.code = code;
  }
}

function reject(code) {
  throw new CandidateValidationError(code);
}

function text(value, limit = 160) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : null;
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Normalized output can ONLY become a research candidate.
 * All "qty", "risk_usd", "rr_net", zone grades are untrusted claims from Pine.
 * No read-time parser is sufficient for exchange execution authorization.
 */
export function normalizeTvV22Candidate(payload, options = {}) {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? TV_V22_DEFAULT_MAX_AGE_MS;
  if (!Number.isSafeInteger(now) || now <= 0 ||
      !Number.isFinite(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 24 * 60 * 60_000) {
    reject('INVALID_VALIDATION_OPTIONS');
  }

  let item = payload;
  if (typeof item === 'string') {
    if (Buffer.byteLength(item, 'utf8') > TV_V22_MAX_BODY_BYTES) reject('ALERT_TOO_LARGE');
    try { item = JSON.parse(item); } catch { reject('INVALID_JSON'); }
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) reject('INVALID_BODY');
  if (Object.keys(item).length > 40) reject('TOO_MANY_FIELDS');

  if (item.version !== TV_V22_RADAR_VERSION) reject('UNSUPPORTED_RADAR_VERSION');
  if (item.status !== 'CANDIDATE') reject('NOT_A_CANDIDATE');
  if (item.requires_v22_validation !== true || item.bar_confirmed !== true ||
      item.qty_is_estimate !== true) reject('UNTRUSTED_CANDIDATE_FLAGS');
  if (item.timeframe !== '15') reject('WRONG_TIMEFRAME');

  const symbol = text(item.symbol, 24);
  if (!symbol || !/^[A-Z0-9]{3,20}USDT$/.test(symbol)) reject('INVALID_SYMBOL');
  const tvSymbol = text(item.tv_symbol, 64);
  if (!tvSymbol || !/^[A-Z0-9]+:[A-Z0-9]+(?:\.P)?$/.test(tvSymbol)) reject('INVALID_TV_SYMBOL');
  const tvRaw = tvSymbol.split(':')[1].replace(/\.P$/, '');
  if (tvRaw !== symbol) reject('SYMBOL_MISMATCH');

  const action = item.action;
  if (action !== 'buy' && action !== 'sell') reject('INVALID_ACTION');

  const openTime = positiveInteger(item.time);
  const closeTime = positiveInteger(item.time_close);
  if (!openTime || !closeTime || closeTime - openTime !== TV_V22_CANDLE_MS ||
      openTime % TV_V22_CANDLE_MS !== 0) reject('INVALID_CANDLE_TIMES');
  if (closeTime > now + 60_000) reject('FUTURE_CANDLE');
  if (now - closeTime > maxAgeMs) reject('STALE_CANDIDATE');

  const zoneId = text(item.zone_id, 120);
  if (!zoneId || !/^[A-Za-z0-9_]+_(?:L|S)$/.test(zoneId)) reject('INVALID_ZONE_ID');
  if ((action === 'buy' && !zoneId.endsWith('_L')) ||
      (action === 'sell' && !zoneId.endsWith('_S'))) reject('ZONE_SIDE_MISMATCH');
  const id = text(item.id, 240);
  if (id !== symbol + '_15_' + closeTime + '_' + zoneId) reject('INVALID_CANDIDATE_ID');

  const entry = positiveNumber(item.entry);
  const sl = positiveNumber(item.sl);
  const tp = positiveNumber(item.tp);
  const qty = positiveNumber(item.qty);
  const riskUsd = positiveNumber(item.risk_usd);
  const reportedNetRr = positiveNumber(item.rr_net);
  const zoneGrade = positiveInteger(item.zone_grade_proxy);
  const zoneBar = positiveInteger(item.zone_bar);
  if (!entry || !sl || !tp || !qty || !riskUsd || !reportedNetRr ||
      !zoneGrade || zoneGrade > 3 || !zoneBar) reject('INVALID_NUMERIC_FIELDS');
  if (action === 'buy' ? !(sl < entry && entry < tp) : !(tp < entry && entry < sl)) {
    reject('INVALID_PRICE_DIRECTION');
  }
  const grossRr = Math.abs(tp - entry) / Math.abs(entry - sl);
  if (!Number.isFinite(grossRr) || grossRr <= 0 || reportedNetRr > grossRr + 0.025) {
    reject('INCONSISTENT_RR');
  }

  return Object.freeze({
    source: 'TRADINGVIEW_V22_RADAR',
    version: TV_V22_RADAR_VERSION,
    status: 'CANDIDATE',
    id,
    symbol,
    tvSymbol,
    timeframe: '15m',
    side: action === 'buy' ? 'LONG' : 'SHORT',
    entry,
    sl,
    tp,
    // Never forward TradingView quantity to an exchange order.
    qtyEstimate: qty,
    reportedRiskUsd: riskUsd,
    reportedNetRr,
    grossRr,
    zoneId,
    zoneGradeProxy: zoneGrade,
    zoneBar,
    barOpenTime: openTime,
    barCloseTime: closeTime,
    expiresAt: closeTime + maxAgeMs,
    needsIndependentV22Validation: true,
    executionAuthorized: false,
  });
}
