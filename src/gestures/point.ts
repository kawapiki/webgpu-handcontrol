/**
 * "Pointing" gesture: index extended, other fingers curled. Used as the
 * source for the 3D raycast cursor in the scene.
 */

import type { FrameInput, GestureContext, GestureDetector, GestureState, Vec3 } from '../config/types.js';
import { condition, emptyState, holdGate } from './utils.js';

export interface PointData {
  /** Hand currently pointing (id) and its index-tip position in image space. */
  handId: number | null;
  tip: Vec3 | null;
  dir: Vec3 | null;
}

export const pointDetector: GestureDetector<PointData> = {
  name: 'point',
  initial: () => emptyState<PointData>({ handId: null, tip: null, dir: null }),
  detect(input: FrameInput, prev: GestureState<PointData>, ctx: GestureContext): GestureState<PointData> {
    const next: GestureState<PointData> = { ...prev, conditions: [], data: { handId: null, tip: null, dir: null } };

    let bestRaw = false;
    let bestHand = -1;
    let bestConfidence = 0;
    let bestTip: Vec3 | null = null;
    let bestDir: Vec3 | null = null;

    for (const hand of input.hands) {
      const indexCurl = hand.metrics.curl[1] ?? 1;
      const middleCurl = hand.metrics.curl[2] ?? 0;
      const ringCurl = hand.metrics.curl[3] ?? 0;
      const pinkyCurl = hand.metrics.curl[4] ?? 0;

      const indexExtended = indexCurl < ctx.config.point.indexExtendedMax;
      const othersCurled =
        middleCurl > ctx.config.point.othersCurledMin &&
        ringCurl > ctx.config.point.othersCurledMin &&
        pinkyCurl > ctx.config.point.othersCurledMin;

      const raw = indexExtended && othersCurled;
      // Confidence = how clearly the conditions are met.
      const confidence = Math.max(
        0,
        Math.min(
          1,
          (ctx.config.point.indexExtendedMax - indexCurl) / ctx.config.point.indexExtendedMax * 0.5 +
            (Math.min(middleCurl, ringCurl, pinkyCurl) - ctx.config.point.othersCurledMin) /
              (1 - ctx.config.point.othersCurledMin) * 0.5,
        ),
      );

      if (raw && confidence > bestConfidence) {
        bestRaw = true;
        bestHand = hand.id;
        bestConfidence = confidence;
        bestTip = hand.landmarks[8] ?? null;
        bestDir = hand.metrics.indexDir;
      }

      if (next.conditions.length === 0) {
        next.conditions.push(
          condition('index curl', indexCurl.toFixed(2), indexExtended),
          condition('others curled', `${middleCurl.toFixed(2)}/${ringCurl.toFixed(2)}/${pinkyCurl.toFixed(2)}`, othersCurled),
        );
      }
    }

    const gated = holdGate(bestRaw, { active: prev.active, enteredAt: prev.enteredAt }, ctx.nowMs, ctx.config.point.holdMs);
    next.active = gated.active;
    next.enteredAt = gated.enteredAt;
    next.confidence = bestRaw ? bestConfidence : 0;
    if (gated.active) {
      next.data = { handId: bestHand, tip: bestTip, dir: bestDir };
    }
    return next;
  },
};
