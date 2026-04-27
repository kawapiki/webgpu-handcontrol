/**
 * Calibration types.
 *
 * The wizard is structured as PHASES (one per gesture) → STEPS (one per
 * "do / release" prompt). Each step samples a single scalar metric for a
 * fixed duration. After a phase completes, its `compute()` derives
 * thresholds from the accumulated samples and writes them into `params`.
 *
 * Keep this file dependency-free so `scripts.ts` can be edited without
 * pulling in scene/Three.js code.
 */

import type { FrameInput } from '../config/types.js';

/** Captured samples keyed by step id within a phase. */
export type SampleBins = Record<string, number[]>;

export interface CalibrationStep {
  /** Stable id used as the key in SampleBins. */
  readonly id: string;
  /** Big prompt shown to the user during this step. */
  readonly prompt: string;
  /** Smaller hint shown under the prompt. */
  readonly hint: string;
  /** Sampling window length, in ms (excludes the pre-roll countdown). */
  readonly durationMs: number;
  /**
   * Per-frame sampler. Called only during the active sampling window
   * (not during the countdown). Should push 0..N numbers per frame into
   * the bin — typically 1 per detected hand. Skipping when no hand is
   * present is fine; the orchestrator tolerates short bins.
   */
  sample(input: FrameInput, push: (value: number) => void): void;
}

export interface AppliedTuning {
  /** Dotted path inside `params`, e.g. "pinch.enter". */
  key: string;
  before: number;
  after: number;
}

export interface PhaseResult {
  /** True if the on/off distributions are well-separated. */
  confident: boolean;
  /** 0..1 separation score (higher = better). */
  separation: number;
  applied: AppliedTuning[];
  notes: string[];
}

export interface CalibrationPhase {
  /** Stable id (used in saved profile). */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Steps run in order. */
  readonly steps: readonly CalibrationStep[];
  /**
   * Given the accumulated samples for every step in this phase, compute
   * the new tuning values and write them into `params`. Return the
   * before/after values plus a confidence summary.
   */
  compute(samples: SampleBins): PhaseResult;
}
