/**
 * Two-handed rotate: while *both* hands pinch, the angle of the line
 * between the two index-tips drives a rotation. The detector emits a
 * frame-to-frame angular delta in radians (positive = counter-clockwise
 * in image space; the controller can map it to whatever axis it wants).
 */

import { params } from '../config/parameters.js';
import type { FrameInput, GestureContext, GestureDetector, GestureState } from '../config/types.js';
import { condition, emptyState } from './utils.js';

export interface TwoHandRotateData {
  prevAngle: number | null;
  refAngle: number | null;
  /** Cumulative angular displacement (rad) since activation. */
  total: number;
  /** Frame-to-frame delta (rad). */
  delta: number;
}

const initData = (): TwoHandRotateData => ({ prevAngle: null, refAngle: null, total: 0, delta: 0 });

/** Wrap an angle delta into (-π, π]. */
function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

export const twoHandRotateDetector: GestureDetector<TwoHandRotateData> = {
  name: 'two_hand_rotate',
  initial: () => emptyState<TwoHandRotateData>(initData()),
  detect(input: FrameInput, prev: GestureState<TwoHandRotateData>, ctx: GestureContext): GestureState<TwoHandRotateData> {
    const next: GestureState<TwoHandRotateData> = { ...prev, conditions: [], data: { ...prev.data, delta: 0 } };

    if (input.hands.length < 2) {
      next.active = false;
      next.enteredAt = null;
      next.data = initData();
      return next;
    }
    const [a, b] = input.hands;
    if (!a || !b) {
      next.active = false;
      next.data = initData();
      return next;
    }

    const bothScored = a.score >= params.twoHand.minBothScore && b.score >= params.twoHand.minBothScore;
    const bothPinched =
      a.metrics.pinch < params.pinch.enter && b.metrics.pinch < params.pinch.enter;
    const on = bothScored && bothPinched;

    next.conditions.push(condition('both pinched', on ? 'yes' : 'no', on));
    if (!on) {
      next.active = false;
      next.enteredAt = null;
      next.data = initData();
      return next;
    }

    const indexA = a.landmarks[8];
    const indexB = b.landmarks[8];
    if (!indexA || !indexB) {
      next.active = false;
      next.data = initData();
      return next;
    }
    const angle = Math.atan2(indexB.y - indexA.y, indexB.x - indexA.x);

    if (!prev.active) {
      next.active = true;
      next.enteredAt = ctx.nowMs;
      next.data = { prevAngle: angle, refAngle: angle, total: 0, delta: 0 };
      return next;
    }

    const rawDelta = wrap(angle - (prev.data.prevAngle ?? angle));
    if (Math.abs(rawDelta) < params.twoHand.rotateDeadzone) {
      next.active = true;
      next.data = { ...prev.data, prevAngle: angle, delta: 0 };
      return next;
    }

    next.active = true;
    next.confidence = 1;
    next.data = {
      prevAngle: angle,
      refAngle: prev.data.refAngle ?? angle,
      total: (prev.data.total ?? 0) + rawDelta,
      delta: rawDelta,
    };
    return next;
  },
};
