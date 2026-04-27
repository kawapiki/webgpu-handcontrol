/**
 * One Euro Filter — the de-facto standard for smoothing noisy real-time
 * landmark data. It's a low-pass filter with adaptive cutoff frequency:
 * when motion is slow it smooths aggressively (kills jitter), when motion
 * is fast it relaxes (kills lag).
 *
 * Reference: Géry Casiez et al., "1€ Filter: A Simple Speed-based Low-pass
 * Filter for Noisy Input in Interactive Systems", CHI 2012.
 *
 * Tunables (see config/parameters.ts):
 *   minCutoff — baseline cutoff (Hz). Lower = smoother, more lag.
 *   beta      — speed coefficient. Higher = follows fast moves better.
 *   dCutoff   — cutoff for the velocity estimate (usually 1.0).
 */

export interface OneEuroOptions {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1.0 / (2 * Math.PI * cutoff);
  return 1.0 / (1.0 + tau / dt);
}

function lowPass(prev: number, x: number, a: number): number {
  return a * x + (1 - a) * prev;
}

export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(private opts: OneEuroOptions) {}

  /** Update tunables live without resetting state. */
  setOptions(opts: OneEuroOptions): void {
    this.opts = opts;
  }

  /** Reset internal state — call when the signal source disappears (e.g. hand lost). */
  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = 0;
  }

  /** Filter one sample. `tMs` is a monotonically-increasing timestamp in milliseconds. */
  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;

    const dx = (x - this.xPrev) / dt;
    const aD = alpha(this.opts.dCutoff, dt);
    const dxHat = lowPass(this.dxPrev, dx, aD);
    this.dxPrev = dxHat;

    const cutoff = this.opts.minCutoff + this.opts.beta * Math.abs(dxHat);
    const a = alpha(cutoff, dt);
    const xHat = lowPass(this.xPrev, x, a);
    this.xPrev = xHat;
    return xHat;
  }
}
