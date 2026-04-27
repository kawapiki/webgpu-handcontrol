/**
 * DOM overlay for the calibration wizard. Pure rendering — orchestration
 * (state, sampling, threshold derivation) lives in `calibrator.ts`.
 *
 * Layout: a centred card that sits above the camera preview but below the
 * Tweakpane, with a big prompt, hint line, progress bar, live metric
 * readout, and skip / cancel buttons.
 */

import type { AppliedTuning, PhaseResult } from './types.js';

export type OverlayPhaseState =
  | { kind: 'idle' }
  | { kind: 'countdown'; phaseLabel: string; phaseIdx: number; phaseCount: number; stepIdx: number; stepCount: number; prompt: string; hint: string; remainingMs: number }
  | { kind: 'sampling';  phaseLabel: string; phaseIdx: number; phaseCount: number; stepIdx: number; stepCount: number; prompt: string; hint: string; progress: number; live: number; samples: number }
  | { kind: 'phase_done'; phaseLabel: string; phaseIdx: number; phaseCount: number; result: PhaseResult }
  | { kind: 'all_done'; results: Array<{ phaseLabel: string; result: PhaseResult }> };

export class CalibrationOverlay {
  private root: HTMLElement;
  private cardEl: HTMLElement;
  private titleEl: HTMLElement;
  private promptEl: HTMLElement;
  private hintEl: HTMLElement;
  private progressEl: HTMLElement;
  private liveEl: HTMLElement;
  private actionEl: HTMLElement;

  /** Click handlers — set by the calibrator. */
  onCancel: () => void = () => {};
  onSkipPhase: () => void = () => {};
  onAccept: () => void = () => {};
  onRetryPhase: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('hidden');

    this.cardEl    = this.root.querySelector('.cal-card')!;
    this.titleEl   = this.root.querySelector('.cal-title')!;
    this.promptEl  = this.root.querySelector('.cal-prompt')!;
    this.hintEl    = this.root.querySelector('.cal-hint')!;
    this.progressEl = this.root.querySelector('.cal-progress > span')!;
    this.liveEl    = this.root.querySelector('.cal-live')!;
    this.actionEl  = this.root.querySelector('.cal-actions')!;
  }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  render(state: OverlayPhaseState): void {
    if (state.kind === 'idle') {
      this.hide();
      return;
    }
    this.show();

    if (state.kind === 'countdown' || state.kind === 'sampling') {
      this.titleEl.textContent = `Calibration · gesture ${state.phaseIdx + 1} of ${state.phaseCount} — ${state.phaseLabel}`;
      this.promptEl.textContent = state.prompt;
      this.hintEl.textContent = state.hint || '';
    }

    if (state.kind === 'countdown') {
      const seconds = Math.ceil(state.remainingMs / 1000);
      this.cardEl.dataset.kind = 'countdown';
      this.progressEl.style.width = '0%';
      this.liveEl.textContent = `Get ready… ${seconds}`;
      this.actionEl.innerHTML = '';
      this.addAction('Skip gesture', () => this.onSkipPhase());
      this.addAction('Cancel', () => this.onCancel(), 'secondary');
    } else if (state.kind === 'sampling') {
      this.cardEl.dataset.kind = 'sampling';
      this.progressEl.style.width = `${(state.progress * 100).toFixed(0)}%`;
      this.liveEl.textContent = `live: ${state.live.toFixed(2)}   samples: ${state.samples}`;
      this.actionEl.innerHTML = '';
      this.addAction('Skip gesture', () => this.onSkipPhase());
      this.addAction('Cancel', () => this.onCancel(), 'secondary');
    } else if (state.kind === 'phase_done') {
      this.cardEl.dataset.kind = 'review';
      this.titleEl.textContent = `Review · ${state.phaseLabel}`;
      this.promptEl.textContent = state.result.confident
        ? 'Looks rock solid.'
        : 'Distributions overlap — recommend retry.';
      this.hintEl.textContent = `separation: ${(state.result.separation * 100).toFixed(0)}%`;
      this.progressEl.style.width = '100%';
      this.liveEl.textContent = formatApplied(state.result.applied) + (state.result.notes.length ? `\n${state.result.notes.join('\n')}` : '');
      this.actionEl.innerHTML = '';
      this.addAction('Continue', () => this.onAccept());
      this.addAction('Retry', () => this.onRetryPhase(), 'secondary');
    } else {
      this.cardEl.dataset.kind = 'done';
      this.titleEl.textContent = 'Calibration complete';
      this.promptEl.textContent = 'You\'re tuned. Saved to a cookie — you won\'t need to redo this on next visit.';
      this.hintEl.textContent = '';
      this.progressEl.style.width = '100%';
      this.liveEl.textContent = state.results.map((r) => `${r.phaseLabel}: ${r.result.confident ? 'OK' : 'low confidence'} (${(r.result.separation*100).toFixed(0)}%)`).join('\n');
      this.actionEl.innerHTML = '';
      this.addAction('Done', () => this.onAccept());
    }
  }

  private addAction(label: string, fn: () => void, variant?: 'secondary'): void {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (variant) btn.classList.add(variant);
    btn.addEventListener('click', fn);
    this.actionEl.appendChild(btn);
  }
}

function formatApplied(applied: AppliedTuning[]): string {
  return applied.map((a) => `${a.key}: ${a.before.toFixed(3)} → ${a.after.toFixed(3)}`).join('\n');
}
