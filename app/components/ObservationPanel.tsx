'use client';
import { useState } from 'react';
import styles from './ObservationPanel.module.css';
import type { MarketObservation } from '../../services/market-data/observation-features';

export type ObservationClient = {
  analyze(symbol: string, save: boolean): Promise<{ result: MarketObservation; id?: string }>;
  history(nextToken?: string): Promise<{ items: Array<{ id: string; result: MarketObservation }>; nextToken?: string }>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
};
export default function ObservationPanel({ client }: { client: ObservationClient }) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [result, setResult] = useState<MarketObservation | null>(null);
  const [rows, setRows] = useState<Array<{ id: string; result: MarketObservation }>>([]);
  const [nextToken, setNextToken] = useState<string>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Запрос не выполнен. Повторите.'); }
    finally { setBusy(false); }
  };
  const analyze = (save: boolean) => run(async () => {
    if (!/^[A-Z0-9]{2,16}USDT$/.test(symbol)) throw new Error('Введите символ USDT, например BTCUSDT.');
    const response = await client.analyze(symbol, save);
    setResult(response.result);
    setMessage(response.id ? `Сохранено в личный журнал · ${response.id}` : 'Анализ получен. Для сохранения используйте «Анализ + запись».');
  });
  const history = (more: boolean) => run(async () => {
    const page = await client.history(more ? nextToken : undefined);
    setRows(current => more ? [...current, ...page.items] : page.items); setNextToken(page.nextToken);
    setMessage(page.items.length ? 'Журнал загружен с сервера.' : 'В журнале пока нет записей.');
  });
  return <section className={styles.panel}>
    <h1>Brains · решения и журнал</h1>
    <p>Исследовательское наблюдение · Binance USDⓈ-M · реальные ордера выключены. Мнения новых модулей не изменяют V5.</p>
    <div className={styles.controls}>
      <input aria-label="Символ анализа" value={symbol} maxLength={20} onChange={e => setSymbol(e.target.value.toUpperCase().trim())} />
      <button disabled={busy} onClick={() => void analyze(false)}>Анализировать</button>
      <button disabled={busy} onClick={() => void run(async () => { setRows([]); setResult(null); setNextToken(undefined); await client.signIn(); setMessage('Вход выполнен. Личный журнал доступен.'); })}>Войти для журнала</button>
      <button disabled={busy} onClick={() => void analyze(true)}>Анализ + запись</button>
      <button disabled={busy} onClick={() => void history(false)}>Загрузить журнал</button>
      <button disabled={busy} onClick={() => void run(async () => { await client.signOut(); setRows([]); setResult(null); setNextToken(undefined); setMessage('Вы вышли.'); })}>Выйти</button>
    </div>
    {busy && <p role="status">Получаю данные…</p>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {result && <>
      <h2>{result.symbol} · {result.arbiter.result.decision} · {result.safety.mode}</h2>
      <p>{new Date(result.evaluatedAt).toLocaleString('ru-RU')} · {result.source} · {result.featureVersion}</p>
      <p>Macro: {result.macro.narrative} · {result.macro.bias}. Арбитр: {result.arbiter.source}.</p>
      <p>Исполнение: отключено. Счёт не подключён. Снимок получен из браузера и не подтверждён сервером биржи. Оценки — баллы модели, а не вероятность прибыли.</p>
      <p>Данные: {Object.entries(result.input.snapshot.freshness).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>
      {result.safety.reasons.length > 0 && <p>Блокировки: {result.safety.reasons.join(', ')}</p>}
      <div className={styles.grid}>
        {result.opinions.map(opinion => <article key={opinion.opinionId} className={styles.card}>
          <h3>{opinion.brain} · {opinion.side} · {opinion.stage}</h3>
          <p>{opinion.confidence}/100 · {opinion.mechanism}</p>
          <p>За: {opinion.evidence.join(' · ')}</p><p>Против: {opinion.counterEvidence.join(' · ')}</p>
        </article>)}
      </div>
      <h3>Конфликты</h3>
      {result.conflicts.length ? result.conflicts.map(conflict => <p key={conflict.conflictId}>{conflict.severity} · {conflict.kind}: {conflict.facts.join('; ')}</p>) : <p>Между гипотезами конфликтов не выявлено.</p>}
      <p>Решение: {result.arbiter.result.invalidationThesis}</p>
      <details><summary>Исходные данные и полная цепочка</summary><pre >{JSON.stringify(result, null, 2)}</pre></details>
    </>}
    <h2>Личный серверный журнал</h2>
    <p>Записи доступны только после входа. Показана одна страница; новые страницы загружаются кнопкой.</p>
    {rows.map(row => <button key={row.id} className={styles.record} onClick={() => setResult(row.result)}>{row.result.symbol} · {new Date(row.result.evaluatedAt).toLocaleString('ru-RU')} · {row.result.arbiter.result.decision}</button>)}
    {nextToken && <button disabled={busy} onClick={() => void history(true)}>Следующая страница</button>}
  </section>;
}
