"use client";

import { calculatePaperReview } from "./paper-review";
import type { PaperJournalRecord } from "./paper-journal";
import styles from "./TradingTerminal.module.css";

type Props = {
  records: PaperJournalRecord[];
};

function metric(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export default function PaperReviewPanel({ records }: Props) {
  const review = calculatePaperReview(records);
  const tradeProgress = Math.min(100, (review.closedTrades / 100) * 100);
  const dayProgress = Math.min(100, (review.observedDays / 30) * 100);
  const models = Object.entries(review.perModel);

  return <section className={styles.methodGrid} aria-label="Paper review readiness">
    <article>
      <b>LIVE GATE · {review.verdict}</b>
      <p>{review.verdict === "PAPER_REVIEW_READY"
        ? "Минимальные требования paper-review выполнены. Это не включает автоторговлю и не является разрешением на live без отдельного решения."
        : "Реальная торговля заблокирована до выполнения всех обязательных условий."}</p>
      {review.reasons.length > 0 && <small>{review.reasons.join(" · ")}</small>}
    </article>
    <article>
      <b>Закрытые сделки · {review.closedTrades}/100</b>
      <p>Прогресс {tradeProgress.toFixed(0)}%. Pending, cancelled и expired не считаются закрытыми сделками.</p>
      <small>TP {review.wins} · SL {review.losses} · pending {review.pendingTrades}</small>
    </article>
    <article>
      <b>Период наблюдения · {review.observedDays}/30 дней</b>
      <p>Прогресс {dayProgress.toFixed(0)}%. Период считается от первой до последней записи/результата paper journal.</p>
      <small>Всего записей {review.totalRecords} · cancelled {review.cancelled} · expired {review.expired}</small>
    </article>
    <article>
      <b>Качество выборки</b>
      <p>Net R {metric(review.netR)} · Expectancy {metric(review.expectancyR)}R · PF {review.profitFactor === null ? "∞" : metric(review.profitFactor)}</p>
      <small>Winrate {review.winRate === null ? "—" : `${review.winRate.toFixed(1)}%`}</small>
    </article>
    {models.map(([model, row]) => <article key={model}>
      <b>{model.toUpperCase()}</b>
      <p>{row.closedTrades} сделок · {row.wins} TP / {row.losses} SL · {metric(row.netR)}R</p>
      <small>Expectancy {metric(row.expectancyR)}R</small>
    </article>)}
  </section>;
}
