"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  ema,
  findPivots,
  wilderAtr,
  type Candle,
  type MtfLevelAnalysis,
  type PriceZone,
  type Timeframe,
} from "../lib/mtf-level-strategy";
import type { JournalEvent } from "./terminal-data";
import { formatPrice, modelLabel } from "./terminal-data";
import { activeFvgs, anchoredVwap, bollinger, linePath, nearestIndex, rsi } from "./chart-math";
import styles from "./TradingTerminal.module.css";

type DrawingTool = "cursor" | "crosshair" | "horizontal" | "trend" | "rectangle" | "note" | "eraser";
type IndicatorKey =
  | "ema20"
  | "ema50"
  | "ema200"
  | "vwap"
  | "bollinger"
  | "atr"
  | "volume"
  | "rsi"
  | "zones"
  | "structure"
  | "swings"
  | "fvg"
  | "range"
  | "route"
  | "reaction"
  | "trade"
  | "events";

type ChartPoint = { time: number; price: number };
type Drawing = {
  id: string;
  kind: "horizontal" | "trend" | "rectangle" | "note";
  p1: ChartPoint;
  p2?: ChartPoint;
  text?: string;
  createdAt: number;
};

type Props = {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  analysis: MtfLevelAnalysis | null;
  events: JournalEvent[];
  loading?: boolean;
};

const WIDTH = 1200;
const HEIGHT = 720;
const LEFT = 54;
const RIGHT = 88;
const TOP = 18;
const PRICE_BOTTOM = 500;
const VOLUME_TOP = 516;
const VOLUME_BOTTOM = 582;
const RSI_TOP = 604;
const RSI_BOTTOM = 674;
const TIME_Y = 706;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;

