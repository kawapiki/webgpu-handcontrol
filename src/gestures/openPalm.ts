/**
 * Open palm — all fingers extended. Used as a "release / stop / menu" event.
 */

import type { FrameInput, GestureContext, GestureDetector, GestureState } from '../config/types.js';
import { condition, emptyState, holdGate, meanFingerCurl } from './utils.js';

export interface OpenPalmData {
  handId: number | null;
}

export const openPalmDetector: GestureDetector<OpenPalmData> = {
  name: 'open_palm',
  initial: () => emptyState<OpenPalmData>({ handId: null }),
  detect(input: FrameInput, prev: GestureState<OpenPalmData>, ctx: GestureContext): GestureState<OpenPalmData> {
    const next: GestureState<OpenPalmData> = { ...prev, conditions: [], data: { handId: null } };

    let rawOn = false;
    let bestId: number | null = null;
    let bestCurl = 1;

    for (const hand of input.hands) {
      const curl = meanFingerCurl(hand.metrics);
      const open = curl < ctx.config.openPalm.maxCurl;
      if (open && curl < bestCurl) {
        rawOn = true;
        bestCurl = curl;
        bestId = hand.id;
      }
      if (next.conditions.length === 0) {
        next.conditions.push(condition('mean curl', curl.toFixed(2), open));
      }
    }

    const gated = holdGate(rawOn, { active: prev.active, enteredAt: prev.enteredAt }, ctx.nowMs, ctx.config.openPalm.holdMs);
    next.active = gated.active;
    next.enteredAt = gated.enteredAt;
    next.confidence = rawOn ? Math.max(0, 1 - bestCurl / Math.max(1e-3, ctx.config.openPalm.maxCurl)) : 0;
    next.data = { handId: gated.active ? bestId : null };
    return next;
  },
};
