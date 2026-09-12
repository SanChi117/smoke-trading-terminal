# ADR-0001: Incremental modular migration

- Status: Accepted
- Date: 2026-09-12
- Starting SHA: `f808b01522a4eb72afec9c83595b208e42a6f39f`

## Context

The existing terminal has working market-data, V5/QFVG analysis, paper, backtest and UI capabilities, but several responsibilities are coupled in client components. Replacing the product wholesale would risk losing verified behavior and violate the master specification.

## Decision

Introduce stable contracts and facades first, then migrate feature-by-feature. Existing V5/QFVG and paper modules remain operational behind legacy adapters until equivalent behavior is covered by regression tests. New domains may not import UI components. Brains may produce opinions but cannot submit orders. Execution accepts only an immutable, validated TradePlan.

The target domains are:

- `core/contracts`, `core/conflicts`, `core/risk`, `core/state`, `core/ledger`
- `services/market-data`, `services/orchestrator`, `services/ai-brain`, `services/execution`, `services/exit-guardian`
- `brains/macro`, `brains/pump`, `brains/trend`, `brains/range`, `brains/reversal`, `brains/catalyst`, `brains/arbiter`
- `research/replay`, `research/backtest`, `research/walk-forward`, `research/diagnostics`

Physical moves are deliberately deferred until their public contracts and tests exist.

## Consequences

- The repository remains runnable after each atomic step.
- Some legacy and new modules coexist temporarily.
- Strategy semantics cannot change merely because files are reorganized.
- Removal of a legacy module requires an equivalent adapter, tests and a documented migration.
