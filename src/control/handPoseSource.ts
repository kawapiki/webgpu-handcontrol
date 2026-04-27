/**
 * Hand-pose source. For every pinching hand it emits a `handPose` event
 * with the per-frame roll/pitch deltas (deadzoned) plus the absolute
 * current values. Downstream consumers (e.g. a webpage that wants to
 * spin a 3D widget while the user pinches it) subscribe to this stream
 * without needing to know anything about MediaPipe landmarks.
 *
 * Why pinch-gated? Because the user is signalling intent — a passive
 * hand drifting around shouldn't accidentally rotate things. Pinch is
 * the universal "I'm acting on this" verb for mid-air UIs.
 *
 * Deadzones are provided through `HandControlOptions.getHandPoseConfig`,
 * not read from app `params`, so this file ships cleanly inside the
 * future npm package without app coupling.
 */

import type { GestureState } from '../config/types.js';
import type { PinchData } from '../gestures/pinch.js';
import { extractHandPose, wrapAngle } from '../util/handPose.js';
import type { EventBus } from './eventBus.js';
import type { HandPoseConfig } from './handControl.js';
import type { HandControlEventMap, Source, SourceFrame } from './types.js';

interface PerHandState {
  roll: number;
  pitch: number;
}

export class HandPoseSource implements Source {
  private prev: Map<number, PerHandState> = new Map();

  constructor(
    private readonly bus: EventBus<HandControlEventMap>,
    private readonly getConfig: () => HandPoseConfig,
  ) {}

  step(frame: SourceFrame): void {
    const pinch = frame.states['pinch'] as GestureState<PinchData> | undefined;
    const cfg = this.getConfig();
    const seen = new Set<number>();

    for (const hand of frame.hands) {
      const per = pinch?.data.perHand[hand.id];
      if (!per?.pinched) continue;
      seen.add(hand.id);

      const pose = extractHandPose(hand.landmarks);
      if (!pose) continue;

      const prev = this.prev.get(hand.id);
      let dRoll = 0;
      let dPitch = 0;
      if (prev) {
        // Roll IS angular — wrap so a ±π crossing produces a small Δ.
        const rawDRoll = wrapAngle(pose.roll - prev.roll);
        // Pitch is a normalized depth signal (lm9.z − lm0.z), NOT angular,
        // so it doesn't wrap; a raw subtraction is correct here.
        const rawDPitch = pose.pitch - prev.pitch;
        if (Math.abs(rawDRoll)  > cfg.rollDeadzone)  dRoll  = rawDRoll;
        if (Math.abs(rawDPitch) > cfg.pitchDeadzone) dPitch = rawDPitch;
      }
      this.prev.set(hand.id, { roll: pose.roll, pitch: pose.pitch });

      this.bus.emit('handPose', {
        handId: hand.id,
        dRoll, dPitch,
        roll: pose.roll, pitch: pose.pitch,
      });
    }

    // Drop hands no longer pinching so the next pinch starts fresh.
    for (const id of [...this.prev.keys()]) {
      if (!seen.has(id)) this.prev.delete(id);
    }
  }

  reset(): void {
    this.prev.clear();
  }
}
