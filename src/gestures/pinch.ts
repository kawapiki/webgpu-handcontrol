/**
 * Pinch gesture (per hand). Fires `tappedAt` when a pinch is held for
 * tapHoldMs and then released — gives a clean "air-tap" event without
 * triggering on accidental brushes.
 *
 * State payload exposes both `active` (currently pinched) and
 * `tappedAt` (ms timestamp of last completed tap, or null).
 */

import { params } from '../config/parameters.js';
import type { FrameInput, GestureContext, GestureDetector, GestureState } from '../config/types.js';
import { condition, emptyState, hysteresis } from './utils.js';

export interface PinchData {
  /** Per-hand pinched state, keyed by hand id. */
  perHand: Record<number, { pinched: boolean; enteredAt: number | null }>;
  /** Last completed tap (ms timestamp), or null. */
  tappedAt: number | null;
  /** Last hand id that produced a tap. */
  lastTapHandId: number | null;
}

export const pinchDetector: GestureDetector<PinchData> = {
  name: 'pinch',
  initial: () => emptyState<PinchData>({ perHand: {}, tappedAt: null, lastTapHandId: null }),
  detect(input: FrameInput, prev: GestureState<PinchData>, ctx: GestureContext): GestureState<PinchData> {
    const next: GestureState<PinchData> = {
      ...prev,
      conditions: [],
      data: { perHand: { ...prev.data.perHand }, tappedAt: prev.data.tappedAt, lastTapHandId: prev.data.lastTapHandId },
    };

    let anyActive = false;
    let bestConfidence = 0;

    const seenIds = new Set<number>();

    for (const hand of input.hands) {
      seenIds.add(hand.id);
      const prevPer = prev.data.perHand[hand.id] ?? { pinched: false, enteredAt: null };
      const pinched = hysteresis(prevPer.pinched, hand.metrics.pinch, params.pinch.enter, params.pinch.exit, 'lt');
      const enteredAt = pinched
        ? prevPer.enteredAt ?? ctx.nowMs
        : null;

      // Tap detection: was held >= tapHoldMs, then released this frame.
      const justReleased = prevPer.pinched && !pinched;
      const heldLongEnough = prevPer.enteredAt !== null && ctx.nowMs - prevPer.enteredAt >= params.pinch.tapHoldMs;
      const cooldownOk =
        next.data.tappedAt === null || ctx.nowMs - next.data.tappedAt >= params.pinch.tapCooldownMs;
      if (justReleased && heldLongEnough && cooldownOk) {
        next.data.tappedAt = ctx.nowMs;
        next.data.lastTapHandId = hand.id;
      }

      next.data.perHand[hand.id] = { pinched, enteredAt };
      if (pinched) {
        anyActive = true;
        // Confidence: 1 at pinch=enter, falling toward 0 at pinch=exit*1.5
        const range = Math.max(1e-3, params.pinch.exit * 1.5 - params.pinch.enter);
        bestConfidence = Math.max(bestConfidence, Math.min(1, 1 - (hand.metrics.pinch - params.pinch.enter) / range));
      }

      // Conditions for the focused hand (first one we see — UI picks one anyway)
      if (next.conditions.length === 0) {
        next.conditions.push(
          condition('pinch dist', hand.metrics.pinch.toFixed(3), hand.metrics.pinch < params.pinch.enter),
          condition('cooldown ok', cooldownOk ? 'yes' : 'no', cooldownOk),
        );
      }
    }

    // Drop hands we no longer see.
    for (const idStr of Object.keys(next.data.perHand)) {
      const id = Number(idStr);
      if (!seenIds.has(id)) delete next.data.perHand[id];
    }

    next.active = anyActive;
    next.confidence = bestConfidence;
    next.enteredAt = anyActive ? prev.enteredAt ?? ctx.nowMs : null;
    return next;
  },
};
