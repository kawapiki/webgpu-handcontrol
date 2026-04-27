/**
 * Cursor source. Picks an "active" hand each frame and emits a `cursor`
 * event with the index fingertip projected into CSS-px viewport space.
 *
 * Active-hand priority:
 *   1. The hand currently pinching (if any) — keeps the cursor steady
 *      during a click/drag.
 *   2. The hand the `point` gesture says is pointing.
 *   3. The first detected hand.
 *
 * Coordinate space:
 *   MediaPipe landmarks are in [0,1] image space *un-mirrored*. The
 *   camera preview is mirrored via CSS, so to match the user's visual
 *   frame we flip x: `viewX = 1 - lm.x`.
 */

import type { GestureState } from '../config/types.js';
import type { PinchData } from '../gestures/pinch.js';
import type { PointData } from '../gestures/point.js';
import type { EventBus } from './eventBus.js';
import type { HandControlEventMap, Source, SourceFrame } from './types.js';

export class PointerSource implements Source {
  constructor(private bus: EventBus<HandControlEventMap>) {}

  step(frame: SourceFrame): void {
    const handId = pickActiveHandId(frame);
    if (handId === null) {
      this.bus.emit('cursor', { handId: -1, x: 0, y: 0, visible: false });
      return;
    }
    const hand = frame.hands.find((h) => h.id === handId);
    const tip = hand?.landmarks[8];
    if (!hand || !tip) {
      this.bus.emit('cursor', { handId, x: 0, y: 0, visible: false });
      return;
    }
    const x = (1 - tip.x) * frame.viewport.width;
    const y = tip.y * frame.viewport.height;
    this.bus.emit('cursor', { handId, x, y, visible: true });
  }

  reset(): void {}
}

function pickActiveHandId(frame: SourceFrame): number | null {
  const pinch = frame.states['pinch'] as GestureState<PinchData> | undefined;
  if (pinch?.active) {
    for (const [idStr, perHand] of Object.entries(pinch.data.perHand)) {
      if (perHand.pinched) return Number(idStr);
    }
  }
  const point = frame.states['point'] as GestureState<PointData> | undefined;
  if (point?.active && point.data.handId !== null) return point.data.handId;
  return frame.hands[0]?.id ?? null;
}
