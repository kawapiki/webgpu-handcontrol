/**
 * Pinch-lifecycle source. Translates the per-hand pinch state into
 * three semantic events:
 *   - `pinchStart` — first frame a hand crosses the pinch enter threshold.
 *   - `pinchMove`  — every subsequent frame while still pinched (with delta).
 *   - `pinchEnd`   — frame the pinch released, with total drift + release velocity.
 *
 * The cursor coordinates carried in these events come from the pinch
 * *midpoint* (thumb-tip + index-tip) projected to viewport CSS px,
 * which is more stable for a "click here" point than tracking just the
 * index tip during a pinch (the tip can jitter as fingers close).
 */

import type { GestureState, Landmark } from '../config/types.js';
import type { PinchData } from '../gestures/pinch.js';
import type { EventBus } from './eventBus.js';
import type { HandControlEventMap, Source, SourceFrame } from './types.js';

interface ActivePinch {
  handId: number;
  startX: number;
  startY: number;
  startMs: number;
  lastX: number;
  lastY: number;
  /** Sliding window of recent samples for velocity estimation. */
  velSamples: Array<{ x: number; y: number; t: number }>;
}

const VELOCITY_WINDOW_MS = 100;

export class PinchSource implements Source {
  private active: Map<number, ActivePinch> = new Map();

  constructor(private bus: EventBus<HandControlEventMap>) {}

  step(frame: SourceFrame): void {
    const pinch = frame.states['pinch'] as GestureState<PinchData> | undefined;
    const now = frame.nowMs;
    const seen = new Set<number>();

    for (const hand of frame.hands) {
      const per = pinch?.data.perHand[hand.id];
      if (!per) continue;

      const mid = pinchMidpoint(hand.landmarks);
      if (!mid) continue;
      const x = (1 - mid.x) * frame.viewport.width;
      const y = mid.y * frame.viewport.height;

      const prev = this.active.get(hand.id);
      if (per.pinched && !prev) {
        const next: ActivePinch = {
          handId: hand.id,
          startX: x, startY: y, startMs: now,
          lastX: x, lastY: y,
          velSamples: [{ x, y, t: now }],
        };
        this.active.set(hand.id, next);
        this.bus.emit('pinchStart', { handId: hand.id, x, y, at: now });
      } else if (per.pinched && prev) {
        const dx = x - prev.lastX;
        const dy = y - prev.lastY;
        prev.lastX = x; prev.lastY = y;
        prev.velSamples.push({ x, y, t: now });
        // Trim window.
        while (prev.velSamples.length > 1 && now - prev.velSamples[0]!.t > VELOCITY_WINDOW_MS) {
          prev.velSamples.shift();
        }
        this.bus.emit('pinchMove', { handId: hand.id, x, y, at: now, dx, dy });
      }

      seen.add(hand.id);
    }

    // Detect end: any active pinch whose hand vanished or whose perHand.pinched flipped to false.
    for (const [id, info] of [...this.active]) {
      const stillPinching = pinch?.data.perHand[id]?.pinched === true && seen.has(id);
      if (!stillPinching) {
        this.emitEnd(info, now);
        this.active.delete(id);
      }
    }
  }

  reset(): void {
    this.active.clear();
  }

  private emitEnd(info: ActivePinch, now: number): void {
    const totalDx = info.lastX - info.startX;
    const totalDy = info.lastY - info.startY;
    let vx = 0, vy = 0;
    if (info.velSamples.length >= 2) {
      const first = info.velSamples[0]!;
      const last = info.velSamples[info.velSamples.length - 1]!;
      const dt = (last.t - first.t) / 1000;
      if (dt > 0) {
        vx = (last.x - first.x) / dt;
        vy = (last.y - first.y) / dt;
      }
    }
    this.bus.emit('pinchEnd', {
      handId: info.handId,
      x: info.lastX, y: info.lastY,
      at: now,
      totalDx, totalDy, vx, vy,
      durationMs: now - info.startMs,
    });
  }
}

function pinchMidpoint(landmarks: ReadonlyArray<Landmark>): Landmark | null {
  const thumb = landmarks[4];
  const index = landmarks[8];
  if (!thumb || !index) return null;
  return {
    x: (thumb.x + index.x) * 0.5,
    y: (thumb.y + index.y) * 0.5,
    z: (thumb.z + index.z) * 0.5,
  };
}
