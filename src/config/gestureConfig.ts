/**
 * Library-scope configuration for the gesture pipeline. This is the
 * exact set of knobs the published npm package exposes — nothing more,
 * nothing less. Each gesture detector and the smoother / tracker read
 * from a fresh `GestureConfig` snapshot every frame, so live tuning
 * is supported without re-instantiation.
 *
 * The app-side `Parameters` type (in `parameters.ts`) is a structural
 * superset of this: it adds scene-, debug-, depth-, and object-rotate
 * groups that the lib doesn't care about. Because TypeScript is
 * structurally typed, app code can pass `() => params` straight through
 * as a `() => GestureConfig`.
 */

export interface SmoothingConfig {
  /** One Euro Filter: minimum cutoff (Hz). Lower = smoother but laggier. */
  minCutoff: number;
  /** One Euro Filter: speed coefficient. Higher = follows fast moves better. */
  beta: number;
  /** One Euro Filter: derivative cutoff (Hz). */
  dCutoff: number;
}

export interface VelocityGateConfig {
  /** Reject any landmark jump greater than this fraction of image width per second. */
  maxNormPerSecond: number;
}

export interface DetectionConfig {
  /** Minimum model confidence to keep a detected hand. */
  minHandScore: number;
  /** Maximum number of hands to track. */
  maxHands: number;
}

export interface PinchConfig {
  enter: number;
  exit: number;
  tapHoldMs: number;
  tapCooldownMs: number;
}

export interface PointConfig {
  indexExtendedMax: number;
  othersCurledMin: number;
  holdMs: number;
}

export interface OpenPalmConfig {
  maxCurl: number;
  holdMs: number;
}

export interface TwoHandConfig {
  minBothScore: number;
  zoomDeadzone: number;
  rotateDeadzone: number;
  rotateHoldMs: number;
  rotateSmoothing: number;
  rotateMaxStep: number;
}

export interface GestureConfig {
  smoothing: SmoothingConfig;
  velocityGate: VelocityGateConfig;
  detection: DetectionConfig;
  pinch: PinchConfig;
  point: PointConfig;
  openPalm: OpenPalmConfig;
  twoHand: TwoHandConfig;
}

export const defaultGestureConfig: GestureConfig = {
  smoothing: { minCutoff: 1.0, beta: 0.05, dCutoff: 1.0 },
  velocityGate: { maxNormPerSecond: 25.0 },
  detection: { minHandScore: 0.5, maxHands: 2 },
  pinch: { enter: 0.35, exit: 0.55, tapHoldMs: 80, tapCooldownMs: 250 },
  point: { indexExtendedMax: 0.25, othersCurledMin: 0.55, holdMs: 80 },
  openPalm: { maxCurl: 0.2, holdMs: 150 },
  twoHand: {
    minBothScore: 0.6,
    zoomDeadzone: 0.005,
    rotateDeadzone: 0.005,
    rotateHoldMs: 80,
    rotateSmoothing: 0.35,
    rotateMaxStep: 0.5,
  },
};
