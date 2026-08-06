"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  analyzeLevelFlow,
  runLevelBacktest,
  type LevelBacktestResult,
  type MtfLevelAnalysis,
  type Timeframe,
  type TimeframeBundle,
} from "../lib/mtf-level-strategy";
import {
  fetch24hTickers,
  fetchKlinesRange,
  fetchStrategyBundle,
  subscribeKline,
  type Ticker24h,
} from "../lib/binance-level-client";
import ProChart from "./ProChart";
import {
  TERMINAL_SYMBOLS,
  formatPrice,
  journalEventFromAnalysis,
  modelLabel,
  setupSignature,
  type JournalEvent,
  type JournalEventType,
} from "./terminal-data";
import {
  cancelPaperRecord,
  createPaperJournalRecord,
  paperDecisionId,
  resolvePaperOutcome,
  type PaperJournalOutcome,
  type PaperJournalRecord,
} from "./paper-journal";
import styles from "./TradingTerminal.module.css";

type Tab = "terminal" | "scanner" | "journal" | "backtest" | "method";
const TIMEFRAMES: Timeframe[] = ["5m", "15m", "4h", "1d", "1w"];
const JOURNAL_KEY = "smoke-level-flow-journal-v1";
const PAPER_JOURNAL_KEY = "smoke-level-flow-paper-journal-v2";

function stateLabel(analysis: MtfLevelAnalysis | null): string {
  if (!analysis) return "НЕ ПРОВЕРЕН";
  if (analysis.state === "ready") return "PAPER READY";
  if (analysis.state === "watch") return "ФОРМИРУЕТСЯ";
  return "ЗАБЛОКИРОВАН";
}

function stateClass(analysis: MtfLevelAnalysis | null): string {
  if (analysis?.state === "ready") return styles.readyState;
  if (analysis?.state === "watch") return styles.watchState;
  return styles.blockedState;
}

