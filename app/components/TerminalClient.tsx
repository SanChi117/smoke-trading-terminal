"use client";

import { useEffect, useMemo, useState } from "react";

type TabId = "overview" | "scanner" | "backtest" | "paper" | "method";

type MarketRow = {
  symbol: string;
  label: string;
  sector: string;
  price: number;
  change: number;
  direction: "down" | "up" | "neutral";
  setup: string;
  confidence: number;
  state: "ready" | "watch" | "blocked";
  reason: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  targetRR?: number | null;
};

type ApiSnapshot = {
  generated_at?: string;
  report_ready?: boolean;
  scanner?: Array<{ symbol: string; price: number; direction_context: MarketRow["direction"]; setup_type: string; confidence: number; state: "paper_ready" | "blocked"; reason: string; entry?: number | null; stop?: number | null; target?: number | null; target_rr?: number | null }>;
  metrics?: { trades: number; return_pct: number; profit_factor: number | null; max_drawdown_pct: number };
  pipeline?: { accepted_signals: number; executed_trades: number };
  period?: { candles: number; symbols: number; start: string; end: string };
  chronological_folds?: Array<{ return_pct: number }>;
  fresh_validation_decision?: string;
};

const snapshotTime = "04.08.2026 · 16:30 UTC";

const marketRows: MarketRow[] = [
  { symbol: "BTCUSDT", label: "Bitcoin", sector: "Major", price: 63991.8, change: -1.84, direction: "up", setup: "watch", confidence: 55, state: "blocked", reason: "На последней 15m свече кандидата нет" },
  { symbol: "ETHUSDT", label: "Ethereum", sector: "Major", price: 1869.41, change: -2.32, direction: "up", setup: "watch", confidence: 50, state: "blocked", reason: "На последней 15m свече кандидата нет" },
  { symbol: "SOLUSDT", label: "Solana", sector: "Layer 1", price: 73.82, change: -3.17, direction: "up", setup: "pullback", confidence: 69, state: "blocked", reason: "Нет полного подтверждения Hybrid v2" },
  { symbol: "ARBUSDT", label: "Arbitrum", sector: "Layer 2", price: 0.08142, change: -4.05, direction: "down", setup: "watch", confidence: 36, state: "blocked", reason: "На последней 15m свече кандидата нет" },
  { symbol: "LINKUSDT", label: "Chainlink", sector: "Oracle", price: 8.176, change: -2.73, direction: "neutral", setup: "watch", confidence: 29, state: "blocked", reason: "На последней 15m свече кандидата нет" },
  { symbol: "AAVEUSDT", label: "Aave", sector: "DeFi", price: 89.92, change: -1.29, direction: "down", setup: "watch", confidence: 41, state: "blocked", reason: "Bear rejection и слабый объём" },
  { symbol: "DOGEUSDT", label: "Dogecoin", sector: "Meme", price: 0.07023, change: -3.66, direction: "neutral", setup: "watch", confidence: 37, state: "blocked", reason: "На последней 15m свече кандидата нет" },
  { symbol: "TAOUSDT", label: "Bittensor", sector: "AI / Data", price: 191.2, change: 0.72, direction: "down", setup: "watch", confidence: 30, state: "blocked", reason: "На последней 15m свече кандидата нет" },
  { symbol: "ONDOUSDT", label: "Ondo", sector: "RWA", price: 0.366, change: -0.86, direction: "down", setup: "range rotation", confidence: 49, state: "blocked", reason: "Range rotation запрещён baseline" },
];

