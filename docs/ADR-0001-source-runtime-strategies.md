# ADR-0001: Source of truth, runtime placement and strategy autonomy
Status: ACCEPTED AS PROJECT DIRECTION (implementation pending)
Date: 2026-10-12
Source: User MASTER TZ v1.0, linked in ../SMOKE_Trading_OS_Master_TZ_v1.0.md

## Context
The deployed AppDeploy UI and GitHub `main` are not the same code snapshot. Browser localStorage and platform credits cannot be the sole durable home for money-sensitive execution state. The user wants independent, detailed strategies with no artificial all-strategies-must-agree gate, preserving V5/QFVG and adding V2.2 as another candidate-producing engine.

## Decision
1. `main` remains the canonical source-code branch; immutable historical backup reference and source checksums are required before any implementation migration.
2. AppDeploy remains current presentation/prototype host; trading core will be deployable as a long-running standalone service on VPS (or equivalently verified always-on infrastructure), independently of browser tab and AppDeploy UI quotas.
3. Durable transactional ledger: PostgreSQL target (versioned schema, migrations, encrypted off-host backups + restoration drill). No assumption AppDeploy observations DB has proven all required guarantees.
4. Independent market-data facade owns candles, event ordering, timestamp/freshness and exchange filters. TV webhook is a low-cost candidate trigger, **not** an authoritative exchange command.
5. V2.2, V5, Pump, Trend, Range, Reversal and Catalyst output separate versioned plans via a common evidence contract. An opponent opinion is not a global veto. Arbiter prioritizes incompatible tradable hypotheses per symbol/account, tracks uncertainty and refuses internally inconsistent plans.
6. AI reasoning (if connected) assesses only bounded evidence and proposes actions; deterministic execution/SL/position accounting maintain authority. Exchange-side protection and reconciliation remain functional without AI.
7. Manual and AUTO accounts/positions are isolated. No working live mode without authorization, tests and proven order protections.
8. Product performance targets must not be encoded as automatic minimum-frequency or artificial 5–7R filters. Avoid history-only selection, promotion without out-of-sample evidence or optimizing until two systems agree.

## Rejected alternatives
- Replacing the original repository with a new terminal: loses continuity and conflicts with user requirements.
- Publishing GitHub `main` onto AppDeploy before copying the published deployment: can destroy uncommitted functionality.
- Making every brain a gate: low frequency and loss of otherwise independent qualified setups.
- Running high-leverage live trading via webhook directly: exposes positions to delivery/replay/network and margin risks.

## Implementation guards
- Integrate only with versioned adapters; no mutation of V5 production baseline just to fit new contracts.
- Source backup and secret scan precede public GitHub import.
- Rollback drill and CI/E2E are required per deploy.
- Ledger logs `candidate -> hypothesis -> arbiter -> plan -> order -> fill -> exit` with stable IDs.
- Initial AUTO-LIVE observation in MASTER TZ has isolated <=1 USDT margin per new trade; isolated margin is **not** a complete bound on liquidation or account loss. Also require defined stop/exposure constraints and an emergency technical SAFE MODE.

## Decision status
No application code change or service move has yet been performed by this ADR.
