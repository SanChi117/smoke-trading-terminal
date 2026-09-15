import { nextGuardianState, type GuardianInput, type GuardianState } from "../../services/exit-guardian/state-machine.ts";

export type GuardianFrame = GuardianInput & Readonly<{ price: number; high: number; low: number; time: number }>;
export type GuardianComparison = Readonly<{ guardianExitPrice: number; guardianExitTime: number; control3RHit: boolean; maxFavorableR: number; maxAdverseR: number; ambiguity: boolean }>;

export function compareGuardianWithControl(frames: readonly GuardianFrame[], side: "LONG" | "SHORT", entry: number, stop: number): GuardianComparison {
  const risk = Math.abs(entry - stop); if (!risk || !frames.length) throw new Error("INVALID_REPLAY_INPUT");
  const control = side === "LONG" ? entry + 3 * risk : entry - 3 * risk;
  let state: GuardianState = "NORMAL", exit = frames.at(-1)!, favorable = 0, adverse = 0, controlHit = false, ambiguity = false;
  for (const frame of frames) {
    const moveHigh = side === "LONG" ? frame.high - entry : entry - frame.low;
    const moveLow = side === "LONG" ? entry - frame.low : frame.high - entry;
    favorable = Math.max(favorable, moveHigh / risk); adverse = Math.max(adverse, moveLow / risk);
    const hitControl = side === "LONG" ? frame.high >= control : frame.low <= control;
    const hitStop = side === "LONG" ? frame.low <= stop : frame.high >= stop;
    if (hitControl && hitStop) ambiguity = true;
    controlHit ||= hitControl;
    state = nextGuardianState(state, frame);
    if (state === "EXIT" || state === "EMERGENCY_POLICY") { exit = frame; break; }
  }
  return Object.freeze({ guardianExitPrice: exit.price, guardianExitTime: exit.time, control3RHit: controlHit, maxFavorableR: favorable, maxAdverseR: adverse, ambiguity });
}
