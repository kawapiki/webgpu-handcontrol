/**
 * Two-handed zoom: while *both* hands pinch, the inter-pinch distance
 * controls a zoom factor. Releasing either pinch ends the gesture.
 *
 * The detector emits a `delta` (signed scale change since last frame).
 * The interaction controller decides what to apply it to (camera, object…).
 */

import type { FrameInput, GestureContext, GestureDetector, GestureState } from '../config/types.js';
import { dist } from '../util/geometry.js';
import { condition, emptyState, hysteresis } from './utils.js';

export interface TwoHandZoomData {
  /** Distance between the two index-tips at the previous frame (image-space). */
  prevDist: number | null;
  /** Distance at the moment the gesture activated. */
  refDist: number | null;
  /** Cumulative scale factor since activation: currentDist / refDist. */
  scale: number;
  /** Frame-to-frame delta in scale (next - prev). */
  delta: number;
}

const initData = (): TwoHandZoomData => ({ prevDist: null, refDist: null, scale: 1, delta: 0 });

export const twoHandZoomDetector: GestureDetector<TwoHandZoomData> = {
  name: 'two_hand_zoom',
  initial: () => emptyState<TwoHandZoomData>(initData()),
  detect(input: FrameInput, prev: GestureState<TwoHandZoomData>, ctx: GestureContext): GestureState<TwoHandZoomData> {
    const next: GestureState<TwoHandZoomData> = { ...prev, conditions: [], data: { ...prev.data, delta: 0 } };

    if (input.hands.length < 2) {
      next.active = false;
      next.enteredAt = null;
      next.data = initData();
      next.conditions.push(condition('hands seen', String(input.hands.length), false));
      return next;
    }

    const [a, b] = input.hands;
    if (!a || !b) {
      next.active = false;
      next.data = initData();
      return next;
    }

    const bothScored = a.score >= ctx.config.twoHand.minBothScore && b.score >= ctx.config.twoHand.minBothScore;
    const bothPinched =
      a.metrics.pinch < ctx.config.pinch.enter && b.metrics.pinch < ctx.config.pinch.enter;

    // Use hysteresis on the geometric mean of the two pinch values.
    const meanPinch = Math.sqrt(Math.max(0, a.metrics.pinch * b.metrics.pinch));
    const wasOn = prev.active;
    const on =
      bothScored &&
      hysteresis(wasOn, meanPinch, ctx.config.pinch.enter, ctx.config.pinch.exit, 'lt') &&
      bothPinched;

    next.conditions.push(
      condition('both score≥thr', `${a.score.toFixed(2)} / ${b.score.toFixed(2)}`, bothScored),
      condition('both pinched', meanPinch.toFixed(2), on),
    );

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
    const d = dist(indexA, indexB);

    if (!prev.active) {
      next.active = true;
      next.enteredAt = ctx.nowMs;
      next.data = { prevDist: d, refDist: d, scale: 1, delta: 0 };
      return next;
    }

    const delta = d - (prev.data.prevDist ?? d);
    if (Math.abs(delta) < ctx.config.twoHand.zoomDeadzone) {
      next.active = true;
      next.data = { prevDist: d, refDist: prev.data.refDist ?? d, scale: prev.data.scale, delta: 0 };
      return next;
    }

    const refDist = prev.data.refDist ?? d;
    next.active = true;
    next.data = {
      prevDist: d,
      refDist,
      scale: d / Math.max(1e-3, refDist),
      delta,
    };
    next.confidence = 1;
    return next;
  },
};
