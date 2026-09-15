export type SafetySignal = Readonly<{ code: string; healthy: boolean; blocking: boolean; detail: string }>;
export type SafetyState = Readonly<{ mode: "RUNNING" | "SAFE_MODE"; reasons: readonly string[]; newEntriesAllowed: boolean; existingAutoProtectionAllowed: boolean }>;

export function evaluateSafety(signals: readonly SafetySignal[]): SafetyState {
  const reasons = signals.filter((signal) => signal.blocking && !signal.healthy).map((signal) => signal.code);
  return Object.freeze({
    mode: reasons.length ? "SAFE_MODE" : "RUNNING",
    reasons: Object.freeze(reasons),
    newEntriesAllowed: reasons.length === 0,
    existingAutoProtectionAllowed: true,
  });
}
