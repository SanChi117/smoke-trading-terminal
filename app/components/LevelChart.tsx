"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  Candle,
  MtfLevelAnalysis,
  PriceZone,
  StructureEvent,
  Timeframe,
} from "../lib/mtf-level-strategy";
import { ema, findPivots, wilderAtr } from "../lib/mtf-level-strategy";
import styles from "./WorkbenchTerminal.module.css";

type ChartNote = { id: string; time: number; price: number; text: string };
type LayerKey =
  | "ema20"
  | "ema50"
  | "atr"
  | "volume"
  | "zones1d"
  | "zones4h"
  | "orderBlocks"
  | "fvg"
  | "swingLevels"
  | "rangeLevels"
  | "bos"
  | "choch"
  | "swings"
  | "tradePlan"
  | "invalidated";
type Selection =
  | { kind: "zone"; zone: PriceZone }
  | { kind: "structure"; event: StructureEvent }
  | { kind: "trade" }
  | null;
type Props = {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  analysis: MtfLevelAnalysis | null;
  loading?: boolean;
};

const WIDTH = 1120;
const HEIGHT = 610;
const LEFT = 12;
const RIGHT = 82;
const TOP = 16;
const PRICE_BOTTOM = 470;
const VOLUME_TOP = 488;
const VOLUME_BOTTOM = 570;
const TIME_Y = 596;

function priceLabel(value: number) {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (value >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 7 });
}

