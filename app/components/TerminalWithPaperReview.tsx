"use client";

import { useEffect, useState } from "react";
import TerminalPro from "./TerminalPro";
import PaperReviewPanel from "./PaperReviewPanel";
import type { PaperJournalRecord } from "./paper-journal";
import styles from "./TradingTerminal.module.css";

const PAPER_JOURNAL_KEY = "smoke-level-flow-paper-journal-v2";

function readPaperJournal(): PaperJournalRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(PAPER_JOURNAL_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value as PaperJournalRecord[] : [];
  } catch {
    return [];
  }
}

export default function TerminalWithPaperReview() {
  const [records, setRecords] = useState<PaperJournalRecord[]>([]);

  useEffect(() => {
    const sync = () => setRecords(readPaperJournal());
    sync();
    const timer = window.setInterval(sync, 2_000);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return <>
    <TerminalPro />
    <section className={styles.tabBody}>
      <div className={styles.tabHeader}>
        <span>
          <small>PAPER REVIEW GATE</small>
          <h2>Готовность выборки к отдельному review</h2>
          <p>Live остаётся заблокирован. Gate оценивает только достаточность paper-выборки: минимум 100 закрытых сделок и 30 календарных дней.</p>
        </span>
      </div>
      <PaperReviewPanel records={records} />
    </section>
  </>;
}