function timeLabel(time: number, timeframe: Timeframe): string {
  return new Intl.DateTimeFormat("ru-RU", timeframe === "1w" || timeframe === "1d"
    ? { day: "2-digit", month: "short", year: "2-digit" }
    : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(time);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export default function ProChart({ symbol, timeframe, candles, analysis, events, loading }: Props) {
  const [visibleCount, setVisibleCount] = useState(150);
  const [offset, setOffset] = useState(0);
  const [priceScale, setPriceScale] = useState(1);
  const [crosshair, setCrosshair] = useState<number | null>(null);
  const [tool, setTool] = useState<DrawingTool>("cursor");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<{ event: JournalEvent; x: number; y: number } | null>(null);
  const [indicators, setIndicators] = useState<Record<IndicatorKey, boolean>>({
    ema20: true,
    ema50: true,
    ema200: false,
    vwap: false,
    bollinger: false,
    atr: false,
    volume: true,
    rsi: true,
    zones: true,
    structure: true,
    swings: true,
    fvg: true,
    range: true,
    route: true,
    reaction: true,
    trade: true,
    events: true,
  });
  const drag = useRef<{ x: number; y: number; offset: number; scale: number; moved: boolean } | null>(null);
  const storageKey = `smoke-pro-chart:${symbol}:${timeframe}`;

  useEffect(() => {
    try {
      setDrawings(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Drawing[]);
    } catch {
      setDrawings([]);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(drawings));
    } catch {
      // Local persistence is best effort.
    }
  }, [drawings, storageKey]);

  useEffect(() => {
    setOffset(0);
    setPriceScale(1);
    setCrosshair(null);
    setVisibleCount(timeframe === "1w" ? 90 : timeframe === "1d" ? 120 : 150);
  }, [symbol, timeframe]);

  const windowData = useMemo(() => {
    const count = Math.max(30, Math.min(420, visibleCount, candles.length || visibleCount));
    const maxOffset = Math.max(0, candles.length - count);
    const safeOffset = clamp(offset, 0, maxOffset);
    const end = candles.length - safeOffset;
    const start = Math.max(0, end - count);
    return { visible: candles.slice(start, end), start, end, count, maxOffset };
  }, [candles, offset, visibleCount]);

  const chart = useMemo(() => {
    const { visible, start } = windowData;
    if (!visible.length) return null;
    const closes = candles.map((candle) => candle.close);
    const ema20All = ema(closes, 20);
    const ema50All = ema(closes, 50);
    const ema200All = ema(closes, 200);
    const atrAll = wilderAtr(candles, 14);
    const vwapAll = anchoredVwap(candles);
    const bandsAll = bollinger(closes, 20, 2);
    const rsiAll = rsi(closes, 14);
    const slice = <T,>(rows: T[]) => rows.slice(start, start + visible.length);
    const ema20 = slice(ema20All);
    const ema50 = slice(ema50All);
    const ema200 = slice(ema200All);
    const atr14 = slice(atrAll);
    const vwap = slice(vwapAll);
    const bandUpper = slice(bandsAll.upper);
    const bandMiddle = slice(bandsAll.middle);
    const bandLower = slice(bandsAll.lower);
    const rsi14 = slice(rsiAll);

    const baseLow = Math.min(...visible.map((candle) => candle.low));
    const baseHigh = Math.max(...visible.map((candle) => candle.high));
    const baseSpan = Math.max(baseHigh - baseLow, baseHigh * 0.004);
    const relevantZones = (analysis?.zones ?? [])
      .filter((zone) => zone.active)
      .filter((zone) => zone.high >= baseLow - baseSpan * 0.4 && zone.low <= baseHigh + baseSpan * 0.4)
      .sort((a, b) => Number(analysis?.activeZone?.id === b.id) - Number(analysis?.activeZone?.id === a.id) || b.score - a.score)
      .slice(0, 12);

    const values = visible.flatMap((candle) => [candle.high, candle.low]);
    if (indicators.zones) relevantZones.forEach((zone) => values.push(zone.low, zone.high));
    if (indicators.range && analysis?.range) values.push(analysis.range.low, analysis.range.high);
    if (indicators.trade && analysis?.state === "ready") {
      [analysis.entry, analysis.stop, analysis.target].forEach((value) => {
        if (value !== null) values.push(value);
      });
    }
    drawings.forEach((drawing) => {
      values.push(drawing.p1.price);
      if (drawing.p2) values.push(drawing.p2.price);
    });
    let low = Math.min(...values);
    let high = Math.max(...values);
    const center = (low + high) / 2;
    const half = Math.max((high - low) / 2 / priceScale, center * 0.001);
    low = center - half;
    high = center + half;
    const x = (index: number) => LEFT + (index + 0.5) / visible.length * PLOT_WIDTH;
    const y = (price: number) => TOP + (high - price) / Math.max(high - low, 1e-9) * (PRICE_BOTTOM - TOP);
    const indexForTime = (time: number) => nearestIndex(visible, time);
    const candleWidth = Math.max(2, Math.min(14, PLOT_WIDTH / visible.length * 0.68));
    const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1);
    return {
      visible,
      start,
      low,
      high,
      x,
      y,
      indexForTime,
      candleWidth,
      maxVolume,
      ema20,
      ema50,
      ema200,
      atr14,
      vwap,
      bandUpper,
      bandMiddle,
      bandLower,
      rsi14,
      relevantZones,
    };
  }, [analysis, candles, drawings, indicators.range, indicators.trade, indicators.zones, priceScale, windowData]);

  const gaps = useMemo(() => activeFvgs(candles), [candles]);
  const pivots = useMemo(() => chart && indicators.swings ? findPivots(chart.visible, 3, 3) : [], [chart, indicators.swings]);
  const currentCandle = chart && crosshair !== null ? chart.visible[crosshair] : chart?.visible.at(-1);
  const currentIndex = chart && crosshair !== null ? crosshair : chart ? chart.visible.length - 1 : null;
  const currentX = chart && currentIndex !== null ? chart.x(currentIndex) : null;
  const currentY = chart && currentCandle ? chart.y(currentCandle.close) : null;

  const pointerToChart = (clientX: number, clientY: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * WIDTH,
      y: (clientY - rect.top) / rect.height * HEIGHT,
    };
  };

  const pointFromPixels = (xPixel: number, yPixel: number): ChartPoint | null => {
    if (!chart) return null;
    const index = clamp(Math.round((xPixel - LEFT) / PLOT_WIDTH * chart.visible.length - 0.5), 0, chart.visible.length - 1);
    const price = chart.high - (yPixel - TOP) / (PRICE_BOTTOM - TOP) * (chart.high - chart.low);
    return { time: chart.visible[index].time, price };
  };

  const drawingPixels = (drawing: Drawing) => {
    if (!chart) return null;
    const firstIndex = chart.indexForTime(drawing.p1.time);
    const secondIndex = drawing.p2 ? chart.indexForTime(drawing.p2.time) : firstIndex;
    return {
      x1: chart.x(firstIndex),
      y1: chart.y(drawing.p1.price),
      x2: chart.x(secondIndex),
      y2: chart.y(drawing.p2?.price ?? drawing.p1.price),
    };
  };

  const eraseAt = (xPixel: number, yPixel: number) => {
    if (!chart) return;
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    drawings.forEach((drawing) => {
      const pixels = drawingPixels(drawing);
      if (!pixels) return;
      let distance = Number.POSITIVE_INFINITY;
      if (drawing.kind === "horizontal") distance = Math.abs(yPixel - pixels.y1);
      if (drawing.kind === "trend") distance = distanceToSegment(xPixel, yPixel, pixels.x1, pixels.y1, pixels.x2, pixels.y2);
      if (drawing.kind === "rectangle") {
        const left = Math.min(pixels.x1, pixels.x2);
        const right = Math.max(pixels.x1, pixels.x2);
        const top = Math.min(pixels.y1, pixels.y2);
        const bottom = Math.max(pixels.y1, pixels.y2);
        distance = xPixel >= left && xPixel <= right && yPixel >= top && yPixel <= bottom ? 0 : Math.min(
          Math.abs(xPixel - left),
          Math.abs(xPixel - right),
          Math.abs(yPixel - top),
          Math.abs(yPixel - bottom),
        );
      }
      if (drawing.kind === "note") distance = Math.hypot(xPixel - pixels.x1, yPixel - pixels.y1);
      if (distance < bestDistance) {
        bestId = drawing.id;
        bestDistance = distance;
      }
    });
    if (bestId && bestDistance <= 18) {
      setDrawings((current) => current.filter((drawing) => drawing.id !== bestId));
    }
  };

  const addImmediateDrawing = (kind: "horizontal" | "note", point: ChartPoint) => {
    const text = kind === "note" ? window.prompt("Текст заметки:")?.trim() : window.prompt("Название уровня:", "Уровень")?.trim();
    if (kind === "note" && !text) return;
    setDrawings((current) => [...current, {
      id: crypto.randomUUID(),
      kind,
      p1: point,
      text: text || "Уровень",
      createdAt: Date.now(),
    }]);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!chart) return;
    const pixels = pointerToChart(event.clientX, event.clientY, event.currentTarget);
    const point = pointFromPixels(pixels.x, pixels.y);
    if (!point) return;
    if (tool === "horizontal" || tool === "note") {
      addImmediateDrawing(tool, point);
      return;
    }
    if (tool === "eraser") {
      eraseAt(pixels.x, pixels.y);
      return;
    }
    if (tool === "trend" || tool === "rectangle") {
      setDraft({ id: crypto.randomUUID(), kind: tool, p1: point, p2: point, createdAt: Date.now() });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    drag.current = { x: pixels.x, y: pixels.y, offset, scale: priceScale, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!chart) return;
    const pixels = pointerToChart(event.clientX, event.clientY, event.currentTarget);
    const rawIndex = clamp(Math.round((pixels.x - LEFT) / PLOT_WIDTH * chart.visible.length - 0.5), 0, chart.visible.length - 1);
    setCrosshair(rawIndex);
    if (draft) {
      const point = pointFromPixels(pixels.x, pixels.y);
      if (point) setDraft((current) => current ? { ...current, p2: point } : current);
      return;
    }
    if (!drag.current) return;
    const dx = pixels.x - drag.current.x;
    const dy = pixels.y - drag.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.current.moved = true;
    const bars = Math.round(-dx / (PLOT_WIDTH / chart.visible.length));
    setOffset(clamp(drag.current.offset + bars, 0, windowData.maxOffset));
    setPriceScale(clamp(drag.current.scale * Math.exp(-dy / 260), 0.55, 4.5));
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (draft?.p2) setDrawings((current) => [...current, draft]);
    setDraft(null);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (!chart) return;
    if (event.shiftKey) {
      setPriceScale((scale) => clamp(scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.55, 4.5));
      return;
    }
    const pixels = pointerToChart(event.clientX, event.clientY, event.currentTarget);
    const ratio = clamp((pixels.x - LEFT) / PLOT_WIDTH, 0, 1);
    const anchorGlobal = chart.start + ratio * chart.visible.length;
    const nextCount = Math.round(clamp(visibleCount * (event.deltaY > 0 ? 1.14 : 0.88), 30, 420));
    const nextEnd = anchorGlobal + (1 - ratio) * nextCount;
    const nextOffset = clamp(Math.round(candles.length - nextEnd), 0, Math.max(0, candles.length - nextCount));
    setVisibleCount(nextCount);
    setOffset(nextOffset);
  };

  const drawingRows = draft ? [...drawings, draft] : drawings;
  const activeReaction = Boolean(
    analysis?.reaction.confirmed
    && analysis.reaction.time
    && analysis.evaluatedAt - analysis.reaction.time <= 8 * 60 * 60_000,
  );
  const activeStructure = (analysis?.structure ?? []).slice(-16);
  const selectedEvents = events.filter((event) => event.symbol === symbol).slice(-80);

  return <section className={styles.proChartPanel}>
    <div className={styles.chartToolbars}>
      <div className={styles.drawingTools}>
        {([
          ["cursor", "↖", "Курсор / перемещение"],
          ["crosshair", "＋", "Перекрестие"],
          ["horizontal", "━", "Горизонтальный уровень"],
          ["trend", "╱", "Трендовая линия"],
          ["rectangle", "▭", "Зона"],
          ["note", "T", "Заметка"],
          ["eraser", "⌫", "Удалить объект"],
        ] as Array<[DrawingTool, string, string]>).map(([key, icon, label]) => <button
          key={key}
          title={label}
          className={tool === key ? styles.activeTool : ""}
          onClick={() => setTool(key)}
        >{icon}</button>)}
        <span className={styles.toolDivider} />
        <button title="Отменить последний объект" onClick={() => setDrawings((current) => current.slice(0, -1))}>↶</button>
        <button title="Очистить пользовательские объекты" onClick={() => window.confirm("Удалить все заметки и уровни на этом графике?") && setDrawings([])}>⌧</button>
      </div>
      <div className={styles.indicatorTools}>
        {([
          ["ema20", "EMA20"], ["ema50", "EMA50"], ["ema200", "EMA200"], ["vwap", "VWAP"],
          ["bollinger", "BB"], ["atr", "ATR"], ["volume", "VOL"], ["rsi", "RSI"],
          ["zones", "POI"], ["structure", "BOS/CHoCH"], ["swings", "HH/HL"], ["fvg", "FVG"],
          ["range", "HTF RANGE"], ["route", "4H ROUTE"], ["reaction", "5m REACTION"],
          ["trade", "ENTRY/SL/TP"], ["events", "SETUPS"],
        ] as Array<[IndicatorKey, string]>).map(([key, label]) => <button
          key={key}
          className={indicators[key] ? styles.activeIndicator : ""}
          onClick={() => setIndicators((current) => ({ ...current, [key]: !current[key] }))}
        >{label}</button>)}
      </div>
      <div className={styles.chartNavigation}>
        <button onClick={() => setVisibleCount((count) => clamp(count - 24, 30, 420))}>＋</button>
        <button onClick={() => setVisibleCount((count) => clamp(count + 24, 30, 420))}>−</button>
        <button onClick={() => { setOffset(0); setPriceScale(1); }}>К цене</button>
        <button onClick={() => { setVisibleCount(Math.min(420, candles.length || 150)); setOffset(0); setPriceScale(1); }}>Fit</button>
      </div>
    </div>

    <div className={styles.chartReadout}>
      <b>{symbol} · {timeframe}</b>
      {currentCandle && <span>O {formatPrice(currentCandle.open)} H {formatPrice(currentCandle.high)} L {formatPrice(currentCandle.low)} C {formatPrice(currentCandle.close)} V {currentCandle.volume.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>}
      <small>Колесо: масштаб · Shift+колесо: цена · drag: перемещение · инструменты слева сохраняются локально</small>
    </div>

    <div className={styles.chartViewport}>
      {loading && <div className={styles.chartLoading}>Загрузка Binance Futures…</div>}
      {!chart ? <div className={styles.emptyChart}>Нет свечей</div> : <svg
        className={styles.proChartSvg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { if (!drag.current && !draft) setCrosshair(null); }}
        onWheel={onWheel}
        role="img"
        aria-label={`Интерактивный график ${symbol} ${timeframe}`}
      >
        <rect width={WIDTH} height={HEIGHT} className={styles.chartBackground} />
        {Array.from({ length: 8 }, (_, index) => {
          const y = TOP + index / 7 * (PRICE_BOTTOM - TOP);
          const price = chart.high - index / 7 * (chart.high - chart.low);
          return <g key={`price-grid-${index}`}>
            <line x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} className={styles.gridLine} />
            <text x={WIDTH - RIGHT + 9} y={y + 4} className={styles.axisText}>{formatPrice(price)}</text>
          </g>;
        })}
        {Array.from({ length: 9 }, (_, index) => {
          const x = LEFT + index / 8 * PLOT_WIDTH;
          const candle = chart.visible[Math.min(chart.visible.length - 1, Math.round(index / 8 * (chart.visible.length - 1)))];
          return <g key={`time-grid-${index}`}>
            <line x1={x} y1={TOP} x2={x} y2={RSI_BOTTOM} className={styles.gridLine} />
            {candle && <text x={x} y={TIME_Y} textAnchor="middle" className={styles.axisText}>{timeLabel(candle.time, timeframe)}</text>}
          </g>;
        })}

        {indicators.range && analysis?.range && <g>
          {([
            [analysis.range.high, "HTF HIGH", styles.rangeBoundary],
            [analysis.range.equilibrium, "EQ 50%", styles.equilibriumLine],
            [analysis.range.low, "HTF LOW", styles.rangeBoundary],
          ] as Array<[number, string, string]>).map(([value, label, className]) => <g key={label}>
            <line x1={LEFT} y1={chart.y(value)} x2={WIDTH - RIGHT} y2={chart.y(value)} className={className} />
            <text x={LEFT + 8} y={chart.y(value) - 5} className={styles.rangeLabel}>{label}</text>
          </g>)}
        </g>}

        {indicators.zones && chart.relevantZones.map((zone: PriceZone) => {
          const top = chart.y(zone.high);
          const bottom = chart.y(zone.low);
          const active = analysis?.activeZone?.id === zone.id;
          const target = analysis?.targetZone?.id === zone.id;
          return <g key={zone.id}>
            <rect
              x={LEFT}
              y={Math.min(top, bottom)}
              width={PLOT_WIDTH}
              height={Math.max(2, Math.abs(bottom - top))}
              className={zone.kind === "demand" ? styles.demandZone : styles.supplyZone}
              opacity={active ? 0.38 : target ? 0.25 : 0.14}
            />
            <text x={LEFT + 9} y={Math.min(top, bottom) + 14} className={active ? styles.activeZoneLabel : styles.zoneLabel}>
              {active ? "FROM · " : target ? "TO · " : ""}{zone.label} · {zone.source} · Q{zone.score} · touches {zone.touches}
            </text>
          </g>;
        })}

        {indicators.fvg && gaps.map((gap) => {
          const local = nearestIndex(candles, gap.startTime) - chart.start;
          if (local < 0 || local >= chart.visible.length) return null;
          return <rect
            key={gap.id}
            x={chart.x(local)}
            y={chart.y(gap.high)}
            width={WIDTH - RIGHT - chart.x(local)}
            height={Math.max(2, chart.y(gap.low) - chart.y(gap.high))}
            className={gap.kind === "bull" ? styles.bullFvg : styles.bearFvg}
          />;
        })}

        {indicators.bollinger && <g>
          <path d={linePath(chart.bandUpper, chart.x, chart.y)} className={styles.bollingerLine} />
          <path d={linePath(chart.bandMiddle, chart.x, chart.y)} className={styles.bollingerMid} />
          <path d={linePath(chart.bandLower, chart.x, chart.y)} className={styles.bollingerLine} />
        </g>}
        {indicators.atr && <g>
          <path d={linePath(chart.ema20.map((value, index) => value + chart.atr14[index]), chart.x, chart.y)} className={styles.atrLine} />
          <path d={linePath(chart.ema20.map((value, index) => value - chart.atr14[index]), chart.x, chart.y)} className={styles.atrLine} />
        </g>}
        {indicators.ema20 && <path d={linePath(chart.ema20, chart.x, chart.y)} className={styles.ema20Line} />}
        {indicators.ema50 && <path d={linePath(chart.ema50, chart.x, chart.y)} className={styles.ema50Line} />}
        {indicators.ema200 && <path d={linePath(chart.ema200, chart.x, chart.y)} className={styles.ema200Line} />}
        {indicators.vwap && <path d={linePath(chart.vwap, chart.x, chart.y)} className={styles.vwapLine} />}

        {chart.visible.map((candle, index) => {
          const x = chart.x(index);
          const up = candle.close >= candle.open;
          const top = chart.y(Math.max(candle.open, candle.close));
          const bottom = chart.y(Math.min(candle.open, candle.close));
          return <g key={candle.time} className={up ? styles.candleUp : styles.candleDown}>
            <line x1={x} y1={chart.y(candle.high)} x2={x} y2={chart.y(candle.low)} />
            <rect x={x - chart.candleWidth / 2} y={top} width={chart.candleWidth} height={Math.max(1.5, bottom - top)} rx="0.7" />
          </g>;
        })}

        {indicators.volume && chart.visible.map((candle, index) => {
          const height = candle.volume / chart.maxVolume * (VOLUME_BOTTOM - VOLUME_TOP);
          return <rect
            key={`vol-${candle.time}`}
            x={chart.x(index) - chart.candleWidth / 2}
            y={VOLUME_BOTTOM - height}
            width={chart.candleWidth}
            height={height}
            className={candle.close >= candle.open ? styles.volumeUp : styles.volumeDown}
          />;
        })}

        {indicators.rsi && <g>
          <line x1={LEFT} y1={RSI_TOP} x2={WIDTH - RIGHT} y2={RSI_TOP} className={styles.paneBorder} />
          {[30, 50, 70].map((value) => {
            const y = RSI_TOP + (100 - value) / 100 * (RSI_BOTTOM - RSI_TOP);
            return <g key={`rsi-${value}`}>
              <line x1={LEFT} y1={y} x2={WIDTH - RIGHT} y2={y} className={value === 50 ? styles.rsiMid : styles.rsiLevel} />
              <text x={WIDTH - RIGHT + 9} y={y + 3} className={styles.axisText}>{value}</text>
            </g>;
          })}
          <path
            d={linePath(chart.rsi14, chart.x, (value) => RSI_TOP + (100 - value) / 100 * (RSI_BOTTOM - RSI_TOP))}
            className={styles.rsiLine}
          />
          <text x={LEFT + 6} y={RSI_TOP + 12} className={styles.paneLabel}>RSI 14</text>
        </g>}

        {indicators.swings && pivots.map((pivot) => <text
          key={`${pivot.time}-${pivot.kind}`}
          x={chart.x(pivot.index)}
          y={chart.y(pivot.price) + (pivot.kind === "high" ? -9 : 16)}
          className={pivot.kind === "high" ? styles.swingHigh : styles.swingLow}
          textAnchor="middle"
        >{pivot.label}</text>)}

        {indicators.structure && activeStructure.map((event) => {
          const local = nearestIndex(candles, event.time) - chart.start;
          if (local < 0 || local >= chart.visible.length) return null;
          const x = chart.x(local);
          const y = chart.y(event.price);
          return <g key={`${event.time}-${event.tag}-${event.timeframe}`}>
            <line x1={Math.max(LEFT, x - 58)} y1={y} x2={x + 7} y2={y} className={event.side === "long" ? styles.bullStructure : styles.bearStructure} />
            <text x={x - 26} y={y - 5} textAnchor="middle" className={event.side === "long" ? styles.bullText : styles.bearText}>{event.timeframe} {event.tag}</text>
          </g>;
        })}

        {indicators.route && analysis?.activeZone && chart.visible.length > 0 && <g>
          <line
            x1={chart.x(chart.visible.length - 1)}
            y1={chart.y(chart.visible.at(-1)!.close)}
            x2={chart.x(Math.max(0, chart.visible.length - 10))}
            y2={chart.y(analysis.activeZone.midpoint)}
            className={styles.routeLine}
          />
          <text x={chart.x(Math.max(0, chart.visible.length - 11))} y={chart.y(analysis.activeZone.midpoint) - 6} className={styles.routeLabel}>
            4H {analysis.route4h.state} · {analysis.route4h.distanceAtr?.toFixed(2) ?? "—"} ATR
          </text>
        </g>}

        {indicators.reaction && activeReaction && analysis?.reaction.time && analysis.reaction.triggerPrice !== null && (() => {
          const local = nearestIndex(candles, analysis.reaction.time) - chart.start;
          if (local < 0 || local >= chart.visible.length) return null;
          const x = chart.x(local);
          const y = chart.y(analysis.reaction.triggerPrice);
          return <g>
            <circle cx={x} cy={y} r="7" className={styles.reactionDot} />
            <text x={x + 11} y={y - 9} className={styles.reactionLabel}>5m {analysis.reaction.type} · {analysis.reaction.score}</text>
          </g>;
        })()}

        {indicators.trade && analysis?.state === "ready" && ([
          [analysis.entry, "ENTRY", styles.entryLine],
          [analysis.stop, "SL", styles.stopLine],
          [analysis.target, "TP", styles.targetLine],
        ] as Array<[number | null, string, string]>).map(([value, label, className]) => value === null ? null : <g key={label}>
          <line x1={LEFT} y1={chart.y(value)} x2={WIDTH - RIGHT} y2={chart.y(value)} className={className} />
          <text x={WIDTH - RIGHT - 4} y={chart.y(value) - 5} textAnchor="end" className={styles.tradeLabel}>{label} · {formatPrice(value)}</text>
        </g>)}

        {drawingRows.map((drawing) => {
          const pixels = drawingPixels(drawing);
          if (!pixels) return null;
          if (drawing.kind === "horizontal") return <g key={drawing.id}>
            <line x1={LEFT} y1={pixels.y1} x2={WIDTH - RIGHT} y2={pixels.y1} className={styles.userLevel} />
            <text x={LEFT + 8} y={pixels.y1 - 5} className={styles.userDrawingLabel}>{drawing.text} · {formatPrice(drawing.p1.price)}</text>
          </g>;
          if (drawing.kind === "trend") return <line key={drawing.id} x1={pixels.x1} y1={pixels.y1} x2={pixels.x2} y2={pixels.y2} className={styles.userTrend} />;
          if (drawing.kind === "rectangle") return <rect
            key={drawing.id}
            x={Math.min(pixels.x1, pixels.x2)}
            y={Math.min(pixels.y1, pixels.y2)}
            width={Math.max(2, Math.abs(pixels.x2 - pixels.x1))}
            height={Math.max(2, Math.abs(pixels.y2 - pixels.y1))}
            className={styles.userRectangle}
          />;
          return <g key={drawing.id}>
            <circle cx={pixels.x1} cy={pixels.y1} r="8" className={styles.noteDot} />
            <text x={pixels.x1 + 12} y={pixels.y1 - 8} className={styles.noteText}>{drawing.text}</text>
          </g>;
        })}

        {indicators.events && selectedEvents.map((event) => {
          const local = nearestIndex(candles, event.time) - chart.start;
          if (local < 0 || local >= chart.visible.length) return null;
          const x = chart.x(local);
          const fallback = chart.visible[local]?.close ?? chart.visible.at(-1)!.close;
          const y = chart.y(event.entry ?? fallback);
          const formed = event.type === "formed";
          return <g
            key={event.id}
            className={styles.eventMarker}
            onPointerEnter={(pointerEvent) => {
              pointerEvent.stopPropagation();
              setHoveredEvent({ event, x, y });
            }}
            onPointerLeave={() => setHoveredEvent(null)}
          >
            {formed
              ? <path d={`M ${x} ${y - 9} L ${x + 9} ${y} L ${x} ${y + 9} L ${x - 9} ${y} Z`} className={styles.formedMarker} />
              : <g className={styles.cancelledMarker}><line x1={x - 7} y1={y - 7} x2={x + 7} y2={y + 7} /><line x1={x + 7} y1={y - 7} x2={x - 7} y2={y + 7} /></g>}
            <text x={x + 12} y={y - 10} className={formed ? styles.formedText : styles.cancelledText}>{formed ? "SETUP" : "CANCEL"}</text>
          </g>;
        })}

        {chart.visible.length > 0 && (() => {
          const last = chart.visible.at(-1)!;
          return <g>
            <line x1={LEFT} y1={chart.y(last.close)} x2={WIDTH - RIGHT} y2={chart.y(last.close)} className={styles.livePriceLine} />
            <rect x={WIDTH - RIGHT} y={chart.y(last.close) - 10} width={RIGHT - 4} height={20} className={styles.livePriceFlag} />
            <text x={WIDTH - RIGHT + 7} y={chart.y(last.close) + 4} className={styles.livePriceText}>{formatPrice(last.close)}</text>
          </g>;
        })()}

        {currentX !== null && currentY !== null && (tool === "crosshair" || crosshair !== null) && <g pointerEvents="none">
          <line x1={currentX} y1={TOP} x2={currentX} y2={RSI_BOTTOM} className={styles.crosshair} />
          <line x1={LEFT} y1={currentY} x2={WIDTH - RIGHT} y2={currentY} className={styles.crosshair} />
        </g>}
      </svg>}

      {analysis && <div className={styles.logicBadge}>
        <b>{modelLabel(analysis.setupModel ?? null)}</b>
        <span>{analysis.side?.toUpperCase() ?? "NO TRADE"} · {analysis.state.toUpperCase()}</span>
        <small>{analysis.activeZone?.label ?? "Нет активного FROM-уровня"}</small>
      </div>}

      {hoveredEvent && <div
        className={styles.eventTooltip}
        style={{ left: `${clamp(hoveredEvent.x / WIDTH * 100, 2, 72)}%`, top: `${clamp(hoveredEvent.y / HEIGHT * 100, 4, 66)}%` }}
      >
        <div className={styles.tooltipHead}>
          <b>{hoveredEvent.event.type === "formed" ? "СЕТАП СФОРМИРОВАН" : "СЕТАП ОТМЕНЁН"}</b>
          <span>{new Date(hoveredEvent.event.time).toLocaleString("ru-RU")}</span>
        </div>
        <strong>{hoveredEvent.event.symbol} · {hoveredEvent.event.side?.toUpperCase() ?? "—"} · {modelLabel(hoveredEvent.event.model)}</strong>
        <p>{hoveredEvent.event.reason}</p>
        <div className={styles.tooltipGrid}>
          <span>Уровень<b>{hoveredEvent.event.zoneLabel ?? "—"}</b></span>
          <span>Реакция<b>{hoveredEvent.event.reactionType} · {hoveredEvent.event.reactionScore}</b></span>
          <span>Entry<b>{formatPrice(hoveredEvent.event.entry)}</b></span>
          <span>SL / TP<b>{formatPrice(hoveredEvent.event.stop)} / {formatPrice(hoveredEvent.event.target)}</b></span>
          <span>R:R<b>{hoveredEvent.event.rr?.toFixed(2) ?? "—"}</b></span>
          <span>1W / 1D<b>{hoveredEvent.event.weeklyBias} / {hoveredEvent.event.dailyBias}</b></span>
        </div>
        {hoveredEvent.event.blockers.length > 0 && <small>Блокеры: {hoveredEvent.event.blockers.join(" · ")}</small>}
      </div>}
    </div>
  </section>;
}
