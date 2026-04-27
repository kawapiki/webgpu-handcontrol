/**
 * Per-hand landmark smoother.
 *
 * Pipeline (in order):
 *   raw  →  velocity gate  →  topology fix  →  One Euro filter  →  topology fix  →  out
 *
 * - velocity gate drops physically-impossible *whole-frame* jumps; with
 *   topology enforcement we can be lenient (huge default ceiling).
 * - topology fix #1 cleans up "orphan" landmarks before the filter, so
 *   the filter sees anatomically consistent input on every axis.
 * - One Euro Filter smooths per-axis (kills jitter, adapts to speed).
 * - topology fix #2 corrects any chain-stretch the per-axis filter
 *   re-introduced (filter lag on fingertip vs DIP, for example).
 */

import type { SmoothingConfig, VelocityGateConfig } from '../config/gestureConfig.js';
import type { Landmark, Landmarks } from '../config/types.js';
import { OneEuroFilter } from './oneEuroFilter.js';
import { TopologyConstraint } from './topologyConstraint.js';

const AXIS_COUNT = 3;
const LANDMARK_COUNT = 21;

export interface SmootherConfig {
  smoothing: SmoothingConfig;
  velocityGate: VelocityGateConfig;
}

export class LandmarkSmoother {
  private filters: OneEuroFilter[];
  private prev: Landmark[] | null = null;
  private prevTimeMs = 0;
  private topology = new TopologyConstraint();

  constructor(private readonly getConfig: () => SmootherConfig) {
    this.filters = new Array(LANDMARK_COUNT * AXIS_COUNT);
    const initial = getConfig().smoothing;
    for (let i = 0; i < this.filters.length; i++) {
      this.filters[i] = new OneEuroFilter({ ...initial });
    }
  }

  reset(): void {
    for (const f of this.filters) f.reset();
    this.prev = null;
    this.prevTimeMs = 0;
    this.topology.reset();
  }

  /** Anomalies detected by the post-filter topology pass on the last frame. */
  lastAnomalyCount(): number { return this.topology.anomalyCount(); }

  smooth(raw: Landmarks, timestampMs: number): Landmark[] {
    const cfg = this.getConfig();
    for (const f of this.filters) f.setOptions(cfg.smoothing);

    const dt = this.prevTimeMs > 0 ? Math.max(1e-3, (timestampMs - this.prevTimeMs) / 1000) : 1 / 30;
    const maxJump = cfg.velocityGate.maxNormPerSecond * dt;

    // 1. Velocity gate (per-axis, lenient now that topology fixes the rest).
    const gated: Landmark[] = new Array(LANDMARK_COUNT);
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const lm = raw[i];
      const prev = this.prev?.[i];
      if (!lm) {
        gated[i] = prev ?? { x: 0, y: 0, z: 0 };
        continue;
      }
      let x = lm.x, y = lm.y, z = lm.z;
      if (prev) {
        const jump = Math.hypot(x - prev.x, y - prev.y, z - prev.z);
        if (jump > maxJump) {
          x = prev.x; y = prev.y; z = prev.z;
        }
      }
      gated[i] = { x, y, z };
    }

    // 2. Topology fix on the raw side — feeds the filter clean lengths
    //    and updates the per-bone reference EMA from observation.
    const cleanRaw = this.topology.apply(gated, true);

    // 3. One Euro Filter, per landmark per axis.
    const filtered: Landmark[] = new Array(LANDMARK_COUNT);
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const lm = cleanRaw[i]!;
      const fx = this.filters[i * 3]!;
      const fy = this.filters[i * 3 + 1]!;
      const fz = this.filters[i * 3 + 2]!;
      filtered[i] = {
        x: fx.filter(lm.x, timestampMs),
        y: fy.filter(lm.y, timestampMs),
        z: fz.filter(lm.z, timestampMs),
      };
    }

    // 4. Topology fix on the smoothed side — corrects per-axis filter lag.
    //    `updateReference=false` because we don't want filter-induced
    //    artefacts to feed the EMA (step 2 already updated it from raw).
    const cleanSmooth = this.topology.apply(filtered, false);

    this.prev = cleanSmooth;
    this.prevTimeMs = timestampMs;
    return cleanSmooth;
  }
}