function csvEscape(value: unknown): string {
  const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function outcomeLabel(outcome: PaperJournalOutcome): string {
  if (outcome === "take_profit") return "TAKE PROFIT";
  if (outcome === "stop_loss") return "STOP LOSS";
  if (outcome === "cancelled") return "ОТМЕНЁН";
  if (outcome === "expired") return "ИСТЁК";
  return "PENDING";
}

export default function TerminalPro() {
  const [tab, setTab] = useState<Tab>("terminal");
  const [selected, setSelected] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [search, setSearch] = useState("");
  const [tickers, setTickers] = useState<Record<string, Ticker24h>>({});
  const [bundle, setBundle] = useState<TimeframeBundle | null>(null);
  const [analysis, setAnalysis] = useState<MtfLevelAnalysis | null>(null);
  const [scanResults, setScanResults] = useState<Record<string, MtfLevelAnalysis>>({});
  const [journal, setJournal] = useState<JournalEvent[]>([]);
  const [paperJournal, setPaperJournal] = useState<PaperJournalRecord[]>([]);
  const [journalFilter, setJournalFilter] = useState<{ symbol: string; type: "all" | JournalEventType; model: string; outcome: "all" | PaperJournalOutcome }>({ symbol: "all", type: "all", model: "all", outcome: "all" });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [backtestDays, setBacktestDays] = useState(14);
  const [backtest, setBacktest] = useState<LevelBacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedState, setFeedState] = useState<"connecting" | "live" | "reconnecting" | "offline">("connecting");
  const requestId = useRef(0);
  const selectedRef = useRef(selected);
  const journalLoaded = useRef(false);
  const previousAnalyses = useRef<Record<string, MtfLevelAnalysis>>({});

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    try {
      setJournal(JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "[]") as JournalEvent[]);
      setPaperJournal(JSON.parse(localStorage.getItem(PAPER_JOURNAL_KEY) ?? "[]") as PaperJournalRecord[]);
    } catch {
      setJournal([]);
      setPaperJournal([]);
    } finally {
      journalLoaded.current = true;
    }
  }, []);
  useEffect(() => {
    if (!journalLoaded.current) return;
    try {
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal.slice(0, 1500)));
      localStorage.setItem(PAPER_JOURNAL_KEY, JSON.stringify(paperJournal.slice(0, 500)));
    } catch {
      // Best effort only.
    }
  }, [journal, paperJournal]);

  const appendJournal = useCallback((event: JournalEvent) => {
    if (!journalLoaded.current) return;
    setJournal((current) => current.some((row) => row.signature === event.signature)
      ? current
      : [event, ...current].slice(0, 1500));
  }, []);

  const upsertPaperRecord = useCallback((record: PaperJournalRecord) => {
    if (!journalLoaded.current) return;
    setPaperJournal((current) => {
      const index = current.findIndex((row) => row.decisionId === record.decisionId);
      if (index < 0) return [record, ...current].slice(0, 500);
      if (current[index].outcome !== "pending" && record.outcome === "pending") return current;
      const next = [...current];
      next[index] = record;
      return next;
    });
  }, []);

  const cancelPendingForAnalysis = useCallback((source: MtfLevelAnalysis, current: MtfLevelAnalysis) => {
    const decisionId = paperDecisionId(source);
    setPaperJournal((records) => records.map((record) =>
      record.decisionId === decisionId ? cancelPaperRecord(record, current) : record));
  }, []);

  const acceptAnalysis = useCallback((result: MtfLevelAnalysis, nextBundle?: TimeframeBundle) => {
    const previous = previousAnalyses.current[result.symbol];
    const previousReady = previous?.state === "ready";
    const currentReady = result.state === "ready";
    const changedReadySetup = previousReady && currentReady && setupSignature(previous) !== setupSignature(result);

    if (changedReadySetup && previous) {
      appendJournal(journalEventFromAnalysis(result, "cancelled", previous));
      cancelPendingForAnalysis(previous, result);
      appendJournal(journalEventFromAnalysis(result, "formed"));
      if (nextBundle) upsertPaperRecord(createPaperJournalRecord(result, nextBundle));
    } else if (!previousReady && currentReady) {
      appendJournal(journalEventFromAnalysis(result, "formed"));
      if (nextBundle) upsertPaperRecord(createPaperJournalRecord(result, nextBundle));
    } else if (previousReady && !currentReady && previous) {
      appendJournal(journalEventFromAnalysis(result, "cancelled", previous));
      cancelPendingForAnalysis(previous, result);
    } else if (currentReady && nextBundle) {
      upsertPaperRecord(createPaperJournalRecord(result, nextBundle));
    }

    previousAnalyses.current[result.symbol] = result;
    setScanResults((current) => ({ ...current, [result.symbol]: result }));
    if (selectedRef.current === result.symbol) {
      if (nextBundle) setBundle(nextBundle);
      setAnalysis(result);
    }
  }, [appendJournal, cancelPendingForAnalysis, upsertPaperRecord]);

  const resolveClosedCandle = useCallback((symbol: string, candle: TimeframeBundle["15m"][number]) => {
    setPaperJournal((records) => records.map((record) =>
      record.symbol === symbol ? resolvePaperOutcome(record, candle) : record));
  }, []);

  const symbolMeta = TERMINAL_SYMBOLS.find(([symbol]) => symbol === selected) ?? TERMINAL_SYMBOLS[0];
  const ticker = tickers[selected];
  const chartCandles = bundle?.[timeframe] ?? [];
  const visibleSymbols = useMemo(() => {
    const needle = search.trim().toUpperCase();
    if (!needle) return TERMINAL_SYMBOLS;
    return TERMINAL_SYMBOLS.filter(([symbol, name, sector]) => `${symbol} ${name} ${sector}`.toUpperCase().includes(needle));
  }, [search]);

  const loadTickers = useCallback(async () => {
    try {
      const rows = await fetch24hTickers(TERMINAL_SYMBOLS.map(([symbol]) => symbol));
      setTickers(Object.fromEntries(rows.map((row) => [row.symbol, row])));
    } catch {
      // Keep last good ticker snapshot.
    }
  }, []);

  const loadSymbol = useCallback(async (symbol: string, quiet = false) => {
    const id = ++requestId.current;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const data = await fetchStrategyBundle(symbol);
      if (id !== requestId.current && selectedRef.current === symbol) return;
      const decision = analyzeLevelFlow(symbol, data);
      acceptAnalysis(decision, data);
    } catch (reason) {
      if (selectedRef.current === symbol) {
        setFeedState("offline");
        setError(reason instanceof Error ? reason.message : "Не удалось получить данные Binance");
      }
    } finally {
      if (!quiet && selectedRef.current === symbol) setLoading(false);
    }
  }, [acceptAnalysis]);

  useEffect(() => {
    void loadTickers();
    const timer = setInterval(loadTickers, 20_000);
    return () => clearInterval(timer);
  }, [loadTickers]);

  useEffect(() => {
    void loadSymbol(selected);
  }, [loadSymbol, selected]);

  useEffect(() => subscribeKline(selected, timeframe, (candle, closed) => {
    setBundle((current) => {
      if (!current) return current;
      const rows = [...current[timeframe]];
      const last = rows.at(-1);
      if (last?.time === candle.time) rows[rows.length - 1] = candle;
      else rows.push(candle);
      return { ...current, [timeframe]: rows.slice(-1500) };
    });
    if (closed && timeframe === "15m") resolveClosedCandle(selected, candle);
    if (closed && (timeframe === "5m" || timeframe === "15m")) void loadSymbol(selected, true);
  }, setFeedState), [loadSymbol, resolveClosedCandle, selected, timeframe]);

  useEffect(() => {
    if (timeframe === "5m") return undefined;
    return subscribeKline(selected, "5m", (_candle, closed) => {
      if (closed) void loadSymbol(selected, true);
    }, setFeedState);
  }, [loadSymbol, selected, timeframe]);

  useEffect(() => {
    if (!bundle) return;
    const next = analyzeLevelFlow(selected, bundle);
    acceptAnalysis(next, bundle);
  }, [acceptAnalysis, bundle, selected]);

  const scanAll = async () => {
    if (scanning) return;
    setScanning(true);
    setError(null);
    const queue = TERMINAL_SYMBOLS.map(([symbol]) => symbol);
    const worker = async () => {
      while (queue.length > 0) {
        const symbol = queue.shift();
        if (!symbol) return;
        try {
          const data = await fetchStrategyBundle(symbol);
          acceptAnalysis(analyzeLevelFlow(symbol, data), data);
        } catch {
          // A failed symbol must not stop the complete scan.
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setScanning(false);
  };

  const runBacktest = async () => {
    if (backtesting) return;
    setBacktesting(true);
    setError(null);
    try {
      const now = Date.now();
      const warmup = 40 * 24 * 60 * 60_000;
      const start = now - (backtestDays * 24 * 60 * 60_000 + warmup);
      const [base, fifteenM, fiveM] = await Promise.all([
        fetchStrategyBundle(selected),
        fetchKlinesRange(selected, "15m", start, now),
        fetchKlinesRange(selected, "5m", start, now),
      ]);
      setBacktest(runLevelBacktest(selected, { ...base, "15m": fifteenM, "5m": fiveM }, { testDays: backtestDays }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Бэктест не выполнен");
    } finally {
      setBacktesting(false);
    }
  };

  const exportPaperCsv = () => {
    const headers = ["decision_id", "created_at", "updated_at", "symbol", "state", "side", "model", "zone_id", "zone_source", "zone_timeframe", "reaction", "entry", "stop", "target", "rr", "outcome", "outcome_at", "outcome_price", "reason", "blockers", "trace", "candles"];
    const rows = paperJournal.map((record) => [
      record.decisionId, new Date(record.createdAt).toISOString(), new Date(record.updatedAt).toISOString(), record.symbol,
      record.state, record.side, record.setupModel, record.zoneId, record.zoneSource, record.zoneTimeframe, record.reactionType,
      record.entry, record.stop, record.target, record.rr, record.outcome,
      record.outcomeAt ? new Date(record.outcomeAt).toISOString() : "", record.outcomePrice,
      record.reason, record.blockers.join(" | "), record.trace, record.candles,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    downloadText(`smoke-paper-journal-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  };

  const exportPaperJson = () => {
    downloadText(
      `smoke-paper-journal-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ version: "SMOKE_LEVEL_FLOW_V5_PAPER_JOURNAL_V2", exportedAt: new Date().toISOString(), records: paperJournal }, null, 2),
      "application/json;charset=utf-8",
    );
  };

  const filteredPaperJournal = paperJournal.filter((record) =>
    (journalFilter.symbol === "all" || record.symbol === journalFilter.symbol)
    && (journalFilter.model === "all" || record.setupModel === journalFilter.model)
    && (journalFilter.outcome === "all" || record.outcome === journalFilter.outcome));
  const readyCount = Object.values(scanResults).filter((result) => result.state === "ready").length;
  const watchCount = Object.values(scanResults).filter((result) => result.state === "watch").length;
  const pendingCount = paperJournal.filter((record) => record.outcome === "pending").length;
  const winCount = paperJournal.filter((record) => record.outcome === "take_profit").length;
  const lossCount = paperJournal.filter((record) => record.outcome === "stop_loss").length;
  const cancelledCount = paperJournal.filter((record) => record.outcome === "cancelled").length;

  return <main className={styles.terminalShell}>
    <header className={styles.topbar}>
      <button className={styles.brand} onClick={() => setTab("terminal")}>
        <span className={styles.brandMark}>S</span>
        <span><b>SMOKE</b><small>LEVEL FLOW TERMINAL</small></span>
      </button>
      <nav className={styles.nav}>
        {([
          ["terminal", "Терминал"], ["scanner", "Сканер"], ["journal", "Журнал"], ["backtest", "Бэктест"], ["method", "Логика"],
        ] as Array<[Tab, string]>).map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={tab === key ? styles.activeTab : ""}>
          {label}{key === "journal" && paperJournal.length > 0 ? <em>{paperJournal.length}</em> : null}
        </button>)}
      </nav>
      <div className={styles.systemState}>
        <i className={feedState === "live" ? styles.livePulse : styles.warnPulse} />
        <span><b>{feedState.toUpperCase()}</b><small>PAPER ONLY · SMOKE_LEVEL_FLOW_V5</small></span>
      </div>
    </header>

    {tab === "terminal" && <div className={styles.workspace}>
      <aside className={styles.watchlist}>
        <div className={styles.panelHeading}><span>Binance Futures</span><b>{readyCount} ready · {watchCount} watch</b></div>
        <label className={styles.searchBox}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск монеты" /></label>
        <div className={styles.watchlistScroll}>{visibleSymbols.map((item) => {
          const [symbol, name, sector] = item;
          const row = tickers[symbol];
          const result = scanResults[symbol];
          return <button key={symbol} className={`${styles.marketRow} ${selected === symbol ? styles.selectedMarket : ""} ${result?.state === "ready" ? styles.readyMarket : ""}`} onClick={() => setSelected(symbol)}>
            <span className={styles.coin}>{symbol.slice(0, 1)}</span>
            <span className={styles.marketName}><b>{symbol.replace("USDT", "")}</b><small>{sector} · {result?.activeZone?.label ?? name}</small></span>
            <span className={styles.marketPrice}><b>{formatPrice(row?.lastPrice)}</b><small className={(row?.changePct ?? 0) >= 0 ? styles.positive : styles.negative}>{row ? `${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%` : "—"}</small></span>
          </button>;
        })}</div>
        <div className={styles.sidebarActions}><button onClick={scanAll} disabled={scanning}>{scanning ? "Сканирование 19 монет…" : "Сканировать все 19 монет"}</button></div>
      </aside>

      <section className={styles.centerStage}>
        <div className={styles.instrumentBar}>
          <div className={styles.instrumentTitle}><span className={styles.coinLarge}>{selected.slice(0, 1)}</span><span><h1>{selected.replace("USDT", "/USDT")} Perpetual</h1><small>{symbolMeta[1]} · {symbolMeta[2]}</small></span></div>
          <div className={styles.quote}><b>{formatPrice(ticker?.lastPrice ?? chartCandles.at(-1)?.close)}</b><small className={(ticker?.changePct ?? 0) >= 0 ? styles.positive : styles.negative}>{ticker ? `${ticker.changePct >= 0 ? "+" : ""}${ticker.changePct.toFixed(2)}%` : feedState}</small></div>
          <div className={styles.timeframes}>{TIMEFRAMES.map((item) => <button key={item} onClick={() => setTimeframe(item)} className={timeframe === item ? styles.activeTf : ""}>{item}</button>)}</div>
          <button className={styles.refreshButton} onClick={() => void loadSymbol(selected)}>Обновить</button>
        </div>
        <div className={styles.contextStrip}>
          <span><small>1W BIAS</small><b>{analysis?.weeklyBias ?? "—"}</b></span>
          <span><small>1D BIAS</small><b>{analysis?.dailyBias ?? "—"}</b></span>
          <span><small>HTF LOCATION</small><b>{analysis?.range?.position ?? "—"}</b></span>
          <span><small>V5 MODEL</small><b>{modelLabel(analysis?.setupModel)}</b></span>
          <span><small>FROM LEVEL</small><b>{analysis?.activeZone?.label ?? "нет активного"}</b></span>
          <span><small>4H ROUTE</small><b>{analysis?.route4h.state ?? "—"}</b></span>
          <span><small>5m REACTION</small><b>{analysis?.reaction.type ?? "—"}</b></span>
        </div>
        <ProChart symbol={selected} timeframe={timeframe} candles={chartCandles} analysis={analysis} events={journal} loading={loading} />
      </section>

      <aside className={styles.decisionPanel}>
        <div className={styles.decisionHead}><span><small>Решение стратегии</small><b>{analysis?.side?.toUpperCase() ?? "NO TRADE"}</b></span><em className={`${styles.statePill} ${stateClass(analysis)}`}>{stateLabel(analysis)}</em></div>
        <div className={styles.modelCard}><span>SETUP MODEL</span><b>{modelLabel(analysis?.setupModel)}</b><small>{analysis?.modelDetail ?? "Модель определится после полной MTF-цепочки"}</small></div>
        <div className={styles.confidenceArea}>
          <div className={styles.scoreRing} style={{ "--score": `${(analysis?.confidence ?? 0) * 3.6}deg` } as CSSProperties}><span><b>{analysis?.confidence ?? 0}</b><small>confidence</small></span></div>
          <p>{analysis?.reason ?? "Загрузка контекста, уровней и реакции…"}</p>
        </div>
        {error && <div className={styles.errorBox}>{error}</div>}
        <div className={styles.traceList}>{analysis?.trace.map((step, index) => <article key={step.id} className={`${styles.traceStep} ${styles[step.state]}`}>
          <i>{step.state === "pass" ? "✓" : step.state === "fail" ? "×" : index + 1}</i>
          <span><b>{step.label}</b><small>{step.detail}</small></span>
        </article>)}</div>
        <div className={styles.tradePlan}><span>ПЛАН СДЕЛКИ</span><div>
          <article><small>ENTRY</small><b>{formatPrice(analysis?.entry)}</b></article>
          <article><small>R:R</small><b>{analysis?.rr?.toFixed(2) ?? "—"}</b></article>
          <article><small>STOP</small><b className={styles.negative}>{formatPrice(analysis?.stop)}</b></article>
          <article><small>TARGET</small><b className={styles.positive}>{formatPrice(analysis?.target)}</b></article>
        </div></div>
        <div className={styles.liveLogicNote}>Активные POI, FVG, маршрут, реакция и торговый план берутся из текущего V5-решения. READY сохраняется со snapshot свечей и trace; TP, SL или отмена фиксируются автоматически.</div>
      </aside>
    </div>}

    {tab === "scanner" && <section className={styles.tabBody}>
      <div className={styles.tabHeader}><span><small>MTF SCANNER · 19 SYMBOLS</small><h2>Уровневые сетапы V5</h2></span><button onClick={scanAll} disabled={scanning}>{scanning ? "Сканирую…" : "Сканировать все"}</button></div>
      <div className={styles.statCards}><article><span>READY</span><b>{readyCount}</b></article><article><span>WATCH</span><b>{watchCount}</b></article><article><span>PENDING</span><b>{pendingCount}</b></article><article><span>TP / SL</span><b>{winCount} / {lossCount}</b></article></div>
      <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Монета</th><th>Цена</th><th>1W / 1D</th><th>Модель</th><th>FROM уровень</th><th>4H</th><th>5m</th><th>R:R</th><th>Score</th><th>Решение</th></tr></thead><tbody>{TERMINAL_SYMBOLS.map(([symbol]) => {
        const result = scanResults[symbol];
        return <tr key={symbol} onClick={() => { setSelected(symbol); setTab("terminal"); }}>
          <td><b>{symbol}</b></td><td>{formatPrice(tickers[symbol]?.lastPrice)}</td><td>{result ? `${result.weeklyBias} / ${result.dailyBias}` : "—"}</td><td>{modelLabel(result?.setupModel)}</td><td>{result?.activeZone?.label ?? "—"}</td><td>{result?.route4h.state ?? "—"}</td><td>{result?.reaction.type ?? "—"}</td><td>{result?.rr?.toFixed(2) ?? "—"}</td><td>{result?.confidence ?? 0}</td><td><em className={`${styles.statePill} ${stateClass(result ?? null)}`}>{stateLabel(result ?? null)}</em></td>
        </tr>;
      })}</tbody></table></div>
    </section>}

    {tab === "journal" && <section className={styles.tabBody}>
      <div className={styles.tabHeader}><span><small>PAPER TRADING JOURNAL</small><h2>Решения, snapshots и outcomes</h2><p>Каждый READY-сетап хранит trace, закрытые входные свечи и итог без реального исполнения.</p></span><div className={styles.headerActions}><button onClick={exportPaperCsv} disabled={paperJournal.length === 0}>CSV</button><button onClick={exportPaperJson} disabled={paperJournal.length === 0}>JSON</button><button className={styles.dangerButton} onClick={() => window.confirm("Полностью очистить paper journal?") && setPaperJournal([])} disabled={paperJournal.length === 0}>Очистить</button></div></div>
      <div className={styles.statCards}><article><span>PENDING</span><b>{pendingCount}</b></article><article><span>TAKE PROFIT</span><b>{winCount}</b></article><article><span>STOP LOSS</span><b>{lossCount}</b></article><article><span>CANCELLED</span><b>{cancelledCount}</b></article></div>
      <div className={styles.journalFilters}>
        <label>Монета<select value={journalFilter.symbol} onChange={(event) => setJournalFilter((current) => ({ ...current, symbol: event.target.value }))}><option value="all">Все</option>{TERMINAL_SYMBOLS.map(([symbol]) => <option key={symbol} value={symbol}>{symbol}</option>)}</select></label>
        <label>Outcome<select value={journalFilter.outcome} onChange={(event) => setJournalFilter((current) => ({ ...current, outcome: event.target.value as "all" | PaperJournalOutcome }))}><option value="all">Все</option><option value="pending">Pending</option><option value="take_profit">Take profit</option><option value="stop_loss">Stop loss</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option></select></label>
        <label>Модель<select value={journalFilter.model} onChange={(event) => setJournalFilter((current) => ({ ...current, model: event.target.value }))}><option value="all">Все</option><option value="location">LOCATION</option><option value="reversal">REVERSAL</option><option value="continuation">CONTINUATION</option><option value="blocked">BLOCKED</option></select></label>
        <span>Показано <b>{filteredPaperJournal.length}</b> из {paperJournal.length}</span>
      </div>
      <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Создан</th><th>Монета</th><th>Outcome</th><th>Side / модель</th><th>FROM уровень</th><th>Реакция</th><th>Entry / SL / TP</th><th>R:R</th><th>Trace</th><th>Snapshots</th><th>Причина</th></tr></thead><tbody>{filteredPaperJournal.map((record) => <tr key={record.decisionId} onClick={() => { setSelected(record.symbol); setTab("terminal"); }}>
        <td>{new Date(record.createdAt).toLocaleString("ru-RU")}<small>{record.outcomeAt ? new Date(record.outcomeAt).toLocaleString("ru-RU") : "ожидает результата"}</small></td><td><b>{record.symbol}</b></td><td><span className={record.outcome === "take_profit" ? styles.eventFormed : record.outcome === "pending" ? styles.statePill : styles.eventCancelled}>{outcomeLabel(record.outcome)}</span><small>{formatPrice(record.outcomePrice)}</small></td><td>{record.side?.toUpperCase() ?? "—"}<small>{modelLabel(record.setupModel)}</small></td><td>{record.zoneId ?? "—"}<small>{record.zoneTimeframe} · {record.zoneSource}</small></td><td>{record.reactionType}</td><td>{formatPrice(record.entry)}<small>{formatPrice(record.stop)} / {formatPrice(record.target)}</small></td><td>{record.rr?.toFixed(2) ?? "—"}</td><td>{record.trace.length}<small>{record.trace.map((step) => `${step.label}:${step.state}`).join(" · ")}</small></td><td>{Object.values(record.candles).reduce((sum, rows) => sum + (rows?.length ?? 0), 0)}<small>{Object.entries(record.candles).map(([tf, rows]) => `${tf}:${rows?.length ?? 0}`).join(" · ")}</small></td><td className={styles.reasonCell}>{record.reason}{record.blockers.length > 0 && <small>Блокеры: {record.blockers.join(" · ")}</small>}</td>
      </tr>)}</tbody></table></div>
      {filteredPaperJournal.length === 0 && <div className={styles.emptyState}>Paper journal начнёт заполняться при появлении READY-сетапа во время загрузки или сканирования.</div>}
    </section>}

    {tab === "backtest" && <section className={styles.tabBody}>
      <div className={styles.tabHeader}><span><small>BROWSER BACKTEST</small><h2>{selected} · SMOKE_LEVEL_FLOW_V5</h2><p>Next-open execution, SL-first, комиссии, проскальзывание и структурное сопровождение.</p></span><div className={styles.headerActions}><select value={backtestDays} onChange={(event) => setBacktestDays(Number(event.target.value))}><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option><option value={60}>60 дней</option></select><button onClick={runBacktest} disabled={backtesting}>{backtesting ? "Расчёт…" : "Запустить"}</button></div></div>
      {backtest && <><div className={styles.statCards}><article><span>СДЕЛКИ</span><b>{backtest.metrics.trades}</b></article><article><span>NET R</span><b>{backtest.metrics.netR.toFixed(2)}R</b></article><article><span>WINRATE</span><b>{backtest.metrics.winrate.toFixed(1)}%</b></article><article><span>PROFIT FACTOR</span><b>{backtest.metrics.profitFactor === null ? "∞" : backtest.metrics.profitFactor.toFixed(2)}</b></article><article><span>MAX DD</span><b>{backtest.metrics.maxDrawdownR.toFixed(2)}R</b></article></div><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Вход</th><th>Side</th><th>Уровень</th><th>Контекст</th><th>Реакция</th><th>Entry</th><th>SL</th><th>TP</th><th>Выход</th><th>Net R</th></tr></thead><tbody>{backtest.trades.slice().reverse().map((trade) => <tr key={`${trade.entryTime}-${trade.side}`}><td>{new Date(trade.entryTime).toLocaleString("ru-RU")}</td><td>{trade.side.toUpperCase()}</td><td>{trade.zoneLabel}<small>{trade.zoneTimeframe} · {trade.zoneSource}</small></td><td>{trade.weeklyBias} / {trade.dailyBias}<small>{trade.rangePosition} · 4H {trade.phase4hBias}</small></td><td>{trade.reactionType}</td><td>{formatPrice(trade.entry)}</td><td>{formatPrice(trade.stop)}</td><td>{formatPrice(trade.target)}</td><td>{trade.reason}</td><td className={trade.netR >= 0 ? styles.positive : styles.negative}>{trade.netR.toFixed(2)}R</td></tr>)}</tbody></table></div></>}
    </section>}

    {tab === "method" && <section className={styles.tabBody}>
      <div className={styles.tabHeader}><span><small>DECISION PIPELINE</small><h2>Как терминал воспроизводит структуру</h2></span><p>График не рисует декоративные сигналы: каждый объект берётся из текущего анализа V5.</p></div>
      <div className={styles.methodGrid}>
        <article><b>1. 1W / 1D контекст</b><p>Подтверждённые swing-пивоты и закрытия за ними формируют BOS/CHoCH, bias и старший dealing range.</p></article>
        <article><b>2. Активный FROM-уровень</b><p>POI создаётся из order block, swing, range level или FVG. На графике остаются только активные зоны; инвалидированные исчезают.</p></article>
        <article><b>3. 4H маршрут</b><p>Стратегия различает approaching, inside, departing и moving away. Маршрут визуально соединяет текущую цену с выбранным уровнем.</p></article>
        <article><b>4. 5m реакция</b><p>Sweep-reclaim, structure retest или displacement отображаются только пока реакция относится к актуальному сценарию.</p></article>
        <article><b>5. V5 regime gate</b><p>LOCATION, REVERSAL и CONTINUATION являются разными моделями. Смешанные сценарии получают BLOCKED MODEL.</p></article>
        <article><b>6. 15m исполнение</b><p>Entry, SL и TP появляются только в состоянии READY и исчезают сразу после отмены или инвалидации плана.</p></article>
        <article><b>7. Paper journal</b><p>READY сохраняет decisionId, trace и входные свечи. Закрытые 15m свечи разрешают TP/SL по консервативному правилу stop-first.</p></article>
        <article><b>8. Пользовательская разметка</b><p>Уровни, трендовые линии, зоны и заметки сохраняются локально отдельно для каждой монеты и таймфрейма.</p></article>
      </div>
    </section>}
  </main>;
}
