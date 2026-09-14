"use client";

import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle,
  createChart, createSeriesMarkers,
  type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle, MtfLevelAnalysis, Timeframe } from "../lib/mtf-level-strategy";
import type { JournalEntry } from "../lib/trading-journal";
import LegacyChart from "./ProLevelChart";
import styles from "./TerminalV6.module.css";
import chartStyles from "./ProfessionalChart.module.css";

type Indicator = "ema20" | "ema50" | "ema200" | "vwap" | "volume" | "zones" | "trades" | "events";
type Props = { symbol: string; timeframe: Timeframe; candles: Candle[]; analysis: MtfLevelAnalysis | null; journal: JournalEntry[]; loading?: boolean };
const DEFAULT_INDICATORS: Record<Indicator, boolean> = { ema20: true, ema50: true, ema200: false, vwap: true, volume: true, zones: true, trades: true, events: true };
const asTime = (milliseconds: number) => Math.floor(milliseconds / 1000) as UTCTimestamp;
const fmt = (value: number) => value >= 1_000 ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value >= 1 ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 }) : value.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 8 });
function ema(values: readonly number[], length: number) { if (!values.length) return []; const result = [values[0]], weight = 2 / (length + 1); for (let index = 1; index < values.length; index += 1) result.push(values[index] * weight + result[index - 1] * (1 - weight)); return result }
function vwap(candles: readonly Candle[]) { let priceVolume = 0, volume = 0; return candles.map((candle) => { priceVolume += ((candle.high + candle.low + candle.close) / 3) * candle.volume; volume += candle.volume; return volume ? priceVolume / volume : candle.close }) }

