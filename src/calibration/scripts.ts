/**
 * Calibration scripts for the three baseline gestures: pinch, point, grab.
 *
 * Pattern: each phase alternates "DO" and "RELAX" steps so we capture both
 * tails of the distribution. After all steps, the phase's `compute()`
 * derives hysteresis thresholds from observed quantiles.
 *
 * Threshold derivation rule: given an "on" sample distribution and an
 * "off" distribution, with `on_high = quantile(on, 0.85)` and
 * `off_low = quantile(off, 0.15)`, set:
 *   gap   = off_low - on_high           (only meaningful if positive)
 *   enter = on_high + 0.30 * gap        (snappy to engage)
 *   exit  = on_high + 0.70 * gap        (slow to release — hysteresis)
 * The same formula works for any metric where ON < OFF (pinch, index curl).
 * For metrics where ON > OFF (mean curl in grab) we flip the roles.
 *
 * Confidence = clamp01(gap / median_dispersion). >= 0.6 considered "rock solid".
 */

import { params } from '../config/parameters.js';
import type { FrameInput } from '../config/types.js';
import type { CalibrationPhase, CalibrationStep, PhaseResult, SampleBins } from './types.js';

const STEP_DURATION = 2200;

function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const arr = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(arr.length - 1, Math.round((arr.length - 1) * q)));
  return arr[idx]!;
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Inter-quartile range — robust dispersion measure. */
function iqr(values: number[]): number {
  return Math.max(1e-6, quantile(values, 0.75) - quantile(values, 0.25));
}

interface DerivedThresholds {
  enter: number;
  exit: number;
  separation: number;
  notes: string[];
}

/**
 * Derive enter/exit thresholds from on-distribution + off-distribution.
 * `direction` says whether the metric is *smaller* during the gesture
 * (e.g. pinch distance) or *larger* (e.g. fist curl).
 */
function deriveThresholds(on: number[], off: number[], direction: 'lt' | 'gt'): DerivedThresholds {
  const notes: string[] = [];
  if (on.length < 5 || off.length < 5) {
    notes.push(`few samples (on=${on.length} off=${off.length}); thresholds may be loose`);
  }
  const onHigh = direction === 'lt' ? quantile(on, 0.85) : quantile(on, 0.15);
  const offLow = direction === 'lt' ? quantile(off, 0.15) : quantile(off, 0.85);
  const gap = direction === 'lt' ? offLow - onHigh : onHigh - offLow;
  const dispersion = (iqr(on) + iqr(off)) * 0.5;
  const separation = Math.max(0, Math.min(1, gap / Math.max(1e-3, dispersion * 4)));

  if (gap <= 0) {
    notes.push('on/off distributions overlap — gesture may misfire; consider re-running');
  }

  let enter: number, exit: number;
  if (direction === 'lt') {
    enter = onHigh + 0.30 * gap;
    exit  = onHigh + 0.70 * gap;
  } else {
    enter = onHigh - 0.30 * gap;
    exit  = onHigh - 0.70 * gap;
  }
  return { enter, exit, separation, notes };
}

// ---------- pinch ----------

function samplePinch(input: FrameInput, push: (v: number) => void): void {
  for (const hand of input.hands) push(hand.metrics.pinch);
}

const pinchSteps: CalibrationStep[] = [
  { id: 'off1', prompt: 'Hold your hand relaxed', hint: 'Show one open or loose hand to the camera. Don\'t pinch.', durationMs: STEP_DURATION, sample: samplePinch },
  { id: 'on1',  prompt: 'PINCH — touch thumb to index finger', hint: 'Hold the pinch firmly until the bar fills.', durationMs: STEP_DURATION, sample: samplePinch },
  { id: 'off2', prompt: 'Release — relax your hand again', hint: 'Open the pinch fully.', durationMs: STEP_DURATION, sample: samplePinch },
  { id: 'on2',  prompt: 'PINCH again', hint: 'Hold the pinch firmly.', durationMs: STEP_DURATION, sample: samplePinch },
];

const pinchPhase: CalibrationPhase = {
  id: 'pinch',
  label: 'Pinch (thumb-to-index)',
  steps: pinchSteps,
  compute(samples: SampleBins): PhaseResult {
    const off = [...(samples['off1'] ?? []), ...(samples['off2'] ?? [])];
    const on  = [...(samples['on1']  ?? []), ...(samples['on2']  ?? [])];
    const { enter, exit, separation, notes } = deriveThresholds(on, off, 'lt');
    const before = { enter: params.pinch.enter, exit: params.pinch.exit };
    if (Number.isFinite(enter) && Number.isFinite(exit) && enter < exit) {
      params.pinch.enter = clamp(enter, 0.05, 0.9);
      params.pinch.exit  = clamp(exit,  params.pinch.enter + 0.02, 1.4);
    } else {
      notes.push('skipping apply: invalid enter/exit values');
    }
    return {
      confident: separation >= 0.6,
      separation,
      applied: [
        { key: 'pinch.enter', before: before.enter, after: params.pinch.enter },
        { key: 'pinch.exit',  before: before.exit,  after: params.pinch.exit  },
      ],
      notes,
    };
  },
};

// ---------- point ----------
//
// We sample two metrics: the index-finger curl (must be small when pointing)
// and the *minimum* of the other-three curls (must all be large when
// pointing). Two thresholds are tuned: indexExtendedMax and othersCurledMin.

