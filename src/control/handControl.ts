/**
 * Top-level "hand control" object — the surface a downstream consumer
 * (the future npm package, or any embedding site) interacts with.
 *
 * Owns:
 *   - the typed event bus
 *   - all sources (cursor, pinch, zoom, rotate)
 *   - the per-frame `step()` that fans out to each source
 *
 * Does NOT own:
 *   - tracking / smoothing pipeline (that's HandTracker)
 *   - DOM dispatch (that's a separate bridge — keeps this layer
 *     framework-agnostic and Node-runnable for tests)
 *
 * To extend with another semantic event, add a Source class beside the
 * existing ones (one file per semantic verb), wire it up in the
 * constructor, and declare its event in `types.ts`.
 */

import type { GestureState, HandFrame } from '../config/types.js';
import { EventBus } from './eventBus.js';
import { HandPoseSource } from './handPoseSource.js';
import { PinchSource } from './pinchSource.js';
import { PointerSource } from './pointerSource.js';
import { RotateSource } from './rotateSource.js';
import type { HandControlEventMap, Source, SourceFrame } from './types.js';
import { ZoomSource } from './zoomSource.js';

export interface HandPoseConfig {
  /** Below this absolute Δroll (rad) the handPose event reports dRoll = 0. */
  rollDeadzone: number;
  /** Below this absolute Δpitch the handPose event reports dPitch = 0. */
  pitchDeadzone: number;
}

export interface HandControlOptions {
  /** Returns the consumer's CSS-px viewport. Called every frame. */
  getViewport: () => { width: number; height: number };
  /** Returns hand-pose deadzones. Called every frame so live-tuning is supported. Defaults provided. */
  getHandPoseConfig?: () => HandPoseConfig;
}

export class HandControl {
  readonly events = new EventBus<HandControlEventMap>();
  private readonly sources: Source[];

  constructor(private readonly opts: HandControlOptions) {
    const getHandPoseConfig = opts.getHandPoseConfig ?? (() => ({ rollDeadzone: 0.005, pitchDeadzone: 0.003 }));
    this.sources = [
      new PointerSource(this.events),
      new PinchSource(this.events),
      new HandPoseSource(this.events, getHandPoseConfig),
      new ZoomSource(this.events),
      new RotateSource(this.events),
    ];
  }

  step(
    hands: readonly HandFrame[],
    states: Readonly<Record<string, GestureState>>,
    nowMs: number,
  ): void {
    const frame: SourceFrame = {
      hands,
      states,
      nowMs,
      viewport: this.opts.getViewport(),
    };
    for (const s of this.sources) s.step(frame);
  }

  reset(): void {
    for (const s of this.sources) s.reset();
  }
}

export type {
  CursorEvent, PinchEvent, PinchMoveEvent, PinchEndEvent,
  ZoomEvent, RotateEvent, HandPoseEvent, HandControlEventMap,
} from './types.js';
