/**
 * Two-handed world rotate.
 *
 * Algorithm (rewritten 2026-04 to fix flaky activation):
 *
 *   1. SELECT a stable hand pair.  We sort detected hands by handedness
 *      label ('Left' < 'Right' < 'Unknown'); ties break by image x.
 *      MediaPipe sometimes swaps detection order between frames — without
 *      this step the inter-hand line direction would flip and the angle
 *      delta would be ±π garbage.
 *
 *   2. ACTIVATION uses pinch hysteresis on the geometric mean of the two
 *      hands' pinch metrics, plus a `rotateHoldMs` debounce. This rides
 *      through single-frame jitter that previously killed the gesture.
 *      (Same activation pattern as twoHandZoom, with the added hold time.)
 *
 *   3. REFERENCE points are palm centers (mean of wrist + middle-MCP),
 *      NOT index fingertips. During pinch, the index tip is touching the
 *      thumb tip; tiny pinch-distance noise becomes huge angular noise on
 *      the inter-tip line. Palm centers are >2× more stable.
 *
 *   4. ANGLE is computed in the user's visual frame (CSS mirror applied),
 *      so a clockwise hand motion produces a clockwise rotation as the
 *      user sees it.
 *
 *   5. SMOOTH the angle with EMA (`twoHand.rotateSmoothing`), then clamp
 *      |Δangle| per frame to `twoHand.rotateMaxStep`. Anything bigger is
 *      treated as a swap or topology glitch and zeroed.
 *
 * Output: same shape as before. `delta` is the per-frame angular change
 * (rad); the controller adds it to `worldPivot.rotation.y`.
 */

import type { FrameInput, GestureContext, GestureDetector, GestureState, HandFrame } from '../config/types.js';
import { extractHandPose, wrapAngle } from '../util/handPose.js';
import { condition, emptyState, hysteresis } from './utils.js';

export interface TwoHandRotateData {
  /** Smoothed inter-palm angle (rad), or null when inactive. */
  smoothedAngle: number | null;
  /** Angle at the moment activation entered (for `total` accounting). */
  refAngle: number | null;
  /** Cumulative angular displacement (rad) since activation. */
  total: number;
  /** Frame-to-frame delta (rad). */
  delta: number;
  /** Wall-clock ms when both-pinched first observed (for hold debounce). */
  pendingSince: number | null;
}

const initData = (): TwoHandRotateData => ({
  smoothedAngle: null,
  refAngle: null,
  total: 0,
  delta: 0,
  pendingSince: null,
});

/**
 * Deterministic ordering. Returns [primary, secondary] so the inter-hand
 * line is always drawn from the same anatomical hand.
 */
function orderHands(hands: readonly HandFrame[]): [HandFrame, HandFrame] | null {
  if (hands.length < 2) return null;
  const rank = (h: HandFrame): number => {
    if (h.handedness === 'Left') return 0;
    if (h.handedness === 'Right') return 1;
    return 2;
  };
  const sorted = [...hands].sort((a, b) => {
    const r = rank(a) - rank(b);
    return r !== 0 ? r : a.metrics.palm.x - b.metrics.palm.x;
  });
  return [sorted[0]!, sorted[1]!];
}

