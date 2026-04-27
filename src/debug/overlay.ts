/**
 * 2D landmark overlay over the camera preview. Draws bones + joints.
 * If `showRawLandmarks` is on, also draws the unfiltered points as
 * faint ghosts — useful for visualising filter lag.
 */

import { params } from '../config/parameters.js';
import type { HandFrame } from '../config/types.js';

const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [0, 9], [9, 10], [10, 11], [11, 12],     // middle
  [0, 13], [13, 14], [14, 15], [15, 16],   // ring
  [0, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [5, 9], [9, 13], [13, 17],               // palm web
];

const HAND_COLOURS: Record<string, string> = {
  Left: '#4ad295',
  Right: '#f0b429',
  Unknown: '#8a8a8a',
};

export class LandmarkOverlay {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('overlay: 2d context unavailable');
    this.ctx = ctx;
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(hands: HandFrame[]): void {
    const { ctx, canvas } = this;
    const w = canvas.width / Math.min(window.devicePixelRatio, 2);
    const h = canvas.height / Math.min(window.devicePixelRatio, 2);
    ctx.clearRect(0, 0, w, h);
    if (!params.debug.showLandmarks) return;

    for (const hand of hands) {
      const colour = HAND_COLOURS[hand.handedness] ?? HAND_COLOURS.Unknown!;

      // Bones
      ctx.lineWidth = 2;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        const la = hand.landmarks[a];
        const lb = hand.landmarks[b];
        if (!la || !lb) continue;
        ctx.moveTo(la.x * w, la.y * h);
        ctx.lineTo(lb.x * w, lb.y * h);
      }
      ctx.stroke();

      // Joints
      ctx.fillStyle = colour;
      for (const lm of hand.landmarks) {
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Raw landmarks (ghost)
      if (params.debug.showRawLandmarks) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        for (const lm of hand.rawLandmarks) {
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Hand label
      const wrist = hand.landmarks[0];
      if (wrist) {
        ctx.fillStyle = colour;
        ctx.font = '12px ui-monospace';
        ctx.textBaseline = 'top';
        ctx.fillText(`${hand.handedness} #${hand.id} ${(hand.score * 100).toFixed(0)}%`, wrist.x * w + 6, wrist.y * h + 6);
      }
    }
  }
}
