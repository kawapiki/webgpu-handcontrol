/**
 * Closed-fist grab. When active, the controller can use the hand's palm
 * position as a translation source for the grabbed object.
 */

import { params } from '../config/parameters.js';
import type { FrameInput, GestureContext, GestureDetector, GestureState, Vec3 } from '../config/types.js';
import { condition, emptyState, holdGate, hysteresis, meanFingerCurl } from './utils.js';

export interface GrabData {
  handId: number | null;
  /** Palm position at this frame (smoothed, image-space). */
  palm: Vec3 | null;
  /** Palm position at the moment the grab activated — useful for delta math. */
  palmAtGrab: Vec3 | null;
}

export const grabDetector: GestureDetector<GrabData> = {
  name: 'grab',
  initial: () => emptyState<GrabData>({ handId: null, palm: null, palmAtGrab: null }),
  detect(input: FrameInput, prev: GestureState<GrabData>, ctx: GestureContext): GestureState<GrabData> {
    const next: GestureState<GrabData> = {
      ...prev,
      conditions: [],
      data: { ...prev.data },
    };

    let rawOn = false;
    let chosenId: number | null = null;
    let chosenPalm: Vec3 | null = null;
    let bestCurl = 0;

    // Prefer to keep tracking the hand that was already grabbing, if it's still here.
    const stickyId = prev.data.handId;
    const sticky = stickyId !== null ? input.hands.find((h) => h.id === stickyId) : undefined;
    const candidateOrder = sticky ? [sticky, ...input.hands.filter((h) => h.id !== stickyId)] : input.hands;

    for (const hand of candidateOrder) {
      const curl = meanFingerCurl(hand.metrics);
      const wasOn = prev.active && prev.data.handId === hand.id;
      const on = hysteresis(wasOn, curl, params.grab.enter, params.grab.exit, 'gt');
      if (on && curl > bestCurl) {
        rawOn = true;
        chosenId = hand.id;
        chosenPalm = hand.metrics.palm;
        bestCurl = curl;
      }
      if (next.conditions.length === 0) {
        next.conditions.push(condition('mean curl', curl.toFixed(2), on));
      }
    }

    const gated = holdGate(rawOn, { active: prev.active, enteredAt: prev.enteredAt }, ctx.nowMs, params.grab.holdMs);
    next.active = gated.active;
    next.enteredAt = gated.enteredAt;
    next.confidence = rawOn ? Math.min(1, bestCurl) : 0;

    if (gated.active && chosenId !== null && chosenPalm) {
      const isNewGrab = !prev.active || prev.data.handId !== chosenId;
      next.data = {
        handId: chosenId,
        palm: chosenPalm,
        palmAtGrab: isNewGrab ? chosenPalm : prev.data.palmAtGrab ?? chosenPalm,
      };
    } else if (!gated.active) {
      next.data = { handId: null, palm: null, palmAtGrab: null };
    }

    return next;
  },
};
