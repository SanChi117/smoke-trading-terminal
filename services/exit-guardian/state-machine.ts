export type GuardianState = "NORMAL" | "EXPANSION" | "FAST_FLUSH_DETECTED" | "RECLAIM" | "HOLD" | "FAILURE" | "EXIT" | "EMERGENCY_POLICY";
export type GuardianInput = Readonly<{ dataHealthy: boolean; fastFlush: boolean; fastReclaim: boolean; sellerAcceptance: boolean; failedRebound: boolean; expansion: boolean }>;

export function nextGuardianState(state: GuardianState, input: GuardianInput): GuardianState {
  if (!input.dataHealthy) return "EMERGENCY_POLICY";
  if (state === "EXIT" || state === "EMERGENCY_POLICY") return state;
  if (state === "NORMAL" || state === "EXPANSION" || state === "HOLD") {
    if (input.fastFlush) return "FAST_FLUSH_DETECTED";
    return input.expansion ? "EXPANSION" : "NORMAL";
  }
  if (state === "FAST_FLUSH_DETECTED") {
    if (input.fastReclaim && !input.sellerAcceptance) return "RECLAIM";
    if (input.sellerAcceptance || input.failedRebound) return "FAILURE";
    return state;
  }
  if (state === "RECLAIM") return input.sellerAcceptance || input.failedRebound ? "FAILURE" : "HOLD";
  if (state === "FAILURE") return "EXIT";
  return state;
}
