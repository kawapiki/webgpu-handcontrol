/**
 * Helpers shared by gesture detectors. Keep these pure and tiny — anything
 * stateful belongs inside a detector's own state object.
 */

import type { GestureCondition, GestureState, HandFrame, HandMetrics } from '../config/types.js';

export function emptyState<T>(initial: T): GestureState<T> {
  return {
    active: false,
    confidence: 0,
    enteredAt: null,
    data: initial,
    conditions: [],
  };
}

/**
 * Hysteresis helper. Given the previous active state and the current
 * value, decides whether to flip on/off using separate enter/exit
 * thresholds. `direction` controls whether the gesture activates when
 * the value is below (`'lt'`) or above (`'gt'`) the enter threshold.
 */
export function hysteresis(
  wasActive: boolean,
  value: number,
  enter: number,
  exit: number,
  direction: 'lt' | 'gt',
): boolean {
  if (direction === 'lt') {
    return wasActive ? value < exit : value < enter;
  }
  return wasActive ? value > exit : value > enter;
}

/**
 * Add a "minimum hold time" debounce on top of a raw boolean signal.
 * Returns the final active flag and the timestamp it (re)entered.
 *
 * The signal must remain `true` for `holdMs` continuous milliseconds
 * before `active` flips to true. It deactivates immediately when the
 * raw signal goes false (fast release feels right for direct manipulation).
 */
export function holdGate(
  rawOn: boolean,
  prev: { active: boolean; enteredAt: number | null },
  nowMs: number,
  holdMs: number,
): { active: boolean; enteredAt: number | null } {
  if (!rawOn) return { active: false, enteredAt: null };
  if (prev.active) return prev;
  if (prev.enteredAt === null) return { active: false, enteredAt: nowMs };
  if (nowMs - prev.enteredAt >= holdMs) return { active: true, enteredAt: prev.enteredAt };
  return { active: false, enteredAt: prev.enteredAt };
}

/** Mean curl across the four non-thumb fingers. */
export function meanFingerCurl(metrics: HandMetrics): number {
  const c = metrics.curl;
  return ((c[1] ?? 0) + (c[2] ?? 0) + (c[3] ?? 0) + (c[4] ?? 0)) / 4;
}

export function findHand(hands: HandFrame[], side: 'Left' | 'Right'): HandFrame | undefined {
  return hands.find((h) => h.handedness === side);
}

export function condition(label: string, value: number | string, passed: boolean): GestureCondition {
  return { label, value, passed };
}
