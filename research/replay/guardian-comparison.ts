import { nextGuardianState, type GuardianInput, type GuardianState } from "../../services/exit-guardian/state-machine.ts";

export type GuardianFrame = GuardianInput & Readonly<{ price: number; high: number; low: number; time: number }>;
export type GuardianComparison = Readonly<{
  guardianExitPrice: number; guardianExitTime: number; guardianExitReason: string;
  control3RHit: boolean; controlExitPrice: number; controlExitTime: number; controlExitReason: string;
  maxFavorableR: number; maxAdverseR: number; ambiguity: boolean;
}>;

// Independent paths on the same complete sample. Intrabar stop/target ties are
// reported as ambiguous and settled stop-first; prices exclude fees/slippage.
export function compareGuardianWithControl(frames: readonly GuardianFrame[], side: "LONG" | "SHORT", entry: number, stop: number): GuardianComparison {
  if (!['LONG', 'SHORT'].includes(side) || ![entry, stop].every(n => Number.isFinite(n) && n > 0)
    || (side === 'LONG' ? stop >= entry : stop <= entry) || !frames.length) throw new Error("INVALID_REPLAY_INPUT");
  let previousTime = -Infinity;
  for (const frame of frames) {
    if (![frame.time, frame.price, frame.high, frame.low].every(Number.isFinite) || frame.time <= previousTime
      || frame.low <= 0 || frame.price < frame.low || frame.price > frame.high) throw new Error('INVALID_REPLAY_FRAME');
    previousTime = frame.time;
  }
  const risk = Math.abs(entry - stop), target = side === 'LONG' ? entry + 3 * risk : entry - 3 * risk;
  let state: GuardianState = 'NORMAL';
  let guardian: { price: number; time: number; reason: string } | undefined;
  let control: { price: number; time: number; reason: string } | undefined;
  let favorable = 0, adverse = 0, controlHit = false, ambiguity = false;
  for (const frame of frames) {
    favorable = Math.max(favorable, (side === 'LONG' ? frame.high - entry : entry - frame.low) / risk);
    adverse = Math.max(adverse, (side === 'LONG' ? entry - frame.low : frame.high - entry) / risk);
    const hitTarget = side === 'LONG' ? frame.high >= target : frame.low <= target;
    const hitStop = side === 'LONG' ? frame.low <= stop : frame.high >= stop;
    if (!control) {
      controlHit ||= hitTarget;
      ambiguity ||= hitTarget && hitStop;
      if (hitStop || hitTarget) control = { price: hitStop ? stop : target, time: frame.time, reason: hitStop ? 'STOP' : 'TARGET_3R' };
    }
    if (!guardian) {
      state = nextGuardianState(state, frame);
      if (hitStop) guardian = { price: stop, time: frame.time, reason: 'STOP' };
      else if (state === 'EXIT' || state === 'EMERGENCY_POLICY') guardian = { price: frame.price, time: frame.time, reason: state };
    }
  }
  const last = frames[frames.length - 1];
  guardian ??= { price: last.price, time: last.time, reason: 'END_OF_SAMPLE' };
  control ??= { price: last.price, time: last.time, reason: 'END_OF_SAMPLE' };
  return Object.freeze({ guardianExitPrice: guardian.price, guardianExitTime: guardian.time, guardianExitReason: guardian.reason,
    control3RHit: controlHit, controlExitPrice: control.price, controlExitTime: control.time, controlExitReason: control.reason,
    maxFavorableR: favorable, maxAdverseR: adverse, ambiguity });
}
