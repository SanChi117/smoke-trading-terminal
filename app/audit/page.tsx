"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  analyzeLevelFlow,
  findPivots,
  type Candle,
  type MtfLevelAnalysis,
  type PriceZone,
  type Timeframe,
  type TimeframeBundle,
} from "../lib/mtf-level-strategy";
import { fetchKlinesRange } from "../lib/binance-level-client";
import styles from "./audit.module.css";

type GoldenCase = {
  id: string;
  title: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  side: "long" | "short";
  entryTime: string;
  exitTime: string;
  entry: number;
  stop: number;
  target: number;
  netR: number;
  outcome: "take_profit" | "stop_loss" | "time_stop";
  zone: string;
  reaction: "displacement" | "structure_retest" | "sweep_reclaim";
  note: string;
};

type LoadedCase = {
  analysis: MtfLevelAnalysis;
  bundle: TimeframeBundle;
  execution: Candle[];
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

const CASES: GoldenCase[] = [
  {
    id: "btc-short-win",
    title: "BTC SHORT — правильный импульс от 4H LH",
    symbol: "BTCUSDT",
    side: "short",
    entryTime: "2026-06-08T15:45:00.000Z",
    exitTime: "2026-06-09T14:15:00.000Z",
    entry: 63841.3,
    stop: 64798.126302683704,
    target: 61556.759552778705,
    netR: 2.3076,
    outcome: "take_profit",
    zone: "4H LH",
    reaction: "displacement",
    note: "Победный SHORT: старший контекст вниз, возврат в 4H supply, свежий 5m displacement и первое 15m подтверждение.",
  },
  {
    id: "btc-short-loss",
    title: "BTC SHORT — корректный вход, затем SL",
    symbol: "BTCUSDT",
    side: "short",
    entryTime: "2026-07-02T18:00:00.000Z",
    exitTime: "2026-07-03T20:00:00.000Z",
    entry: 61643,
    stop: 62467.50449907067,
    target: 60042.481256491395,
    netR: -1.0897,
    outcome: "stop_loss",
    zone: "4H LH",
    reaction: "displacement",
    note: "Убыточный SHORT оставлен специально: визуальный аудит проверяет корректность логики, а не выбирает только победителей.",
  },
  {
    id: "eth-long-win",
    title: "ETH LONG — sweep/reclaim от 4H Demand OB",
    symbol: "ETHUSDT",
    side: "long",
    entryTime: "2025-09-02T13:30:00.000Z",
    exitTime: "2025-09-03T14:30:00.000Z",
    entry: 4304.54,
    stop: 4232.334162278619,
    target: 4457.090167112306,
    netR: 2.0412,
    outcome: "take_profit",
    zone: "4H Demand OB",
    reaction: "sweep_reclaim",
    note: "Победный LONG: discount, 4H demand, снятие нижней ликвидности и возврат, затем 15m подтверждение.",
  },
  {
    id: "eth-long-loss",
    title: "ETH LONG — корректный setup, затем SL",
    symbol: "ETHUSDT",
    side: "long",
    entryTime: "2025-08-14T19:30:00.000Z",
    exitTime: "2025-08-14T21:30:00.000Z",
    entry: 4565.97,
    stop: 4462.832166559657,
    target: 4751.789417431464,
    netR: -1.0531,
    outcome: "stop_loss",
    zone: "PDL",
    reaction: "structure_retest",
    note: "Убыточный LONG показывает, что правильная последовательность не гарантирует исход каждой отдельной сделки.",
  },
];

const TF_MS: Record<Timeframe, number> = {
  "1w": 7 * DAY,
  "1d": DAY,
  "4h": 4 * HOUR,
  "15m": 15 * MINUTE,
  "5m": 5 * MINUTE,
};

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

function selectClosed(candles: Candle[], timeframe: Timeframe, now: number): Candle[] {
  return candles.filter((candle) => candle.time + TF_MS[timeframe] <= now);
}

async function loadCase(item: GoldenCase, signal: AbortSignal): Promise<LoadedCase> {
  const decisionTime = new Date(item.entryTime).getTime() + 1;
  const exitTime = new Date(item.exitTime).getTime();
  const [weekly, daily, fourH, fifteenM, fiveM, execution] = await Promise.all([
    fetchKlinesRange(item.symbol, "1w", decisionTime - 90 * 7 * DAY, decisionTime, signal),
    fetchKlinesRange(item.symbol, "1d", decisionTime - 380 * DAY, decisionTime, signal),
    fetchKlinesRange(item.symbol, "4h", decisionTime - 180 * DAY, decisionTime, signal),
    fetchKlinesRange(item.symbol, "15m", decisionTime - 35 * DAY, decisionTime, signal),
    fetchKlinesRange(item.symbol, "5m", decisionTime - 12 * DAY, decisionTime, signal),
    fetchKlinesRange(item.symbol, "15m", decisionTime - 4 * DAY, exitTime + DAY, signal),
  ]);
  const bundle: TimeframeBundle = {
    "1w": selectClosed(weekly, "1w", decisionTime),
    "1d": selectClosed(daily, "1d", decisionTime),
    "4h": selectClosed(fourH, "4h", decisionTime),
    "15m": selectClosed(fifteenM, "15m", decisionTime),
    "5m": selectClosed(fiveM, "5m", decisionTime),
  };
  return {
    bundle,
    execution,
    analysis: analyzeLevelFlow(item.symbol, bundle, decisionTime),
  };
}

function sliceAround(candles: Candle[], center: number, before: number, after: number): Candle[] {
  return candles.filter((candle) => candle.time >= center - before && candle.time <= center + after);
}

type AuditChartProps = {
  title: string;
  timeframe: Timeframe;
  candles: Candle[];
  analysis: MtfLevelAnalysis;
  trade: GoldenCase;
  showTrade?: boolean;
  markerTime?: number;
};

function AuditChart({ title, timeframe, candles, analysis, trade, showTrade = false, markerTime }: AuditChartProps) {
  const width = 960;
  const height = 360;
  const left = 14;
  const right = 82;
  const top = 18;
  const bottom = 318;
  const chart = useMemo(() => {
    if (!candles.length) return null;
    const visible = candles.slice(-220);
    const minCandle = Math.min(...visible.map((candle) => candle.low));
    const maxCandle = Math.max(...visible.map((candle) => candle.high));
    const nearbyZones = analysis.zones
      .filter((zone) => zone.active && zone.high >= minCandle * 0.96 && zone.low <= maxCandle * 1.04)
      .slice(0, 8);
    const values = visible.flatMap((candle) => [candle.low, candle.high]);
    for (const zone of nearbyZones) values.push(zone.low, zone.high);
    if (showTrade) values.push(trade.entry, trade.stop, trade.target);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const padding = Math.max((high - low) * 0.08, high * 0.002);
    const domainLow = low - padding;
    const domainHigh = high + padding;
    const x = (index: number) => left + ((index + 0.5) / visible.length) * (width - left - right);
    const y = (price: number) => top + ((domainHigh - price) / Math.max(domainHigh - domainLow, 1e-9)) * (bottom - top);
    return { visible, nearbyZones, domainLow, domainHigh, x, y };
  }, [analysis.zones, candles, showTrade, trade.entry, trade.stop, trade.target]);

  if (!chart) return <div className={styles.empty}>Нет свечей</div>;
  const pivots = findPivots(chart.visible, 3, 3).slice(-16);
  const markerIndex = markerTime
    ? chart.visible.reduce((best, candle, index) => Math.abs(candle.time - markerTime) < Math.abs(chart.visible[best].time - markerTime) ? index : best, 0)
    : null;
  const bodyWidth = Math.max(2, Math.min(10, (width - left - right) / chart.visible.length * 0.65));

  return <article className={styles.chartCard}>
    <div className={styles.chartHead}><div><span>{timeframe}</span><h3>{title}</h3></div><small>{chart.visible.length} свечей · только данные, доступные в момент решения</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label={`${trade.symbol} ${timeframe} ${title}`}>
      <rect width={width} height={height} className={styles.chartBackground}/>
      {Array.from({ length: 6 }, (_, index) => {
        const yy = top + (index / 5) * (bottom - top);
        const price = chart.domainHigh - (index / 5) * (chart.domainHigh - chart.domainLow);
        return <g key={index}><line x1={left} y1={yy} x2={width - right} y2={yy} className={styles.grid}/><text x={width - right + 8} y={yy + 4} className={styles.axis}>{formatPrice(price)}</text></g>;
      })}
      {chart.nearbyZones.map((zone: PriceZone) => {
        const zoneTop = chart.y(zone.high);
        const zoneBottom = chart.y(zone.low);
        const active = analysis.activeZone?.id === zone.id;
        return <g key={zone.id}>
          <rect x={left} y={zoneTop} width={width - left - right} height={Math.max(2, zoneBottom - zoneTop)} className={zone.kind === "demand" ? styles.demand : styles.supply} opacity={active ? 0.42 : 0.17}/>
          <text x={left + 7} y={zoneTop + 13} className={active ? styles.activeZoneText : styles.zoneText}>{zone.label} · Q{zone.score}</text>
        </g>;
      })}
      {chart.visible.map((candle, index) => {
        const xx = chart.x(index);
        const up = candle.close >= candle.open;
        const yOpen = chart.y(candle.open);
        const yClose = chart.y(candle.close);
        return <g key={candle.time} className={up ? styles.up : styles.down}>
          <line x1={xx} y1={chart.y(candle.high)} x2={xx} y2={chart.y(candle.low)}/>
          <rect x={xx - bodyWidth / 2} y={Math.min(yOpen, yClose)} width={bodyWidth} height={Math.max(1.5, Math.abs(yClose - yOpen))}/>
        </g>;
      })}
      {pivots.map((pivot) => <text key={`${pivot.time}-${pivot.kind}`} x={chart.x(pivot.index)} y={chart.y(pivot.price) + (pivot.kind === "high" ? -7 : 13)} className={pivot.kind === "high" ? styles.pivotHigh : styles.pivotLow}>{pivot.label}</text>)}
      {analysis.structure.filter((event) => event.timeframe === timeframe).map((event) => {
        const index = chart.visible.findIndex((candle) => candle.time === event.time);
        if (index < 0) return null;
        return <g key={`${event.time}-${event.tag}`}><line x1={Math.max(left, chart.x(index) - 38)} y1={chart.y(event.price)} x2={chart.x(index) + 6} y2={chart.y(event.price)} className={event.side === "long" ? styles.bullStructure : styles.bearStructure}/><text x={chart.x(index) - 33} y={chart.y(event.price) - 5} className={event.side === "long" ? styles.bullLabel : styles.bearLabel}>{event.tag}</text></g>;
      })}
      {markerIndex !== null && <g><line x1={chart.x(markerIndex)} y1={top} x2={chart.x(markerIndex)} y2={bottom} className={styles.decisionLine}/><text x={chart.x(markerIndex) + 5} y={top + 13} className={styles.decisionText}>DECISION</text></g>}
      {analysis.reaction.time && timeframe === "5m" && (() => {
        const index = chart.visible.reduce((best, candle, current) => Math.abs(candle.time - (analysis.reaction.time ?? 0)) < Math.abs(chart.visible[best].time - (analysis.reaction.time ?? 0)) ? current : best, 0);
        return <g><circle cx={chart.x(index)} cy={chart.y(analysis.reaction.triggerPrice ?? chart.visible[index].close)} r="7" className={styles.reactionDot}/><text x={chart.x(index) + 10} y={chart.y(analysis.reaction.triggerPrice ?? chart.visible[index].close) - 9} className={styles.reactionText}>{analysis.reaction.type}</text></g>;
      })()}
      {showTrade && ([
        [trade.entry, "ENTRY", styles.entryLine],
        [trade.stop, "SL", styles.stopLine],
        [trade.target, "TP", styles.targetLine],
      ] as Array<[number, string, string]>).map(([value, label, className]) => <g key={label}><line x1={left} y1={chart.y(value)} x2={width - right} y2={chart.y(value)} className={className}/><text x={width - right - 42} y={chart.y(value) - 4} className={styles.tradeText}>{label}</text></g>)}
    </svg>
  </article>;
}

export default function AuditPage() {
  const [selectedId, setSelectedId] = useState(CASES[0].id);
  const [loaded, setLoaded] = useState<LoadedCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selected = CASES.find((item) => item.id === selectedId) ?? CASES[0];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setLoaded(null);
    loadCase(selected, controller.signal)
      .then(setLoaded)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить исторические свечи");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected]);

  const decisionTime = new Date(selected.entryTime).getTime();
  const exitTime = new Date(selected.exitTime).getTime();
  const reproduced = Boolean(
    loaded
    && loaded.analysis.state === "ready"
    && loaded.analysis.side === selected.side
    && loaded.analysis.reaction.type === selected.reaction,
  );

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div><span className={styles.brand}>SMOKE</span><b>Golden Case Audit</b><small>Визуальная проверка уровневой MTF-логики</small></div>
      <Link href="/" className={styles.back}>← Терминал</Link>
    </header>

    <section className={styles.hero}>
      <div><span className={styles.eyebrow}>Не оптимизация прибыли</span><h1>Как стратегия видит сделку от уровня</h1><p>Каждый пример показывает один и тот же путь: старший контекст → рабочая зона → маршрут 4H → свежая реакция 5m → первое подтверждение 15m → структурные SL и TP.</p></div>
      <div className={styles.auditBadge}><b>4</b><span>golden cases</span><small>2 LONG · 2 SHORT<br/>2 TP · 2 SL</small></div>
    </section>

    <nav className={styles.caseTabs}>{CASES.map((item) => <button key={item.id} className={selectedId === item.id ? styles.caseActive : ""} onClick={() => setSelectedId(item.id)}><span>{item.side.toUpperCase()} · {item.outcome === "take_profit" ? "TP" : item.outcome === "stop_loss" ? "SL" : "TIME"}</span><b>{item.symbol}</b><small>{formatDate(item.entryTime)}</small></button>)}</nav>

    <section className={styles.summary}>
      <div className={styles.caseTitle}><span className={selected.side === "long" ? styles.long : styles.short}>{selected.side.toUpperCase()}</span><div><h2>{selected.title}</h2><p>{selected.note}</p></div></div>
      <div className={styles.metrics}>
        <div><span>Источник</span><b>{selected.zone}</b></div>
        <div><span>5m реакция</span><b>{selected.reaction}</b></div>
        <div><span>Результат</span><b className={selected.netR > 0 ? styles.win : styles.loss}>{selected.netR > 0 ? "+" : ""}{selected.netR.toFixed(2)}R</b></div>
        <div><span>Reproduce</span><b className={reproduced ? styles.win : styles.pending}>{loading ? "LOAD" : reproduced ? "PASS" : "CHECK"}</b></div>
      </div>
    </section>

    {loading && <div className={styles.loading}>Загружаю исторические Binance Futures свечи и воспроизвожу решение без будущих данных…</div>}
    {error && <div className={styles.error}>{error}</div>}

    {loaded && <>
      <section className={styles.tracePanel}>
        <div className={styles.contextCards}>
          <div><span>1W bias</span><b>{loaded.analysis.weeklyBias}</b></div>
          <div><span>1D bias</span><b>{loaded.analysis.dailyBias}</b></div>
          <div><span>Range</span><b>{loaded.analysis.range?.position ?? "—"}</b></div>
          <div><span>FROM</span><b>{loaded.analysis.activeZone?.label ?? selected.zone}</b></div>
          <div><span>TO</span><b>{loaded.analysis.targetZone?.label ?? formatPrice(selected.target)}</b></div>
          <div><span>4H route</span><b>{loaded.analysis.route4h.state}</b></div>
        </div>
        <div className={styles.trace}>{loaded.analysis.trace.map((step, index) => <div key={step.id} className={`${styles.traceStep} ${styles[step.state]}`}><i>{step.state === "pass" ? "✓" : step.state === "fail" ? "×" : index + 1}</i><div><b>{step.label}</b><small>{step.detail}</small></div></div>)}</div>
      </section>

      <section className={styles.grid}>
        <AuditChart title="1D — карта диапазона и старшая зона" timeframe="1d" candles={sliceAround(loaded.bundle["1d"], decisionTime, 100 * DAY, 0)} analysis={loaded.analysis} trade={selected} markerTime={decisionTime}/>
        <AuditChart title="4H — подход к выбранному FROM" timeframe="4h" candles={sliceAround(loaded.bundle["4h"], decisionTime, 30 * DAY, 0)} analysis={loaded.analysis} trade={selected} markerTime={decisionTime}/>
        <AuditChart title="5m — конкретная реакция внутри зоны" timeframe="5m" candles={sliceAround(loaded.bundle["5m"], decisionTime, 18 * HOUR, 0)} analysis={loaded.analysis} trade={selected} markerTime={decisionTime}/>
        <AuditChart title="15m — исполнение и фактический исход" timeframe="15m" candles={sliceAround(loaded.execution, decisionTime, 36 * HOUR, Math.max(DAY, exitTime - decisionTime + 6 * HOUR))} analysis={loaded.analysis} trade={selected} markerTime={decisionTime} showTrade/>
      </section>

      <section className={styles.planPanel}>
        <div><span>Entry</span><b>{formatPrice(selected.entry)}</b></div>
        <div><span>Stop</span><b className={styles.loss}>{formatPrice(selected.stop)}</b></div>
        <div><span>Target</span><b className={styles.win}>{formatPrice(selected.target)}</b></div>
        <div><span>Planned R:R</span><b>{(Math.abs(selected.target - selected.entry) / Math.abs(selected.entry - selected.stop)).toFixed(2)}</b></div>
        <div><span>Выход</span><b>{formatDate(selected.exitTime)} · {selected.outcome}</b></div>
      </section>
    </>}

    <footer className={styles.footer}>Golden cases включают победителей и проигравших. Цель страницы — проверить чтение структуры, причинность входа и отсутствие будущих данных, а не доказать устойчивую прибыльность.</footer>
  </main>;
}