function dateTimeLabel(time: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

function timeLabel(time: number, timeframe: Timeframe) {
  return new Intl.DateTimeFormat(
    "ru-RU",
    timeframe === "1w" || timeframe === "1d"
      ? { day: "2-digit", month: "short" }
      : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
  ).format(time);
}

function nearestIndex(candles: Candle[], time: number) {
  let best = 0;
  let distance = Infinity;
  for (let index = 0; index < candles.length; index += 1) {
    const current = Math.abs(candles[index].time - time);
    if (current < distance) {
      distance = current;
      best = index;
    }
  }
  return best;
}

function polyline(values: Array<number | null>, x: (index: number) => number, y: (value: number) => number) {
  return values
    .map((value, index) => (value === null ? "" : `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`))
    .filter(Boolean)
    .join(" ");
}

function modelLabel(analysis: MtfLevelAnalysis | null) {
  const model = analysis?.setupModel ?? "blocked";
  return `${model.toUpperCase()} MODEL`;
}

function zonePriority(zone: PriceZone, analysis: MtfLevelAnalysis | null) {
  if (analysis?.activeZone?.id === zone.id) return "ACTIVE FROM";
  if (analysis?.targetZone?.id === zone.id) return "TARGET";
  if (!zone.active) return "INVALIDATED";
  return "SECONDARY";
}

function zoneVisible(zone: PriceZone, layers: Record<LayerKey, boolean>) {
  if (zone.timeframe === "1d" && !layers.zones1d) return false;
  if (zone.timeframe === "4h" && !layers.zones4h) return false;
  if (!zone.active && !layers.invalidated) return false;
  if (zone.source === "order_block" && !layers.orderBlocks) return false;
  if (zone.source === "fvg" && !layers.fvg) return false;
  if (zone.source === "swing" && !layers.swingLevels) return false;
  if (zone.source === "range_level" && !layers.rangeLevels) return false;
  return true;
}

export default function LevelChart({ symbol, timeframe, candles, analysis, loading }: Props) {
  const [visibleCount, setVisibleCount] = useState(120);
  const [offset, setOffset] = useState(0);
  const [crosshair, setCrosshair] = useState<number | null>(null);
  const [priceScale, setPriceScale] = useState(1);
  const [selection, setSelection] = useState<Selection>(null);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    ema20: true,
    ema50: true,
    atr: false,
    volume: true,
    zones1d: true,
    zones4h: true,
    orderBlocks: true,
    fvg: false,
    swingLevels: true,
    rangeLevels: true,
    bos: true,
    choch: true,
    swings: true,
    tradePlan: true,
    invalidated: false,
  });
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const drag = useRef<{ x: number; y: number; offset: number; scale: number; moved: boolean } | null>(null);
  const noteKey = `smoke-chart-notes:${symbol}:${timeframe}`;

  useEffect(() => {
    try {
      setNotes(JSON.parse(localStorage.getItem(noteKey) ?? "[]") as ChartNote[]);
    } catch {
      setNotes([]);
    }
  }, [noteKey]);

  useEffect(() => {
    try {
      localStorage.setItem(noteKey, JSON.stringify(notes));
    } catch {}
  }, [noteKey, notes]);

  useEffect(() => {
    setOffset(0);
    setCrosshair(null);
    setSelection(null);
    setVisibleCount(timeframe === "1w" ? 90 : timeframe === "1d" ? 120 : 150);
  }, [symbol, timeframe]);

  const windowData = useMemo(() => {
    const count = Math.max(30, Math.min(360, visibleCount, candles.length || visibleCount));
    const maxOffset = Math.max(0, candles.length - count);
    const safeOffset = Math.max(0, Math.min(offset, maxOffset));
    const end = candles.length - safeOffset;
    const start = Math.max(0, end - count);
    return { visible: candles.slice(start, end), start, end, maxOffset };
  }, [candles, offset, visibleCount]);

  const chart = useMemo(() => {
    const { visible, start } = windowData;
    if (!visible.length) return null;
    const closes = candles.map((candle) => candle.close);
    const ema20All = ema(closes, 20);
    const ema50All = ema(closes, 50);
    const atrAll = wilderAtr(candles, 14);
    const ema20 = ema20All.slice(start, start + visible.length);
    const ema50 = ema50All.slice(start, start + visible.length);
    const atr = atrAll.slice(start, start + visible.length);
    const baseLow = Math.min(...visible.map((candle) => candle.low));
    const baseHigh = Math.max(...visible.map((candle) => candle.high));
    const baseSpan = Math.max(baseHigh - baseLow, baseHigh * 0.01);
    const relevantZones = (analysis?.zones ?? [])
      .filter((zone) => zoneVisible(zone, layers))
      .filter(
        (zone) =>
          (zone.high >= baseLow - baseSpan * 0.35 && zone.low <= baseHigh + baseSpan * 0.35) ||
          analysis?.activeZone?.id === zone.id ||
          analysis?.targetZone?.id === zone.id,
      )
      .sort((a, b) => {
        const weight = (zone: PriceZone) =>
          analysis?.activeZone?.id === zone.id ? 3 : analysis?.targetZone?.id === zone.id ? 2 : zone.active ? 1 : 0;
        return weight(b) - weight(a) || b.score - a.score;
      })
      .slice(0, 16);
    const priceValues = visible.flatMap((candle) => [candle.high, candle.low]);
    for (const zone of relevantZones) priceValues.push(zone.low, zone.high);
    if (layers.tradePlan && analysis) {
      for (const value of [analysis.entry, analysis.stop, analysis.target]) if (value !== null) priceValues.push(value);
    }
    if (layers.atr) {
      for (let index = 0; index < ema20.length; index += 1) priceValues.push(ema20[index] + atr[index], ema20[index] - atr[index]);
    }
    let low = Math.min(...priceValues);
    let high = Math.max(...priceValues);
    const center = (low + high) / 2;
    const half = (high - low) / 2 / priceScale;
    low = center - half;
    high = center + half;
    const plotWidth = WIDTH - LEFT - RIGHT;
    const x = (index: number) => LEFT + ((index + 0.5) / visible.length) * plotWidth;
    const y = (value: number) => TOP + ((high - value) / Math.max(high - low, 1e-9)) * (PRICE_BOTTOM - TOP);
    const candleWidth = Math.max(2, Math.min(13, (plotWidth / visible.length) * 0.66));
    const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1);
    return { visible, start, ema20, ema50, atr, relevantZones, low, high, x, y, candleWidth, maxVolume };
  }, [analysis, candles, layers, priceScale, windowData]);

  const toggle = (key: LayerKey) => setLayers((current) => ({ ...current, [key]: !current[key] }));

  const addNote = (index: number, price: number) => {
    if (!chart) return;
    const candle = chart.visible[Math.max(0, Math.min(index, chart.visible.length - 1))];
    const text = window.prompt("Заметка на графике:");
    if (!text?.trim()) return;
    setNotes((current) => [...current, { id: crypto.randomUUID(), time: candle.time, price, text: text.trim() }]);
  };

  const pointerToChart = (clientX: number, clientY: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * WIDTH, y: ((clientY - rect.top) / rect.height) * HEIGHT };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!chart) return;
    const point = pointerToChart(event.clientX, event.clientY, event.currentTarget);
    if (drag.current) {
      const dx = point.x - drag.current.x;
      const dy = point.y - drag.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.current.moved = true;
      const bars = Math.round(-dx / ((WIDTH - LEFT - RIGHT) / chart.visible.length));
      setOffset(Math.max(0, Math.min(windowData.maxOffset, drag.current.offset + bars)));
      setPriceScale(Math.max(0.55, Math.min(3.5, drag.current.scale * Math.exp(-dy / 240))));
      return;
    }
    const raw = ((point.x - LEFT) / (WIDTH - LEFT - RIGHT)) * chart.visible.length - 0.5;
    setCrosshair(Math.max(0, Math.min(chart.visible.length - 1, Math.round(raw))));
  };

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setVisibleCount((count) => Math.round(Math.max(30, Math.min(360, count * (event.deltaY > 0 ? 1.14 : 0.88)))));
  };

  const cursorCandle = chart && crosshair !== null ? chart.visible[crosshair] : chart?.visible.at(-1);
  const cursorX = chart && crosshair !== null ? chart.x(crosshair) : null;
  const cursorY = chart && crosshair !== null && cursorCandle ? chart.y(cursorCandle.close) : null;
  const pivots = chart && layers.swings ? findPivots(chart.visible, 3, 3) : [];
  const activeModel = modelLabel(analysis);
  const freshness = (zone: PriceZone) => Math.max(0, Math.floor((analysis?.evaluatedAt ?? Date.now()) - zone.originTime) / 86_400_000);

  return (
    <section className={styles.chartPanel}>
      <div className={styles.chartToolbar}>
        <div className={styles.indicatorGroup}>
          {([
            ["ema20", "EMA20"], ["ema50", "EMA50"], ["atr", "ATR"], ["volume", "Объём"],
            ["zones1d", "1D zones"], ["zones4h", "4H zones"], ["orderBlocks", "OB"], ["fvg", "FVG"],
            ["swingLevels", "Swing levels"], ["rangeLevels", "Range levels"], ["bos", "BOS"], ["choch", "CHoCH"],
            ["swings", "HH/HL"], ["tradePlan", "Trade plan"], ["invalidated", "Invalidated"],
          ] as Array<[LayerKey, string]>).map(([key, label]) => (
            <button key={key} className={layers[key] ? styles.activeTool : ""} onClick={() => toggle(key)}>{label}</button>
          ))}
        </div>
        <div className={styles.navigationGroup}>
          <button onClick={() => setVisibleCount((value) => Math.max(30, value - 24))}>＋</button>
          <button onClick={() => setVisibleCount((value) => Math.min(360, value + 24))}>−</button>
          <button onClick={() => { setOffset(0); setPriceScale(1); }}>К цене</button>
          <button onClick={() => { setVisibleCount(Math.min(360, candles.length)); setOffset(0); setPriceScale(1); }}>Весь график</button>
        </div>
      </div>

      <div className={styles.chartReadout}>
        <b>{symbol} · {timeframe}</b>
        {cursorCandle && <span>O {priceLabel(cursorCandle.open)} H {priceLabel(cursorCandle.high)} L {priceLabel(cursorCandle.low)} C {priceLabel(cursorCandle.close)} V {cursorCandle.volume.toFixed(0)}</span>}
        <small>Колесо — масштаб · drag — перемещение/цена · клик — инспектор · двойной клик — заметка</small>
      </div>

      <div className={styles.svgWrap}>
        {loading && <div className={styles.chartLoading}>Загрузка Binance Futures…</div>}
        {!chart ? <div className={styles.emptyChart}>Нет свечей</div> : (
          <svg
            className={styles.chartSvg}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            onWheel={onWheel}
            onPointerDown={(event) => {
              const point = pointerToChart(event.clientX, event.clientY, event.currentTarget);
              drag.current = { x: point.x, y: point.y, offset, scale: priceScale, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => {
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerLeave={() => { if (!drag.current) setCrosshair(null); }}
            onDoubleClick={(event) => {
              const point = pointerToChart(event.clientX, event.clientY, event.currentTarget);
              const index = Math.round(((point.x - LEFT) / (WIDTH - LEFT - RIGHT)) * chart.visible.length - 0.5);
              const price = chart.high - ((point.y - TOP) / (PRICE_BOTTOM - TOP)) * (chart.high - chart.low);
              addNote(index, price);
            }}
            role="img"
            aria-label={`Интерактивный график ${symbol} ${timeframe}`}
          >
            <rect x="0" y="0" width={WIDTH} height={HEIGHT} className={styles.chartBackground} />
            {Array.from({ length: 7 }, (_, index) => {
              const y = TOP + (index / 6) * (PRICE_BOTTOM - TOP);
              const price = chart.high - (index / 6) * (chart.high - chart.low);
              return <g key={`h-${index}`}><line x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} className={styles.gridLine} /><text x={WIDTH - RIGHT + 8} y={y + 3} className={styles.axisText}>{priceLabel(price)}</text></g>;
            })}
            {Array.from({ length: 8 }, (_, index) => {
              const x = LEFT + (index / 7) * (WIDTH - LEFT - RIGHT);
              return <line key={`v-${index}`} x1={x} y1={TOP} x2={x} y2={VOLUME_BOTTOM} className={styles.gridLine} />;
            })}

            {chart.relevantZones.map((zone) => {
              const top = chart.y(zone.high);
              const bottom = chart.y(zone.low);
              if (bottom < TOP || top > PRICE_BOTTOM) return null;
              const originGlobalIndex = nearestIndex(candles, zone.originTime);
              const originLocalIndex = originGlobalIndex - chart.start;
              const x1 = originLocalIndex <= 0 ? LEFT : chart.x(originLocalIndex);
              const x2 = WIDTH - RIGHT;
              const active = analysis?.activeZone?.id === zone.id;
              const target = analysis?.targetZone?.id === zone.id;
              const className = !zone.active ? styles.invalidatedZone : zone.kind === "demand" ? styles.demandZone : styles.supplyZone;
              return (
                <g key={zone.id} onClick={(event) => { event.stopPropagation(); setSelection({ kind: "zone", zone }); }} className={styles.clickableOverlay}>
                  <rect x={x1} y={top} width={Math.max(2, x2 - x1)} height={Math.max(2, bottom - top)} className={className} opacity={active ? 0.42 : target ? 0.30 : zone.active ? 0.16 : 0.10} />
                  <line x1={x1} y1={chart.y(zone.midpoint)} x2={x2} y2={chart.y(zone.midpoint)} className={styles.zoneMidpoint} />
                  <text x={x1 + 8} y={top + 13} className={active ? styles.activeZoneLabel : styles.zoneLabel}>{zonePriority(zone, analysis)} · {zone.label} · Q{zone.score}</text>
                </g>
              );
            })}

            {layers.atr && <><path d={polyline(chart.ema20.map((value, index) => value + chart.atr[index]), chart.x, chart.y)} className={styles.atrLine} /><path d={polyline(chart.ema20.map((value, index) => value - chart.atr[index]), chart.x, chart.y)} className={styles.atrLine} /></>}
            {layers.ema20 && <path d={polyline(chart.ema20, chart.x, chart.y)} className={styles.ema20Line} />}
            {layers.ema50 && <path d={polyline(chart.ema50, chart.x, chart.y)} className={styles.ema50Line} />}

            {chart.visible.map((candle, index) => {
              const x = chart.x(index);
              const up = candle.close >= candle.open;
              const top = chart.y(Math.max(candle.open, candle.close));
              const bottom = chart.y(Math.min(candle.open, candle.close));
              return <g key={candle.time} className={up ? styles.candleUp : styles.candleDown}><line x1={x} y1={chart.y(candle.high)} x2={x} y2={chart.y(candle.low)} /><rect x={x - chart.candleWidth / 2} y={top} width={chart.candleWidth} height={Math.max(1.5, bottom - top)} rx="0.8" /></g>;
            })}

            {layers.volume && chart.visible.map((candle, index) => {
              const height = (candle.volume / chart.maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
              return <rect key={`volume-${candle.time}`} x={chart.x(index) - chart.candleWidth / 2} y={VOLUME_BOTTOM - height} width={chart.candleWidth} height={height} className={candle.close >= candle.open ? styles.volumeUp : styles.volumeDown} />;
            })}

            {layers.swings && pivots.map((pivot) => <text key={`${pivot.time}-${pivot.kind}`} x={chart.x(pivot.index)} y={chart.y(pivot.price) + (pivot.kind === "high" ? -8 : 14)} className={pivot.kind === "high" ? styles.swingHigh : styles.swingLow}>{pivot.label}</text>)}

            {(analysis?.structure ?? []).map((event) => {
              if ((event.tag === "BOS" && !layers.bos) || (event.tag === "CHoCH" && !layers.choch)) return null;
              const local = nearestIndex(candles, event.time) - chart.start;
              if (local < 0 || local >= chart.visible.length) return null;
              const x = chart.x(local);
              const y = chart.y(event.price);
              return (
                <g key={`${event.time}-${event.tag}-${event.timeframe}`} onClick={(click) => { click.stopPropagation(); setSelection({ kind: "structure", event }); }} className={styles.clickableOverlay}>
                  <line x1={Math.max(LEFT, x - 44)} y1={y} x2={x + 6} y2={y} className={event.side === "long" ? styles.bullStructure : styles.bearStructure} />
                  <text x={x - 20} y={y - 5} className={event.side === "long" ? styles.bullText : styles.bearText}>{event.timeframe} {event.tag}</text>
                </g>
              );
            })}

            {layers.tradePlan && analysis && (
              <g onClick={(event) => { event.stopPropagation(); setSelection({ kind: "trade" }); }} className={styles.clickableOverlay}>
                {([[analysis.entry, "ENTRY", styles.entryLine], [analysis.stop, "SL", styles.stopLine], [analysis.target, "TP", styles.targetLine]] as Array<[number | null, string, string]>).map(([value, label, className]) => value === null ? null : <g key={label}><line x1={LEFT} y1={chart.y(value)} x2={WIDTH - RIGHT} y2={chart.y(value)} className={className} /><text x={WIDTH - RIGHT - 30} y={chart.y(value) - 4} className={styles.tradeLabel}>{label}</text></g>)}
                <g transform={`translate(${Math.max(LEFT + 8, WIDTH - RIGHT - 164)},${TOP + 12})`}>
                  <rect width="156" height="27" rx="6" className={analysis.setupModel === "blocked" ? styles.modelBadgeBlocked : styles.modelBadge} />
                  <text x="78" y="18" textAnchor="middle" className={styles.modelBadgeText}>{activeModel}</text>
                </g>
              </g>
            )}

            {notes.map((note) => {
              const local = nearestIndex(candles, note.time) - chart.start;
              if (local < 0 || local >= chart.visible.length) return null;
              const x = chart.x(local);
              const y = chart.y(note.price);
              return <g key={note.id} onDoubleClick={(event) => { event.stopPropagation(); setNotes((current) => current.filter((item) => item.id !== note.id)); }}><circle cx={x} cy={y} r="8" className={styles.noteDot} /><text x={x + 12} y={y - 9} className={styles.noteText}>{note.text}</text></g>;
            })}

            {cursorX !== null && cursorY !== null && <g pointerEvents="none"><line x1={cursorX} y1={TOP} x2={cursorX} y2={VOLUME_BOTTOM} className={styles.crosshair} /><line x1={LEFT} y1={cursorY} x2={WIDTH - RIGHT} y2={cursorY} className={styles.crosshair} /><text x={WIDTH - RIGHT + 6} y={cursorY + 4} className={styles.cursorText}>{cursorCandle ? priceLabel(cursorCandle.close) : ""}</text></g>}
            {Array.from({ length: 6 }, (_, index) => {
              const local = Math.round((index / 5) * (chart.visible.length - 1));
              const candle = chart.visible[local];
              return <text key={`time-${index}`} x={chart.x(local)} y={TIME_Y} textAnchor="middle" className={styles.axisText}>{timeLabel(candle.time, timeframe)}</text>;
            })}
          </svg>
        )}
      </div>

      {selection && analysis && (
        <div className={styles.chartInspector}>
          <div className={styles.inspectorHeader}><b>{selection.kind === "zone" ? "ZONE INSPECTOR" : selection.kind === "structure" ? "STRUCTURE EVENT" : "FULL TRADE AUDIT"}</b><button onClick={() => setSelection(null)}>×</button></div>
          {selection.kind === "zone" && (
            <div className={styles.inspectorGrid}>
              <span>Timeframe<b>{selection.zone.timeframe}</b></span><span>Source<b>{selection.zone.source}</b></span>
              <span>Side<b>{selection.zone.kind}</b></span><span>Priority<b>{zonePriority(selection.zone, analysis)}</b></span>
              <span>Low / High<b>{priceLabel(selection.zone.low)} / {priceLabel(selection.zone.high)}</b></span><span>Midpoint<b>{priceLabel(selection.zone.midpoint)}</b></span>
              <span>Score / touches<b>{selection.zone.score} / {selection.zone.touches}</b></span><span>Freshness<b>{freshness(selection.zone)} days</b></span>
              <span>Origin time<b>{dateTimeLabel(selection.zone.originTime)}</b></span><span>Invalidation level<b>{selection.zone.kind === "demand" ? priceLabel(selection.zone.low) : priceLabel(selection.zone.high)}</b></span>
              <span className={styles.inspectorWide}>Причина выбора<b>{analysis.activeZone?.id === selection.zone.id ? analysis.trace.find((step) => step.id === "level")?.detail ?? analysis.reason : "Зона не выбрана как FROM: ниже приоритет, качество или несоответствие направлению текущего плана."}</b></span>
              <span className={styles.inspectorWide}>Почему другие зоны не выбраны<b>Приоритет получает совместимая с направлением активная 1D/4H зона с лучшим score, свежестью и меньшим числом касаний; остальные остаются secondary или target.</b></span>
            </div>
          )}
          {selection.kind === "structure" && (
            <div className={styles.inspectorGrid}>
              <span>Timeframe<b>{selection.event.timeframe}</b></span><span>Event<b>{selection.event.tag}</b></span>
              <span>Direction<b>{selection.event.side.toUpperCase()}</b></span><span>Break price<b>{priceLabel(selection.event.price)}</b></span>
              <span>Broken pivot time<b>{dateTimeLabel(selection.event.pivotTime)}</b></span><span>Confirmation time<b>{dateTimeLabel(selection.event.time)}</b></span>
              <span className={styles.inspectorWide}>Scope<b>{selection.event.timeframe === "1w" || selection.event.timeframe === "1d" ? "EXTERNAL HTF STRUCTURE" : "INTERNAL / EXECUTION STRUCTURE"}</b></span>
            </div>
          )}
          {selection.kind === "trade" && (
            <div className={styles.inspectorGrid}>
              <span>1W bias<b>{analysis.weeklyBias}</b></span><span>1D bias<b>{analysis.dailyBias}</b></span>
              <span>Range position<b>{analysis.range?.position ?? "n/a"}</b></span><span>FROM level<b>{analysis.activeZone?.label ?? "none"}</b></span>
              <span>4H route<b>{analysis.route4h.state}</b></span><span>5m reaction<b>{analysis.reaction.type}</b></span>
              <span>15m confirmation<b>{analysis.trace.find((step) => step.id === "entry")?.state ?? "pending"}</b></span><span>Setup model<b>{activeModel}</b></span>
              <span>Entry<b>{analysis.entry === null ? "—" : priceLabel(analysis.entry)}</b></span><span>Stop<b>{analysis.stop === null ? "—" : priceLabel(analysis.stop)}</b></span>
              <span>Target<b>{analysis.target === null ? "—" : priceLabel(analysis.target)}</b></span><span>R:R<b>{analysis.rr === null ? "—" : analysis.rr.toFixed(2)}</b></span>
              <span className={styles.inspectorWide}>Blockers<b>{analysis.blockers.length ? analysis.blockers.join(" · ") : "none"}</b></span>
              <span className={styles.inspectorWide}>Exit management<b>Structural management: SL → target structural level → protect profit → confirmed 4H invalidation.</b></span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
