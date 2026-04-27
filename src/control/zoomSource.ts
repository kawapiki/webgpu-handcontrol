/**
 * Zoom source. Forwards the existing two-hand-zoom gesture's per-frame
 * delta as a semantic `zoom` event. Zero-noise: only emits when active
 * AND the underlying delta is non-zero.
 */

import type { GestureState } from '../config/types.js';
import type { TwoHandZoomData } from '../gestures/twoHandZoom.js';
import type { EventBus } from './eventBus.js';
import type { HandControlEventMap, Source, SourceFrame } from './types.js';

export class ZoomSource implements Source {
  constructor(private bus: EventBus<HandControlEventMap>) {}

  step(frame: SourceFrame): void {
    const zoom = frame.states['two_hand_zoom'] as GestureState<TwoHandZoomData> | undefined;
    if (zoom?.active && zoom.data.delta !== 0) {
      this.bus.emit('zoom', { delta: zoom.data.delta });
    }
  }

  reset(): void {}
}