const sectorResults = [
  { sector: "Majors", symbols: "BTC, ETH", trades: 7, netR: 0.35, pf: 1.22, status: "positive" },
  { sector: "Layer 1", symbols: "SOL", trades: 6, netR: -2.32, pf: 0.15, status: "weak" },
  { sector: "Layer 2", symbols: "ARB", trades: 3, netR: -1.82, pf: 0.15, status: "weak" },
  { sector: "DeFi", symbols: "AAVE", trades: 1, netR: 1.52, pf: 99, status: "positive" },
  { sector: "Meme", symbols: "DOGE", trades: 3, netR: 0.86, pf: 2.06, status: "positive" },
  { sector: "AI / Data", symbols: "TAO", trades: 1, netR: 1.68, pf: 99, status: "positive" },
  { sector: "Oracle", symbols: "LINK", trades: 1, netR: -1.07, pf: 0, status: "weak" },
  { sector: "RWA", symbols: "ONDO", trades: 3, netR: -2.26, pf: 0, status: "weak" },
];

const navItems: { id: TabId; label: string; badge?: string }[] = [
  { id: "overview", label: "Терминал" },
  { id: "scanner", label: "Сканер", badge: "9" },
  { id: "backtest", label: "Бэктест" },
  { id: "paper", label: "Paper" },
  { id: "method", label: "Логика" },
];

function formatPrice(value: number) {
  if (value >= 1000) return value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  if (value >= 1) return value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 5 });
}

function makeCandles(base: number, count = 54) {
  let price = base * 1.055;
  let seed = Math.round(base * 1000) % 997;
  return Array.from({ length: count }, (_, index) => {
    seed = (seed * 37 + 17) % 997;
    const wave = Math.sin(index / 4.1) * 0.004;
    const drift = -0.00105;
    const noise = ((seed / 997) - 0.5) * 0.009;
    const open = price;
    const close = Math.max(base * 0.82, open * (1 + drift + wave + noise));
    const wick = 0.0025 + ((seed % 11) / 11) * 0.006;
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - wick * 0.92);
    price = close;
    return { open, high, low, close, volume: 35 + (seed % 70) };
  });
}

function CandleChart({ row }: { row: MarketRow }) {
  const candles = useMemo(() => makeCandles(row.price), [row.price]);
  const width = 920;
  const height = 390;
  const pad = 24;
  const min = Math.min(...candles.map((item) => item.low));
  const max = Math.max(...candles.map((item) => item.high));
  const scaleY = (value: number) => pad + ((max - value) / Math.max(max - min, 0.00001)) * (height - pad * 2);
  const candleWidth = (width - pad * 2) / candles.length;
  const lastY = scaleY(candles[candles.length - 1].close);
  const path = candles.map((item, index) => `${index === 0 ? "M" : "L"} ${pad + index * candleWidth + candleWidth / 2} ${scaleY(item.close)}`).join(" ");

  return (
    <div className="chart-shell">
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`15-минутный график ${row.symbol}`}>
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6cf2c2" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#6cf2c2" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.2, 0.4, 0.6, 0.8].map((value) => <line key={value} x1={pad} y1={height * value} x2={width - pad} y2={height * value} className="grid-line" />)}
        <path d={`${path} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`} fill="url(#area)" />
        {candles.map((item, index) => {
          const x = pad + index * candleWidth + candleWidth / 2;
          const up = item.close >= item.open;
          const top = scaleY(Math.max(item.open, item.close));
          const bottom = scaleY(Math.min(item.open, item.close));
          return (
            <g key={index} className={up ? "candle-up" : "candle-down"}>
              <line x1={x} y1={scaleY(item.high)} x2={x} y2={scaleY(item.low)} />
              <rect x={x - Math.max(candleWidth * 0.29, 1.5)} y={top} width={Math.max(candleWidth * 0.58, 3)} height={Math.max(bottom - top, 1.5)} rx="1" />
            </g>
          );
        })}
        <line x1={pad} y1={lastY} x2={width - pad} y2={lastY} className="price-line" />
      </svg>
      <span className="price-flag" style={{ top: `${(lastY / height) * 100}%` }}>{formatPrice(row.price)}</span>
      <div className="chart-axis"><span>03 авг · 04:00</span><span>03 авг · 16:00</span><span>04 авг · 04:00</span><span>04 авг · 16:00</span></div>
    </div>
  );
}

