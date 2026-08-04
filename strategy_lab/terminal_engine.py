"""Auditable terminal engine for the frozen Smoke HYBRID v2 baseline.

The engine is intentionally paper/research only.  It has no exchange account
client and no order-placement method.  It converts public OHLCV candles into
MTF features, filtered risk plans, conservative candle exits and reports.
"""

from __future__ import annotations

import csv
import json
import math
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Iterable

from strategy_lab.candle_exit_simulator import SimulatedExit, simulate_plan_exits
from strategy_lab.market_data import Candle, group_candles_by_symbol, read_candles_csv
from strategy_lab.mtf_feature_builder import MarketFeature, build_features
from strategy_lab.risk_model import RiskPlan, build_risk_plan, build_risk_plans
from strategy_lab.setup_generator import generate_candidate_setups, should_emit_candidate
from strategy_lab.terminal_universe import profile_map, terminal_universe_rows


FINAL_BASELINE = "TAGGED_MTF_NO_DIRECTION_BLOCK_V1"
ALLOWED_SETUP_TYPES = frozenset({"pullback", "ignition"})
ALLOWED_DIRECTION_CONTEXTS = frozenset({"down"})
BLOCKED_SETUP_TYPES = frozenset({"breakout", "range_rotation", "watch_impulse", "liquidity_reclaim"})
BLOCKED_VOLATILITY_REGIMES = frozenset({"high"})
BLOCKED_LIQUIDITY_STATES = frozenset({"high_sweep_reject"})
BLOCKED_CANDLE_TYPES = frozenset({"bear_rejection"})
MIN_CONFIDENCE = 43.0
MIN_VOLUME_RATIO = 0.70


@dataclass(frozen=True)
class ExecutionConfig:
    initial_cash: float = 10_000.0
    risk_pct: float = 0.005
    max_positions: int = 2
    max_positions_per_symbol: int = 1
    fee_rate_per_side: float = 0.0004
    slippage_rate_per_side: float = 0.0002

    def validate(self) -> None:
        if self.initial_cash <= 0:
            raise ValueError("initial_cash must be positive")
        if not 0 < self.risk_pct <= 0.01:
            raise ValueError("risk_pct must be in (0, 0.01]")
        if self.max_positions < 1 or self.max_positions > 10:
            raise ValueError("max_positions must be between 1 and 10")
        if self.max_positions_per_symbol != 1:
            raise ValueError("the frozen safety policy allows one position per symbol")


@dataclass(frozen=True)
class ExecutedTrade:
    symbol: str
    asset_class: str
    side: str
    entry_time: str
    exit_time: str
    entry: float
    stop: float
    target: float
    exit: float
    setup_type: str
    confidence: float
    gross_r: float
    cost_r: float
    net_r: float
    exit_reason: str
    bars_held: int
    risk_pct: float
    equity_change_pct: float


def extract_reason_value(reason: object, key: str) -> str:
    prefix = f"{key}="
    for part in str(reason or "").split("|"):
        if part.startswith(prefix):
            return part[len(prefix):].strip().lower()
    return ""


def extract_reason_float(reason: object, key: str, default: float = 0.0) -> float:
    try:
        return float(extract_reason_value(reason, key) or default)
    except (TypeError, ValueError):
        return default


def plan_passes_final_filter(plan: RiskPlan) -> tuple[bool, str]:
    """Apply the exact paper baseline rules frozen in the decision log."""
    setup = plan.setup_type.lower()
    direction = extract_reason_value(plan.reason, "dir")
    liquidity = extract_reason_value(plan.reason, "liq")
    candle = extract_reason_value(plan.reason, "candle")
    volume_ratio = extract_reason_float(plan.reason, "vr", 0.0)

    if plan.confidence_hint < MIN_CONFIDENCE:
        return False, "confidence_below_43"
    if setup not in ALLOWED_SETUP_TYPES:
        return False, "setup_not_allowed"
    if setup in BLOCKED_SETUP_TYPES:
        return False, "setup_blocked"
    if direction not in ALLOWED_DIRECTION_CONTEXTS:
        return False, "direction_not_down"
    if plan.volatility_regime.lower() in BLOCKED_VOLATILITY_REGIMES:
        return False, "high_volatility"
    if liquidity in BLOCKED_LIQUIDITY_STATES:
        return False, "high_sweep_reject"
    if candle in BLOCKED_CANDLE_TYPES:
        return False, "bear_rejection"
    if volume_ratio < MIN_VOLUME_RATIO:
        return False, "volume_ratio_below_0_70"
    return True, "allowed_final_hybrid_v2"