export const twoHandRotateDetector: GestureDetector<TwoHandRotateData> = {
  name: 'two_hand_rotate',
  initial: () => emptyState<TwoHandRotateData>(initData()),
  detect(input: FrameInput, prev: GestureState<TwoHandRotateData>, ctx: GestureContext): GestureState<TwoHandRotateData> {
    const next: GestureState<TwoHandRotateData> = {
      ...prev,
      conditions: [],
      data: { ...prev.data, delta: 0 },
    };

    const pair = orderHands(input.hands);
    if (!pair) {
      next.active = false;
      next.enteredAt = null;
      next.data = initData();
      next.conditions.push(condition('hands seen', String(input.hands.length), false));
      return next;
    }
    const [a, b] = pair;

    const bothScored = a.score >= ctx.config.twoHand.minBothScore && b.score >= ctx.config.twoHand.minBothScore;
    const meanPinch = Math.sqrt(Math.max(0, a.metrics.pinch * b.metrics.pinch));
    const wasOn = prev.active;
    const pinchedNow =
      bothScored && hysteresis(wasOn, meanPinch, ctx.config.pinch.enter, ctx.config.pinch.exit, 'lt');

    next.conditions.push(
      condition('both score≥thr', `${a.score.toFixed(2)} / ${b.score.toFixed(2)}`, bothScored),
      condition('both pinched (hyst)', meanPinch.toFixed(2), pinchedNow),
    );

    // Hold debounce: must be pinched for at least rotateHoldMs before activating.
    let pendingSince = prev.data.pendingSince;
    if (pinchedNow) {
      if (pendingSince === null) pendingSince = ctx.nowMs;
    } else {
      pendingSince = null;
    }
    const holdElapsed = pendingSince !== null && ctx.nowMs - pendingSince >= ctx.config.twoHand.rotateHoldMs;
    const on = pinchedNow && (wasOn || holdElapsed);
    next.conditions.push(condition('hold debounce', `${pendingSince === null ? '—' : `${ctx.nowMs - pendingSince}ms`}`, holdElapsed));

    if (!on) {
      next.active = false;
      next.enteredAt = null;
      next.data = { ...initData(), pendingSince };
      return next;
    }

    // Reference points: palm centers from extractHandPose.
    const poseA = extractHandPose(a.landmarks);
    const poseB = extractHandPose(b.landmarks);
    if (!poseA || !poseB) {
      next.active = false;
      next.data = { ...initData(), pendingSince };
      return next;
    }

    // Inter-palm angle in user-frame (CSS-mirrored). Note we negate dx
    // because the camera image is mirrored before the user sees it.
    const dx = -(poseB.palmCenter.x - poseA.palmCenter.x);
    const dy = poseB.palmCenter.y - poseA.palmCenter.y;
    const rawAngle = Math.atan2(dy, dx);

    // First frame of activation: seed reference + smoothed angle, no delta.
    if (!prev.active || prev.data.smoothedAngle === null) {
      next.active = true;
      next.enteredAt = ctx.nowMs;
      next.confidence = 1;
      next.data = {
        smoothedAngle: rawAngle,
        refAngle: rawAngle,
        total: 0,
        delta: 0,
        pendingSince,
      };
      return next;
    }

    // EMA smoothing on the angle (with wrap-around handling).
    const alpha = ctx.config.twoHand.rotateSmoothing;
    const wrappedDeltaRaw = wrapAngle(rawAngle - prev.data.smoothedAngle);
    const smoothedAngle = wrapAngle(prev.data.smoothedAngle + (1 - alpha) * wrappedDeltaRaw);

    // Per-frame delta from previous smoothed angle.
    let delta = wrapAngle(smoothedAngle - prev.data.smoothedAngle);

    // Glitch clamp: anything bigger than rotateMaxStep is a swap/spike.
    if (Math.abs(delta) > ctx.config.twoHand.rotateMaxStep) {
      delta = 0;
    }

    // Deadzone: small jitter is dropped.
    if (Math.abs(delta) < ctx.config.twoHand.rotateDeadzone) {
      next.active = true;
      next.confidence = 1;
      next.data = {
        smoothedAngle,
        refAngle: prev.data.refAngle ?? rawAngle,
        total: prev.data.total,
        delta: 0,
        pendingSince,
      };
      return next;
    }

    next.active = true;
    next.confidence = 1;
    next.data = {
      smoothedAngle,
      refAngle: prev.data.refAngle ?? rawAngle,
      total: prev.data.total + delta,
      delta,
      pendingSince,
    };
    return next;
  },
};
