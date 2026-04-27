/**
 * Lightweight FPS and inference-time meter. Updates the HUD strings in
 * place; no DOM allocations in the hot path.
 */

export class Stats {
  private fpsEl: HTMLElement;
  private inferEl: HTMLElement;
  private handsEl: HTMLElement;

  private frames = 0;
  private lastEmit = 0;
  private inferAccum = 0;
  private inferSamples = 0;

  constructor(fpsEl: HTMLElement, inferEl: HTMLElement, handsEl: HTMLElement) {
    this.fpsEl = fpsEl;
    this.inferEl = inferEl;
    this.handsEl = handsEl;
  }

  recordFrame(inferMs: number, handCount: number): void {
    this.frames++;
    this.inferAccum += inferMs;
    this.inferSamples++;
    const now = performance.now();
    if (this.lastEmit === 0) this.lastEmit = now;
    if (now - this.lastEmit >= 500) {
      const fps = (this.frames * 1000) / (now - this.lastEmit);
      const avgInfer = this.inferSamples > 0 ? this.inferAccum / this.inferSamples : 0;
      this.fpsEl.textContent = `${fps.toFixed(0)} fps`;
      this.inferEl.textContent = `${avgInfer.toFixed(1)} ms inference`;
      this.frames = 0;
      this.inferAccum = 0;
      this.inferSamples = 0;
      this.lastEmit = now;
    }
    this.handsEl.textContent = `${handCount} hand${handCount === 1 ? '' : 's'}`;
  }
}