function sampleIndexCurl(input: FrameInput, push: (v: number) => void): void {
  for (const hand of input.hands) {
    const c = hand.metrics.curl[1];
    if (c !== undefined) push(c);
  }
}
function sampleOthersMinCurl(input: FrameInput, push: (v: number) => void): void {
  for (const hand of input.hands) {
    const m = hand.metrics.curl[2] ?? 0;
    const r = hand.metrics.curl[3] ?? 0;
    const p = hand.metrics.curl[4] ?? 0;
    push(Math.min(m, r, p));
  }
}

const pointSteps: CalibrationStep[] = [
  { id: 'idx_off', prompt: 'Hold your hand open or loose', hint: 'Index finger relaxed (curled or extended is fine). We measure both phases separately.', durationMs: STEP_DURATION,
    sample: (i, p) => { sampleIndexCurl(i, p); } },
  { id: 'idx_on',  prompt: 'POINT — index finger straight, others curled', hint: 'Like pointing at a screen.', durationMs: STEP_DURATION,
    sample: (i, p) => { sampleIndexCurl(i, p); } },
  { id: 'oth_off', prompt: 'Open your whole hand wide', hint: 'All fingers extended. We need a baseline for "non-curled" fingers.', durationMs: STEP_DURATION,
    sample: (i, p) => { sampleOthersMinCurl(i, p); } },
  { id: 'oth_on',  prompt: 'POINT again — only index extended', hint: 'Make sure middle / ring / pinky are firmly curled.', durationMs: STEP_DURATION,
    sample: (i, p) => { sampleOthersMinCurl(i, p); } },
];

const pointPhase: CalibrationPhase = {
  id: 'point',
  label: 'Point (index extended)',
  steps: pointSteps,
  compute(samples: SampleBins): PhaseResult {
    const idxOff = samples['idx_off'] ?? [];
    const idxOn  = samples['idx_on']  ?? [];
    const othOff = samples['oth_off'] ?? [];
    const othOn  = samples['oth_on']  ?? [];

    const idxRes = deriveThresholds(idxOn, idxOff, 'lt');
    const othRes = deriveThresholds(othOn, othOff, 'gt');

    const beforeIdx = params.point.indexExtendedMax;
    const beforeOth = params.point.othersCurledMin;

    // For point, we keep a single threshold per metric — set to the *enter*
    // value (the conservative bound). Hysteresis isn't applied to `point`
    // directly; the gesture uses a hold-time debounce instead.
    if (Number.isFinite(idxRes.enter)) params.point.indexExtendedMax = clamp(idxRes.enter, 0.05, 0.6);
    if (Number.isFinite(othRes.enter)) params.point.othersCurledMin  = clamp(othRes.enter, 0.2,  0.95);

    const separation = Math.min(idxRes.separation, othRes.separation);
    return {
      confident: separation >= 0.5,
      separation,
      applied: [
        { key: 'point.indexExtendedMax', before: beforeIdx, after: params.point.indexExtendedMax },
        { key: 'point.othersCurledMin',  before: beforeOth, after: params.point.othersCurledMin  },
      ],
      notes: [...idxRes.notes, ...othRes.notes],
    };
  },
};

// ---------- grab ----------

function sampleMeanCurl(input: FrameInput, push: (v: number) => void): void {
  for (const hand of input.hands) {
    const c = hand.metrics.curl;
    const m = ((c[1] ?? 0) + (c[2] ?? 0) + (c[3] ?? 0) + (c[4] ?? 0)) / 4;
    push(m);
  }
}

const grabSteps: CalibrationStep[] = [
  { id: 'off1', prompt: 'Hold your hand open / relaxed', hint: 'Fingers extended or loose. Definitely NOT a fist.', durationMs: STEP_DURATION, sample: sampleMeanCurl },
  { id: 'on1',  prompt: 'GRAB — close into a tight fist', hint: 'All four fingers curled firmly (thumb position doesn\'t matter).', durationMs: STEP_DURATION, sample: sampleMeanCurl },
  { id: 'off2', prompt: 'Release — open your hand', hint: '', durationMs: STEP_DURATION, sample: sampleMeanCurl },
  { id: 'on2',  prompt: 'GRAB again — tight fist', hint: '', durationMs: STEP_DURATION, sample: sampleMeanCurl },
];

const grabPhase: CalibrationPhase = {
  id: 'grab',
  label: 'Grab (closed fist)',
  steps: grabSteps,
  compute(samples: SampleBins): PhaseResult {
    const off = [...(samples['off1'] ?? []), ...(samples['off2'] ?? [])];
    const on  = [...(samples['on1']  ?? []), ...(samples['on2']  ?? [])];
    const { enter, exit, separation, notes } = deriveThresholds(on, off, 'gt');
    const before = { enter: params.grab.enter, exit: params.grab.exit };
    if (Number.isFinite(enter) && Number.isFinite(exit) && enter > exit) {
      params.grab.enter = clamp(enter, 0.3, 0.98);
      params.grab.exit  = clamp(exit,  0.2, params.grab.enter - 0.02);
    } else {
      notes.push('skipping apply: invalid enter/exit values');
    }
    return {
      confident: separation >= 0.6,
      separation,
      applied: [
        { key: 'grab.enter', before: before.enter, after: params.grab.enter },
        { key: 'grab.exit',  before: before.exit,  after: params.grab.exit  },
      ],
      notes,
    };
  },
};

// ---------- registry ----------

export const calibrationPhases: readonly CalibrationPhase[] = [pinchPhase, pointPhase, grabPhase];

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Median value of a bin — exposed for the live-metric readout in the UI. */
export function debugMedian(values: number[]): number {
  return median(values);
}