function StatePill({ state }: { state: MarketRow["state"] }) {
  const labels = { ready: "PAPER READY", watch: "НАБЛЮДЕНИЕ", blocked: "ЗАБЛОКИРОВАН" };
  return <span className={`state-pill ${state}`}>{labels[state]}</span>;
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: string }) {
  return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export default function Home() {
  const [selected, setSelected] = useState("TAOUSDT");
  const [timeframe, setTimeframe] = useState("15m");
  const [risk, setRisk] = useState(0.5);
  const [apiSnapshot, setApiSnapshot] = useState<ApiSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const apiBase = process.env.NEXT_PUBLIC_TERMINAL_API_BASE?.replace(/\/$/, "") ?? "";
  useEffect(() => {
    if (!apiBase) return;
    fetch(`${apiBase}/api/snapshot`).then((response) => response.ok ? response.json() : null).then((data) => data && setApiSnapshot(data)).catch(() => undefined);
  }, [apiBase]);
  const liveRows = useMemo(() => marketRows.map((row) => {
    const scan = apiSnapshot?.scanner?.find((item) => item.symbol === row.symbol);
    if (!scan) return row;
    return { ...row, price: scan.price, direction: scan.direction_context, setup: scan.setup_type, confidence: Math.round(scan.confidence), state: scan.state === "paper_ready" ? "ready" as const : "blocked" as const, reason: scan.reason.replaceAll("_", " "), entry: scan.entry, stop: scan.stop, target: scan.target, targetRR: scan.target_rr };
  }), [apiSnapshot]);
  const current = liveRows.find((row) => row.symbol === selected) ?? liveRows[0];
  const refresh = async () => {
    if (!apiBase || refreshing) return;
    setRefreshing(true);
    try {
      const response = await fetch(`${apiBase}/api/backtest/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ risk_pct: risk, limit: 3000 }) });
      if (response.ok) setApiSnapshot(await response.json());
    } finally { setRefreshing(false); }
  };

  return (
    <main className="terminal-app">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="Открыть терминал">
          <span className="brand-mark"><i /><i /><i /></span>
          <span><b>SMOKE</b><small>STRATEGY TERMINAL</small></span>
        </a>
        <nav aria-label="Разделы терминала">
          {navItems.map((item) => (
            <a key={item.id} href={`#${item.id}`}>
              {item.label}{item.badge && <em>{item.badge}</em>}
            </a>
          ))}
        </nav>
        <div className="system-state"><span className="pulse" /><div><b>PAPER ONLY</b><small>Live orders physically absent</small></div></div>
      </header>

      <div id="overview" className="workspace tab-view">
          <aside className="watchlist">
            <div className="panel-heading"><div><span>Рынок</span><strong>Watchlist</strong></div><button aria-label="Настройки списка">•••</button></div>
            <label className="search"><span>⌕</span><input placeholder="Поиск монеты" /></label>
            <div className="watchlist-scroll">
              {liveRows.map((row) => (
                <button key={row.symbol} className={`market-row ${selected === row.symbol ? "selected" : ""}`} onClick={() => setSelected(row.symbol)}>
                  <span className={`coin coin-${row.symbol.slice(0, 3).toLowerCase()}`}>{row.symbol.slice(0, 1)}</span>
                  <span className="market-name"><b>{row.symbol.replace("USDT", "")}</b><small>{row.sector}</small></span>
                  <span className="market-price"><b>{formatPrice(row.price)}</b><small className={row.change >= 0 ? "positive" : "negative"}>{row.change > 0 ? "+" : ""}{row.change.toFixed(2)}%</small></span>
                </button>
              ))}
            </div>
            <div className="snapshot-note"><span>Источник</span><b>Binance public OHLCV</b><small>{snapshotTime}</small></div>
          </aside>

          <section className="main-stage">
            <div className="instrument-bar">
              <div className="instrument-title"><span className="coin coin-lg">{current.symbol[0]}</span><div><span>{current.label} perpetual</span><h1>{current.symbol.replace("USDT", "/USDT")}</h1></div></div>
              <div className="quote"><strong>{formatPrice(current.price)}</strong><span className={current.change >= 0 ? "positive" : "negative"}>{current.change > 0 ? "+" : ""}{current.change.toFixed(2)}%</span></div>
              <div className="timeframes" aria-label="Таймфрейм">{["5m", "15m", "1H", "4H", "1D"].map((item) => <button key={item} className={timeframe === item ? "active" : ""} onClick={() => setTimeframe(item)}>{item}</button>)}</div>
              <div className="feed-badge"><span />Public feed</div>
            </div>
            <div className="chart-meta">
              <div><span className="legend-item"><i className="ema-fast" />EMA 20</span><span className="legend-item"><i className="ema-slow" />EMA 50</span><span className="legend-item"><i className="poi" />POI / Discount</span></div>
              <small>График — интерфейсный preview; расчёты выполняет Python-ядро</small>
            </div>
            <CandleChart row={current} />
            <div className="context-strip">
              <div><span>1D CONTEXT</span><b className={current.direction === "down" ? "negative" : "muted"}>{current.direction.toUpperCase()}</b></div>
              <div><span>4H STRUCTURE</span><b>{current.direction === "down" ? "Bearish delivery" : "Range"}</b></div>
              <div><span>15M SETUP</span><b>{current.setup}</b></div>
              <div><span>VOLUME</span><b>{current.confidence > 65 ? "Above avg" : "Normal"}</b></div>
              <div><span>REGIME</span><b>Normal vol</b></div>
            </div>
          </section>

          <aside className="decision-panel">
            <div className="decision-head"><div><span>Решение ядра</span><strong>{current.symbol}</strong></div><StatePill state={current.state} /></div>
            <div className="confidence-ring" style={{ "--score": `${current.confidence * 3.6}deg` } as React.CSSProperties}><div><strong>{current.confidence}</strong><span>/ 100</span></div></div>
            <p className="decision-reason">{current.reason}</p>
            <div className="rule-stack">
              <div className="pass"><span>01</span><p><b>Контекст 1D / 4H</b><small>Direction: {current.direction}</small></p><i>✓</i></div>
              <div className={current.setup === "pullback" || current.setup === "ignition" ? "pass" : "fail"}><span>02</span><p><b>Разрешённый сетап</b><small>Pullback или ignition</small></p><i>{current.setup === "pullback" || current.setup === "ignition" ? "✓" : "×"}</i></div>
              <div className={current.confidence >= 43 ? "pass" : "fail"}><span>03</span><p><b>Уверенность ≥ 43</b><small>Текущая: {current.confidence}</small></p><i>{current.confidence >= 43 ? "✓" : "×"}</i></div>
              <div className={current.state === "ready" ? "pass" : "pending"}><span>04</span><p><b>Инвалидация и RR</b><small>Нужен структурный SL</small></p><i>{current.state === "ready" ? "✓" : "…"}</i></div>
            </div>
            <div className="risk-box">
              <div><span>Риск paper-сделки</span><b>{risk.toFixed(2)}%</b></div>
              <input aria-label="Риск paper-сделки" type="range" min="0.25" max="1" step="0.25" value={risk} onChange={(event) => setRisk(Number(event.target.value))} />
              <div className="risk-ticks"><span>0.25%</span><span>1.00% max</span></div>
            </div>
            <button className="paper-action" disabled={current.state !== "ready"}>{current.state === "ready" ? "Добавить в paper-журнал" : "Вход заблокирован правилами"}</button>
            <p className="safety-copy">Терминал не содержит API-методов размещения реальных ордеров.</p>
          </aside>
      </div>

      <section id="scanner" className="page-section tab-view">
          <div className="page-title"><div><span>Market intelligence</span><h1>Сканер стратегии</h1><p>Каждая монета проходит одну и ту же цепочку без ручного выбора победителей.</p></div><div className="page-actions"><button>15m entry</button><button className="primary" disabled={!apiBase || refreshing} onClick={refresh}>{refreshing ? "Обновляю…" : apiBase ? "Обновить public data" : "Python API offline"}</button></div></div>
          <div className="filter-row"><button className="active">Все <em>9</em></button><button>Paper ready <em>0</em></button><button>Наблюдение <em>0</em></button><button>Заблокированы <em>9</em></button></div>
          <div className="data-table scanner-table">
            <div className="table-head"><span>Инструмент</span><span>Класс</span><span>1D / 4H</span><span>Модель</span><span>Score</span><span>Решение</span><span>Причина</span></div>
            {liveRows.map((row) => <a key={row.symbol} href="#overview" className="table-row" onClick={() => setSelected(row.symbol)}><span><b>{row.symbol}</b><small>{formatPrice(row.price)}</small></span><span>{row.sector}</span><span className={row.direction === "down" ? "negative" : "muted"}>{row.direction}</span><span>{row.setup}</span><span><b>{row.confidence}</b><small>/100</small></span><span><StatePill state={row.state} /></span><span>{row.reason}</span></a>)}
          </div>
      </section>

      <section id="backtest" className="page-section tab-view">
          <div className="page-title"><div><span>Validation lab</span><h1>Честный бэктест</h1><p>Комиссия, проскальзывание, conservative same-candle rule и хронологические фолды.</p></div><div className="validation-badge"><span>FRESH SAMPLE</span><b>Live заблокирован</b><small>31 день · 9 монет · 27 000 свечей</small></div></div>
          <div className="metrics-grid"><Metric label="Исполнено сделок" value="25" detail="58 сигналов → capacity gate" /><Metric label="Результат / PF" value="−1.55% / 0.71" detail="Риск 0.5%, costs included" tone="bad" /><Metric label="Положительные фолды" value="0 / 4" detail="Все хронологические фолды < 0" tone="bad" /><Metric label="Решение" value="BLOCK LIVE" detail="Продолжить только paper-review" tone="bad" /></div>
          <div className="backtest-layout">
            <div className="data-table sector-table"><div className="table-caption"><div><span>Срез по классам</span><strong>Out-of-sample snapshot</strong></div><small>Никакого cherry-pick</small></div><div className="table-head"><span>Класс</span><span>Монеты</span><span>Сделки</span><span>Net R</span><span>PF</span><span>Статус</span></div>{sectorResults.map((row) => <div className="table-row" key={row.sector}><span><b>{row.sector}</b></span><span>{row.symbols}</span><span>{row.trades}</span><span className={row.netR >= 0 ? "positive" : "negative"}>{row.netR > 0 ? "+" : ""}{row.netR.toFixed(2)}</span><span>{row.pf.toFixed(2)}</span><span className={row.status === "positive" ? "positive" : "negative"}>{row.status}</span></div>)}</div>
            <aside className="protocol-card"><span className="eyebrow">Протокол</span><h2>Что считается честным</h2><ol><li><b>Данные только до свечи входа</b><small>Без future leakage в признаках.</small></li><li><b>SL раньше TP</b><small>Если оба уровня затронуты одной свечой.</small></li><li><b>Комиссии и slippage</b><small>Вычитаются из каждой сделки.</small></li><li><b>Все классы монет</b><small>Плохие символы не удаляются.</small></li><li><b>Paper gate остаётся</b><small>100 сделок и 30 дней одновременно.</small></li></ol></aside>
          </div>
      </section>

      <section id="paper" className="page-section paper-page tab-view">
          <div className="page-title"><div><span>Forward validation</span><h1>Paper-review журнал</h1><p>Следующий обязательный этап стратегии. Виртуальные сделки на реальном потоке данных.</p></div><StatePill state="watch" /></div>
          <div className="gate-grid"><div className="gate-card"><div className="gate-ring" style={{ "--score": "0deg" } as React.CSSProperties}><strong>0</strong><span>/100</span></div><h3>Закрытых сделок</h3><p>Счётчик начинает расти после запуска paper scanner.</p></div><div className="gate-card"><div className="gate-ring" style={{ "--score": "0deg" } as React.CSSProperties}><strong>0</strong><span>/30</span></div><h3>Календарных дней</h3><p>Минимум 30 дней нельзя заменить количеством сделок.</p></div><div className="kill-card"><span className="eyebrow">Kill switch</span><h3>Готов к работе</h3><div><span>Дневная просадка</span><b>stop при −2%</b></div><div><span>Недельная просадка</span><b>stop при −5%</b></div><div><span>Серия стопов</span><b>stop после 3</b></div><div><span>На символ</span><b>1 позиция max</b></div></div></div>
          <div className="empty-journal"><div className="journal-icon"><span /><span /><span /></div><h2>Журнал пока пуст</h2><p>Запустите Python API и scanner. Каждая виртуальная сделка будет сохранена в SQLite и доступна для CSV-экспорта.</p><button>Открыть инструкцию запуска</button></div>
      </section>

      <section id="method" className="page-section tab-view">
          <div className="page-title"><div><span>Strategy map</span><h1>FROM → TO → HOW</h1><p>Формализация учебных материалов без «магических» индикаторов.</p></div><div className="baseline-tag">TAGGED_MTF_NO_DIRECTION_BLOCK_V1</div></div>
          <div className="method-flow"><article><span>01 · FROM</span><h2>Контекст и location</h2><p>1D/4H направление, режим волатильности, Premium/Discount, HTF POI и объективная ликвидность.</p><div className="chips"><i>1D / 4H</i><i>POI</i><i>PDA</i><i>PDH / PDL</i></div></article><b>→</b><article><span>02 · HOW</span><h2>Модель входа</h2><p>15m pullback или ignition. Объём ≥ 0.70, confidence ≥ 43, без запрещённых свечей и liquidity state.</p><div className="chips"><i>Pullback</i><i>Ignition</i><i>Volume</i><i>Structure</i></div></article><b>→</b><article><span>03 · TO</span><h2>Риск и доставка</h2><p>Структурная инвалидация, SL с запасом, объективная цель, комиссии, time-stop и kill-switch.</p><div className="chips"><i>SL</i><i>TP</i><i>RR</i><i>Kill switch</i></div></article></div>
          <div className="rule-columns"><article><span className="eyebrow positive">Разрешено</span><h3>Финальный baseline</h3><ul><li>Setup: pullback, ignition</li><li>Direction context: down</li><li>Volatility: не high</li><li>Volume ratio: ≥ 0.70</li><li>Entry timeframe: 15m</li><li>5m: только telemetry</li></ul></article><article><span className="eyebrow negative">Запрещено</span><h3>Жёсткие блокировки</h3><ul><li>Breakout и range rotation</li><li>Watch impulse / liquidity reclaim</li><li>High sweep reject</li><li>Bear rejection candle</li><li>Ручной выбор победителей</li><li>Реальные ордера до paper gate</li></ul></article><article><span className="eyebrow">Evidence</span><h3>Исходная валидация</h3><ul><li>Multi-WFO: PASS_STRONG</li><li>Deep: 4 / 4 positive folds</li><li>Deep PF: 1.9357</li><li>Worst DD: 4.59%</li><li>5m gate: отклонён</li><li>Свежий короткий тест: BLOCK</li></ul></article></div>
      </section>

      <footer className="footer"><span>Smoke Strategy Terminal · research & paper only</span><span>Baseline frozen · No exchange keys · No real orders</span></footer>
    </main>
  );
}