def _iso(value: object) -> str:
    return value.isoformat(timespec="seconds") if hasattr(value, "isoformat") else str(value)


def _safe_pf(values: Iterable[float]) -> float | None:
    rows = list(values)
    gross_profit = sum(value for value in rows if value > 0)
    gross_loss = -sum(value for value in rows if value < 0)
    if gross_loss <= 1e-12:
        return None if gross_profit <= 1e-12 else 99.0
    return round(gross_profit / gross_loss, 4)


def _max_drawdown_pct(equity_curve: list[dict[str, Any]]) -> float:
    peak = 0.0
    worst = 0.0
    for row in equity_curve:
        equity = float(row["equity"])
        peak = max(peak, equity)
        if peak > 0:
            worst = max(worst, (peak - equity) / peak * 100.0)
    return round(worst, 4)


def _metrics(trades: list[ExecutedTrade], cfg: ExecutionConfig) -> dict[str, Any]:
    values = [trade.net_r for trade in trades]
    equity = cfg.initial_cash
    curve = [{"time": trades[0].entry_time if trades else "", "equity": round(equity, 4)}]
    for trade in sorted(trades, key=lambda item: (item.exit_time, item.symbol)):
        equity *= 1.0 + cfg.risk_pct * trade.net_r
        curve.append({"time": trade.exit_time, "equity": round(equity, 4)})
    return {
        "trades": len(trades),
        "wins": sum(value > 0 for value in values),
        "losses": sum(value < 0 for value in values),
        "winrate_pct": round(sum(value > 0 for value in values) / len(values) * 100.0, 4) if values else 0.0,
        "gross_r": round(sum(trade.gross_r for trade in trades), 4),
        "net_r": round(sum(values), 4),
        "avg_net_r": round(mean(values), 4) if values else 0.0,
        "profit_factor": _safe_pf(values),
        "initial_cash": round(cfg.initial_cash, 2),
        "final_cash": round(equity, 2),
        "return_pct": round((equity / cfg.initial_cash - 1.0) * 100.0, 4),
        "max_drawdown_pct": _max_drawdown_pct(curve),
        "equity_curve": curve,
    }


def _execute_capacity_limited(
    plans: list[RiskPlan],
    exits: list[SimulatedExit],
    cfg: ExecutionConfig,
) -> tuple[list[ExecutedTrade], dict[str, int]]:
    profiles = profile_map()
    active: list[tuple[datetime, str]] = []
    executed: list[ExecutedTrade] = []
    skipped = {"max_positions": 0, "symbol_already_open": 0, "no_future_candles": 0}
    paired = sorted(zip(plans, exits), key=lambda item: (item[0].entry_time, item[0].symbol))

    for plan, result in paired:
        active = [(exit_time, symbol) for exit_time, symbol in active if exit_time > plan.entry_time]
        if result.exit_reason == "no_future_candles":
            skipped["no_future_candles"] += 1
            continue
        if any(symbol == plan.symbol for _, symbol in active):
            skipped["symbol_already_open"] += 1
            continue
        if len(active) >= cfg.max_positions:
            skipped["max_positions"] += 1
            continue

        round_trip_cost = 2.0 * (cfg.fee_rate_per_side + cfg.slippage_rate_per_side)
        cost_r = round_trip_cost / max(plan.stop_pct, 1e-12)
        net_r = float(result.r_mult) - cost_r
        asset_class = profiles.get(plan.symbol).asset_class if plan.symbol in profiles else "unclassified"
        executed.append(ExecutedTrade(
            symbol=plan.symbol,
            asset_class=asset_class,
            side=plan.side,
            entry_time=_iso(plan.entry_time),
            exit_time=_iso(result.exit_time),
            entry=plan.entry,
            stop=plan.stop,
            target=plan.target,
            exit=result.exit,
            setup_type=plan.setup_type,
            confidence=plan.confidence_hint,
            gross_r=round(float(result.r_mult), 6),
            cost_r=round(cost_r, 6),
            net_r=round(net_r, 6),
            exit_reason=result.exit_reason,
            bars_held=result.bars_held,
            risk_pct=cfg.risk_pct,
            equity_change_pct=round(cfg.risk_pct * net_r * 100.0, 6),
        ))
        active.append((result.exit_time, plan.symbol))
    return executed, skipped


