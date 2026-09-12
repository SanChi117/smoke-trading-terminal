import type { BrainName, BrainSide } from "./brain.ts";

export type ConflictKind =
  | "OPPOSING_SIDES"
  | "DUPLICATE_RISK_EVENT"
  | "PUMP_VS_REVERSAL"
  | "RANGE_VS_TREND"
  | "RANGE_VS_PUMP"
  | "TACTICAL_VS_MACRO"
  | "STALE_EVIDENCE"
  | "ACTIVE_AUTO_POSITION"
  | "MANUAL_ISOLATION";

export type Conflict = Readonly<{
  conflictId: string;
  kind: ConflictKind;
  symbol: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  brains: readonly BrainName[];
  sides: readonly BrainSide[];
  facts: readonly string[];
  requiredResolution: string;
}>;
