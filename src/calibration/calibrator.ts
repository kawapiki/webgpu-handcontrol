/**
 * Calibration orchestrator. State machine:
 *
 *   idle → countdown → sampling → (next step or phase_done)
 *   phase_done → (next phase's countdown) → … → all_done → idle
 *
 * `step()` is called once per frame from the main loop. While the
 * orchestrator is active, the main loop should NOT step the gesture
 * runtime or scene controller — see `isActive()`.
 */

import { logger } from '../debug/logger.js';
import type { FrameInput } from '../config/types.js';
import { CalibrationOverlay, type OverlayPhaseState } from './overlay.js';
import type { CalibrationPhase, PhaseResult, SampleBins } from './types.js';
import { saveCalibration } from './storage.js';

const COUNTDOWN_MS = 1500;

export type CalibratorEvent =
  | { kind: 'started' }
  | { kind: 'completed'; results: Array<{ phaseLabel: string; result: PhaseResult }> }
  | { kind: 'cancelled' };

export class Calibrator {
  private phases: readonly CalibrationPhase[] = [];
  private phaseIdx = 0;
  private stepIdx = -1; // -1 == before first step / between steps
  private state: OverlayPhaseState = { kind: 'idle' };
  private stepStartedAt = 0;
  private samples: SampleBins = {};
  private allResults: Array<{ phaseLabel: string; result: PhaseResult }> = [];
  private listeners = new Set<(e: CalibratorEvent) => void>();

  constructor(private overlay: CalibrationOverlay) {
    overlay.onCancel    = () => this.cancel();
    overlay.onSkipPhase = () => this.skipPhase();
    overlay.onAccept    = () => this.advancePastReview();
    overlay.onRetryPhase = () => this.retryPhase();
  }

  on(fn: (e: CalibratorEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isActive(): boolean { return this.state.kind !== 'idle'; }

  start(phases: readonly CalibrationPhase[]): void {
    this.phases = phases;
    this.phaseIdx = 0;
    this.stepIdx = -1;
    this.allResults = [];
    this.samples = {};
    logger.info('calibration: starting');
    this.emit({ kind: 'started' });
    this.beginPhase();
  }

  cancel(): void {
    if (!this.isActive()) return;
    this.state = { kind: 'idle' };
    this.overlay.render(this.state);
    logger.info('calibration: cancelled');
    this.emit({ kind: 'cancelled' });
  }

  /** Called once per frame while active. */
  step(input: FrameInput, nowMs: number): void {
    if (this.state.kind === 'countdown') {
      const elapsed = nowMs - this.stepStartedAt;
      const remaining = COUNTDOWN_MS - elapsed;
      if (remaining <= 0) {
        this.beginSampling(nowMs);
      } else {
        const phase = this.phases[this.phaseIdx]!;
        const step = phase.steps[this.stepIdx]!;
        this.state = {
          kind: 'countdown',
          phaseLabel: phase.label,
          phaseIdx: this.phaseIdx,
          phaseCount: this.phases.length,
          stepIdx: this.stepIdx,
          stepCount: phase.steps.length,
          prompt: step.prompt,
          hint: step.hint,
          remainingMs: remaining,
        };
        this.overlay.render(this.state);
      }
    } else if (this.state.kind === 'sampling') {
      const phase = this.phases[this.phaseIdx]!;
      const step = phase.steps[this.stepIdx]!;
      const elapsed = nowMs - this.stepStartedAt;
      const progress = Math.min(1, elapsed / step.durationMs);
      const bin = (this.samples[step.id] ??= []);
      let lastVal = NaN;
      step.sample(input, (v: number) => { bin.push(v); lastVal = v; });
      this.state = {
        kind: 'sampling',
        phaseLabel: phase.label,
        phaseIdx: this.phaseIdx,
        phaseCount: this.phases.length,
        stepIdx: this.stepIdx,
        stepCount: phase.steps.length,
        prompt: step.prompt,
        hint: step.hint,
        progress,
        live: Number.isFinite(lastVal) ? lastVal : (bin[bin.length - 1] ?? 0),
        samples: bin.length,
      };
      this.overlay.render(this.state);
      if (progress >= 1) this.advanceStep();
    }
    // countdown / sampling are the only frame-driven states; the rest are
    // user-button-driven and rendered when their state is set.
  }

  private beginPhase(): void {
    if (this.phaseIdx >= this.phases.length) {
      this.finish();
      return;
    }
    this.stepIdx = 0;
    this.samples = {};
    this.startCountdown();
  }

  private startCountdown(): void {
    this.stepStartedAt = performance.now();
    const phase = this.phases[this.phaseIdx]!;
    const step = phase.steps[this.stepIdx]!;
    this.state = {
      kind: 'countdown',
      phaseLabel: phase.label,
      phaseIdx: this.phaseIdx,
      phaseCount: this.phases.length,
      stepIdx: this.stepIdx,
      stepCount: phase.steps.length,
      prompt: step.prompt,
      hint: step.hint,
      remainingMs: COUNTDOWN_MS,
    };
    this.overlay.render(this.state);
  }

  private beginSampling(nowMs: number): void {
    this.stepStartedAt = nowMs;
    const phase = this.phases[this.phaseIdx]!;
    const step = phase.steps[this.stepIdx]!;
    this.state = {
      kind: 'sampling',
      phaseLabel: phase.label,
      phaseIdx: this.phaseIdx,
      phaseCount: this.phases.length,
      stepIdx: this.stepIdx,
      stepCount: phase.steps.length,
      prompt: step.prompt,
      hint: step.hint,
      progress: 0,
      live: 0,
      samples: 0,
    };
    this.overlay.render(this.state);
  }

  private advanceStep(): void {
    const phase = this.phases[this.phaseIdx]!;
    if (this.stepIdx + 1 < phase.steps.length) {
      this.stepIdx++;
      this.startCountdown();
    } else {
      this.completePhase();
    }
  }

  private completePhase(): void {
    const phase = this.phases[this.phaseIdx]!;
    const result = phase.compute(this.samples);
    this.allResults.push({ phaseLabel: phase.label, result });
    logger.info(`calibration ${phase.label}: ${result.confident ? 'confident' : 'low confidence'} (sep ${(result.separation * 100).toFixed(0)}%)`);
    for (const a of result.applied) {
      logger.info(`  ${a.key}: ${a.before.toFixed(3)} → ${a.after.toFixed(3)}`);
    }
    this.state = {
      kind: 'phase_done',
      phaseLabel: phase.label,
      phaseIdx: this.phaseIdx,
      phaseCount: this.phases.length,
      result,
    };
    this.overlay.render(this.state);
  }

  private advancePastReview(): void {
    if (this.state.kind === 'phase_done') {
      this.phaseIdx++;
      this.beginPhase();
    } else if (this.state.kind === 'all_done') {
      this.state = { kind: 'idle' };
      this.overlay.render(this.state);
    }
  }

  private retryPhase(): void {
    if (this.state.kind !== 'phase_done') return;
    // Drop the result we just appended for this phase, then re-enter it.
    this.allResults.pop();
    this.beginPhase();
  }

  private skipPhase(): void {
    if (!this.isActive()) return;
    this.phaseIdx++;
    this.beginPhase();
  }

  private finish(): void {
    saveCalibration();
    this.state = { kind: 'all_done', results: this.allResults };
    this.overlay.render(this.state);
    logger.info('calibration: complete, saved to cookie');
    this.emit({ kind: 'completed', results: this.allResults });
  }

  private emit(e: CalibratorEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}
