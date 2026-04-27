/**
 * Rotate source. Forwards the existing two-hand-rotate gesture's
 * per-frame delta as a semantic `rotate` event.
 */

import type { GestureState } from '../config/types.js';
import type { TwoHandRotateData } from '../gestures/twoHandRotate.js';
import type { EventBus } from './eventBus.js';
import type { HandControlEventMap, Source, SourceFrame } from './types.js';

export class RotateSource implements Source {
  constructor(private bus: EventBus<HandControlEventMap>) {}

  step(frame: SourceFrame): void {
    const rotate = frame.states['two_hand_rotate'] as GestureState<TwoHandRotateData> | undefined;
    if (rotate?.active && rotate.data.delta !== 0) {
      this.bus.emit('rotate', { delta: rotate.data.delta });
    }
  }

  reset(): void {}
}