def _group_metrics(trades: list[ExecutedTrade], key: str, cfg: ExecutionConfig) -> list[dict[str, Any]]:
    groups: dict[str, list[ExecutedTrade]] = {}
    for trade in trades:
        groups.setdefault(str(getattr(trade, key)), []).append(trade)
    out = []
    for name, rows in sorted(groups.items()):
        item = _metrics(rows, cfg)
        item.pop("equity_curve", None)
        item[key] = name
        out.append(item)
    return out


def _fold_metrics(trades: list[ExecutedTrade], start: datetime, end: datetime, cfg: ExecutionConfig, folds: int = 4) -> list[dict[str, Any]]:
    span = max((end - start).total_seconds(), 1.0)
    rows = []
    for index in range(folds):
        lo = start.timestamp() + span * index / folds
        hi = start.timestamp() + span * (index + 1) / folds
        fold_trades = [trade for trade in trades if lo <= datetime.fromisoformat(trade.entry_time).timestamp() < hi or (index == folds - 1 and datetime.fromisoformat(trade.entry_time).timestamp() == hi)]
        item = _metrics(fold_trades, cfg)
        item.pop("equity_curve", None)
        item.update({"fold": index + 1, "start": datetime.fromtimestamp(lo).isoformat(timespec="seconds"), "end": datetime.fromtimestamp(hi).isoformat(timespec="seconds")})
        rows.append(item)
    return rows


def _latest_scanner(features: list[MarketFeature]) -> list[dict[str, Any]]:
    latest: dict[str, MarketFeature] = {}
    for feature in features:
        if feature.symbol not in latest or feature.time > latest[feature.symbol].time:
            latest[feature.symbol] = feature
    profiles = profile_map()
    rows = []
    for symbol, feature in sorted(latest.items()):
        state = "blocked"
        reason = "no_candidate_on_latest_closed_bar"
        plan: RiskPlan | None = None
        if should_emit_candidate(feature, min_confidence=MIN_CONFIDENCE):
            candidate = generate_candidate_setups([feature], min_confidence=MIN_CONFIDENCE)
            if candidate:
                plan = build_risk_plan(candidate[0])
                allowed, reason = plan_passes_final_filter(plan)
                state = "paper_ready" if allowed else "blocked"
        rows.append({
            "symbol": symbol,
            "asset_class": profiles.get(symbol).asset_class if symbol in profiles else "unclassified",
            "time": _iso(feature.time),
            "price": feature.close,
            "direction_context": feature.trend_direction,
            "context_alignment": feature.context_alignment,
            "setup_type": feature.setup_bias,
            "confidence": plan.confidence_hint if plan else feature.setup_quality,
            "volatility_regime": feature.volatility_regime,
            "volume_ratio": feature.volume_ratio,
            "candle_type": feature.candle_signal,
            "liquidity_state": feature.liquidity_event,
            "state": state,
            "reason": reason,
            "entry": plan.entry if plan else None,
            "stop": plan.stop if plan and state == "paper_ready" else None,
            "target": plan.target if plan and state == "paper_ready" else None,
            "target_rr": plan.target_rr if plan and state == "paper_ready" else None,
        })
    return rows