export default function ProfessionalChart({ symbol, timeframe, candles, analysis, journal, loading }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null), chartRef = useRef<IChartApi | null>(null), candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null), candlesRef = useRef(candles);
  const previousRef = useRef<{ symbol: string; timeframe: Timeframe; length: number; lastTime: number } | null>(null), markerRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indicatorRefs = useRef<{ ema20: ISeriesApi<"Line">; ema50: ISeriesApi<"Line">; ema200: ISeriesApi<"Line">; vwap: ISeriesApi<"Line">; volume: ISeriesApi<"Histogram"> } | null>(null);
  const [legacy, setLegacy] = useState(false), [indicators, setIndicators] = useState(DEFAULT_INDICATORS), [hovered, setHovered] = useState<Candle | null>(null), [ready, setReady] = useState(false);
  useEffect(() => { candlesRef.current = candles }, [candles]);
  const calculations = useMemo(() => { const closes = candles.map((candle) => candle.close); return { ema20: ema(closes, 20), ema50: ema(closes, 50), ema200: ema(closes, 200), vwap: vwap(candles) } }, [candles]);

  useEffect(() => {
    if (legacy || !hostRef.current) return;
    const chart = createChart(hostRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#081310" }, textColor: "#78978c", attributionLogo: true },
      grid: { vertLines: { color: "#152923" }, horzLines: { color: "#152923" } },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: "#72988d", labelBackgroundColor: "#153b31" }, horzLine: { color: "#72988d", labelBackgroundColor: "#153b31" } },
      rightPriceScale: { borderColor: "#244039", minimumWidth: 84, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: "#244039", timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7, minBarSpacing: 1.2, lockVisibleTimeRangeOnResize: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }, kineticScroll: { mouse: true, touch: true }, localization: { locale: "ru-RU" },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, { upColor: "#35c992", downColor: "#eb6473", borderUpColor: "#35c992", borderDownColor: "#eb6473", wickUpColor: "#6ce7bd", wickDownColor: "#ff8995", priceFormat: { type: "price", precision: 8, minMove: 0.00000001 } });
    const createLine = (color: string, lineWidth: 1 | 2) => chart.addSeries(LineSeries, { color, lineWidth, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
    const volumeSeries = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart; candleRef.current = candleSeries;
    indicatorRefs.current = { ema20: createLine("#e0b45c", 2), ema50: createLine("#58a7e8", 2), ema200: createLine("#c987e8", 2), vwap: createLine("#d9e5e1", 1), volume: volumeSeries };
    markerRef.current = createSeriesMarkers(candleSeries, []);
    const crosshair = (param: { time?: Time; seriesData: Map<ISeriesApi<"Candlestick">, unknown> }) => { const point = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined; if (!point || param.time === undefined) return setHovered(null); const row = candlesRef.current.find((item) => asTime(item.time) === param.time); setHovered({ time: Number(param.time) * 1000, open: point.open, high: point.high, low: point.low, close: point.close, volume: row?.volume ?? 0 }) };
    chart.subscribeCrosshairMove(crosshair); setReady(true);
    return () => { chart.unsubscribeCrosshairMove(crosshair); markerRef.current?.detach(); chart.remove(); chartRef.current = null; candleRef.current = null; indicatorRefs.current = null; markerRef.current = null; previousRef.current = null; setReady(false) };
  }, [legacy]);

  useEffect(() => {
    const chart = chartRef.current, candleSeries = candleRef.current, series = indicatorRefs.current;
    if (!chart || !candleSeries || !series) return;
    if (!candles.length) {
      candleSeries.setData([]);
      for (const line of [series.ema20, series.ema50, series.ema200, series.vwap]) line.setData([]);
      series.volume.setData([]);
      markerRef.current?.setMarkers([]);
      previousRef.current = null;
      setHovered(null);
      return;
    }
    const previous = previousRef.current, last = candles.at(-1)!;
    const streaming = previous?.symbol === symbol && previous.timeframe === timeframe && previous.length === candles.length && previous.lastTime === last.time;
    if (streaming) {
      const index = candles.length - 1, time = asTime(last.time);
      candleSeries.update({ time, open: last.open, high: last.high, low: last.low, close: last.close });
      series.ema20.update({ time, value: calculations.ema20[index] }); series.ema50.update({ time, value: calculations.ema50[index] }); series.ema200.update({ time, value: calculations.ema200[index] }); series.vwap.update({ time, value: calculations.vwap[index] });
      series.volume.update({ time, value: last.volume, color: last.close >= last.open ? "rgba(53,201,146,.38)" : "rgba(235,100,115,.38)" });
    } else {
      candleSeries.setData(candles.map((candle) => ({ time: asTime(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close })));
      const setLine = (target: ISeriesApi<"Line">, values: readonly number[]) => target.setData(candles.map((candle, index) => ({ time: asTime(candle.time), value: values[index] })).filter((point) => Number.isFinite(point.value)));
      setLine(series.ema20, calculations.ema20); setLine(series.ema50, calculations.ema50); setLine(series.ema200, calculations.ema200); setLine(series.vwap, calculations.vwap);
      series.volume.setData(candles.map<HistogramData<Time>>((candle) => ({ time: asTime(candle.time), value: candle.volume, color: candle.close >= candle.open ? "rgba(53,201,146,.38)" : "rgba(235,100,115,.38)" })));
    }
    const changedInstrument = !previous || previous.symbol !== symbol || previous.timeframe !== timeframe;
    previousRef.current = { symbol, timeframe, length: candles.length, lastTime: last.time };
    if (changedInstrument) {
      setHovered(null);
      chart.priceScale("right").applyOptions({ autoScale: true, invertScale: false });
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 120), to: candles.length + 8 });
    }
  }, [calculations, candles, ready, symbol, timeframe]);

  useEffect(() => {
    const series = indicatorRefs.current; if (!series) return;
    series.ema20.applyOptions({ visible: indicators.ema20 }); series.ema50.applyOptions({ visible: indicators.ema50 }); series.ema200.applyOptions({ visible: indicators.ema200 }); series.vwap.applyOptions({ visible: indicators.vwap }); series.volume.applyOptions({ visible: indicators.volume });
  }, [indicators, ready]);

  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setMarkers(indicators.events ? journal.slice(0, 100).filter((event) => candles.some((candle) => candle.time === event.time)).sort((left, right) => left.time - right.time).map((event) => ({ time: asTime(event.time), position: event.status === "cancelled" ? "aboveBar" as const : "belowBar" as const, color: event.status === "cancelled" ? "#ff6476" : "#55ddb0", shape: event.status === "cancelled" ? "arrowDown" as const : "arrowUp" as const, text: event.status.toUpperCase() })) : []);
  }, [candles, indicators.events, journal, ready]);

  useEffect(() => {
    const candleSeries = candleRef.current; if (!candleSeries) return;
    const priceLines = [];
    if (indicators.zones) for (const zone of (analysis?.zones ?? []).filter((item) => item.active).slice(0, 10)) priceLines.push(candleSeries.createPriceLine({ price: (zone.low + zone.high) / 2, color: zone.kind === "demand" ? "rgba(53,201,146,.72)" : "rgba(235,100,115,.72)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: `${zone.timeframe.toUpperCase()} ${zone.label}` }));
    if (indicators.trades && analysis) for (const [price, title, color] of [[analysis.entry, "ENTRY", "#58a7e8"], [analysis.stop, "SL", "#ff6476"], [analysis.target, "TP", "#55ddb0"]] as const) if (price !== null) priceLines.push(candleSeries.createPriceLine({ price, title, color, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true }));
    return () => { for (const priceLine of priceLines) candleSeries.removePriceLine(priceLine) };
  }, [analysis, indicators.trades, indicators.zones, ready]);

  if (legacy) return <div className={chartStyles.professionalChart}><div className={chartStyles.chartModeBar}><b>Режим рисунков</b><button onClick={() => setLegacy(false)}>Вернуться в PRO</button></div><LegacyChart symbol={symbol} timeframe={timeframe} candles={candles} analysis={analysis} journal={journal} loading={loading}/></div>;
  const latest = hovered ?? candles.at(-1) ?? null;
  return <section className={chartStyles.professionalChart} aria-label={`${symbol} professional candlestick chart`}><div className={chartStyles.chartModeBar}><div className={chartStyles.chartLegend}><b>{symbol} · USDⓈ-M Futures · {timeframe} · UTC</b>{latest && <span>O {fmt(latest.open)} H {fmt(latest.high)} L {fmt(latest.low)} C {fmt(latest.close)} V {latest.volume.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>}</div><div className={chartStyles.chartActions}>{(Object.keys(indicators) as Indicator[]).map((key) => <button key={key} className={indicators[key] ? styles.on : ""} onClick={() => setIndicators((current) => ({ ...current, [key]: !current[key] }))}>{key.toUpperCase()}</button>)}<button onClick={() => chartRef.current?.timeScale().fitContent()}>По размеру</button><button onClick={() => chartRef.current?.timeScale().scrollToRealTime()}>Сейчас</button><button onClick={() => hostRef.current?.parentElement?.requestFullscreen?.()}>На весь экран</button><button onClick={() => setLegacy(true)}>Рисовать</button></div></div><div ref={hostRef} className={chartStyles.chartCanvas}/>{!candles.length && <div className={chartStyles.chartLoading}>{loading ? "Загрузка Binance Futures…" : "Нет свечей"}</div>}<footer className={chartStyles.chartAttribution}>Колесо — масштаб · drag — прокрутка · шкала цены — вертикальный масштаб · <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView</a></footer></section>;
}
