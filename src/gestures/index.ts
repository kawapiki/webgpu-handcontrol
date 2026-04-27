/**
 * Gesture registry. The runtime iterates this array each frame; ordering
 * matters only for the "Why didn't it fire?" panel cycling.
 *
 * To add a new gesture:
 *   1. Create `src/gestures/<name>.ts` exporting a GestureDetector.
 *   2. Add it to the `detectors` array below.
 *   3. (Optional) wire it up in `interaction/interactionController.ts`.
 */

import type { GestureConfig } from '../config/gestureConfig.js';
import type { FrameInput, GestureContext, GestureDetector, GestureState } from '../config/types.js';
import { openPalmDetector } from './openPalm.js';
import { pinchDetector } from './pinch.js';
import { pointDetector } from './point.js';
import { twoHandRotateDetector } from './twoHandRotate.js';
import { twoHandZoomDetector } from './twoHandZoom.js';

export const detectors: readonly GestureDetector[] = [
  pointDetector,
  pinchDetector,
  openPalmDetector,
  twoHandZoomDetector,
  twoHandRotateDetector,
] as const;

export class GestureRuntime {
  private states = new Map<string, GestureState>();

  constructor(private readonly getConfig: () => GestureConfig) {
    for (const det of detectors) {
      this.states.set(det.name, det.initial());
    }
  }

  step(input: FrameInput, nowMs: number, prevMs: number): Readonly<Record<string, GestureState>> {
    // Build a frozen snapshot of current states for any detector that wants
    // to inspect peers (e.g. mode logic). We freeze before stepping to avoid
    // detection-order coupling.
    const snapshot: Record<string, GestureState> = Object.fromEntries(this.states);
    const ctx: GestureContext = { nowMs, prevMs, states: snapshot, config: this.getConfig() };

    for (const det of detectors) {
      const prev = this.states.get(det.name) ?? det.initial();
      const next = det.detect(input, prev, ctx);
      this.states.set(det.name, next);
    }
    return Object.fromEntries(this.states);
  }

  get(name: string): GestureState | undefined {
    return this.states.get(name);
  }
}