def evaluate_candles(candles: Iterable[Candle], cfg: ExecutionConfig | None = None) -> dict[str, Any]:
    cfg = cfg or ExecutionConfig()
    cfg.validate()
    candle_rows = sorted(list(candles), key=lambda item: (item.symbol, item.time))
    if not candle_rows:
        raise ValueError("No candles supplied")

    features = build_features(candle_rows)
    candidates = generate_candidate_setups(features, min_confidence=MIN_CONFIDENCE)
    plans = build_risk_plans(candidates)
    accepted: list[RiskPlan] = []
    rejection_counts: dict[str, int] = {}
    for plan in plans:
        allowed, reason = plan_passes_final_filter(plan)
        if allowed:
            accepted.append(plan)
        else:
            rejection_counts[reason] = rejection_counts.get(reason, 0) + 1

    exits = simulate_plan_exits(accepted, candle_rows)
    executed, capacity_skips = _execute_capacity_limited(accepted, exits, cfg)
    times = [item.time for item in candle_rows]
    metrics = _metrics(executed, cfg)
    folds = _fold_metrics(executed, min(times), max(times), cfg)
    positive_folds = sum(item["return_pct"] > 0 for item in folds)
    decision = "PASS_RESEARCH_CHECK" if len(executed) >= 100 and positive_folds >= 3 and (metrics["profit_factor"] or 0) > 1.15 and metrics["max_drawdown_pct"] <= 8.0 else "BLOCK_LIVE"

    chart: dict[str, list[dict[str, Any]]] = {}
    for symbol, rows in group_candles_by_symbol(candle_rows).items():
        chart[symbol] = [
            {"time": _iso(item.time), "open": item.open, "high": item.high, "low": item.low, "close": item.close, "volume": item.volume}
            for item in rows[-240:]
        ]

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0).isoformat(),
        "mode": "research_and_paper_only",
        "live_execution": False,
        "baseline": FINAL_BASELINE,
        "rules": {
            "allowed_setup_types": sorted(ALLOWED_SETUP_TYPES),
            "allowed_direction_contexts": sorted(ALLOWED_DIRECTION_CONTEXTS),
            "blocked_setup_types": sorted(BLOCKED_SETUP_TYPES),
            "blocked_volatility_regimes": sorted(BLOCKED_VOLATILITY_REGIMES),
            "blocked_liquidity_states": sorted(BLOCKED_LIQUIDITY_STATES),
            "blocked_candle_types": sorted(BLOCKED_CANDLE_TYPES),
            "min_confidence": MIN_CONFIDENCE,
            "min_volume_ratio": MIN_VOLUME_RATIO,
            "entry_timeframe": "15m",
            "context_timeframes": ["1D", "4H"],
            "five_minute_gate": False,
        },
        "execution_assumptions": asdict(cfg),
        "period": {"start": _iso(min(times)), "end": _iso(max(times)), "candles": len(candle_rows), "symbols": len({item.symbol for item in candle_rows})},
        "pipeline": {"features": len(features), "candidates": len(candidates), "accepted_signals": len(accepted), "executed_trades": len(executed), "rejections": rejection_counts, "capacity_skips": capacity_skips},
        "metrics": metrics,
        "by_symbol": _group_metrics(executed, "symbol", cfg),
        "by_asset_class": _group_metrics(executed, "asset_class", cfg),
        "chronological_folds": folds,
        "fresh_validation_decision": decision,
        "paper_gate": {"required_closed_trades": 100, "required_calendar_days": 30, "live_unlocked": False},
        "scanner": _latest_scanner(features),
        "trades": [asdict(item) for item in executed],
        "chart": chart,
        "universe": terminal_universe_rows(),
    }


def run_backtest_from_csv(candles_csv: str | Path, out_dir: str | Path, cfg: ExecutionConfig | None = None) -> dict[str, Any]:
    report = evaluate_candles(read_candles_csv(candles_csv), cfg=cfg)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "terminal_backtest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    trades = report["trades"]
    with (out / "terminal_trades.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = list(trades[0]) if trades else ["symbol", "entry_time", "exit_time", "net_r"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(trades)
    return report
