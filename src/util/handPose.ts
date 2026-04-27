/**
 * Hand-pose extractor: cheap orientation signals from MediaPipe landmarks.
 *
 * Two angles are produced, both designed to be **2D-image-stable** so that
 * MediaPipe's noisy z values don't dominate:
 *
 *   roll  — angle of the knuckle ridge (lm5 → lm17) in the image plane.
 *           Twisting your forearm spins this line. Sign convention:
 *           positive roll = clockwise *as the user sees it* (the camera is
 *           CSS-mirrored, so we negate the raw atan2 sign).
 *
 *   pitch — depth difference between the middle-MCP (lm9) and the wrist
 *           (lm0). When the wrist bends toward camera, lm9.z drops below
 *           lm0.z (more negative); when it bends away, the reverse. We
 *           normalize by hand size so it's invariant to how close the
 *           hand is to the camera.
 *
 * Coverage is intentionally limited to roll + pitch — these are the two
 * axes that feel like "wrist gestures" in real life. Yaw (rotating the
 * hand around the vertical hand axis) is omitted because it's noisy in
 * 2D-only signals and rarely natural for the user to perform mid-air.
 */

import type { Landmarks, Vec3 } from '../config/types.js';
import { LM, dist } from './geometry.js';

export interface HandPose {
  /** Anatomical center: midpoint of wrist and middle-MCP. */
  palmCenter: Vec3;
  /** Knuckle-ridge angle (rad), user-frame (positive = clockwise as user sees). */
  roll: number;
  /** Wrist-bend depth signal (unitless, normalized by hand scale). */
  pitch: number;
  /** Hand size: |wrist → middle-MCP|. Useful as a normalizer. */
  scale: number;
}

export function extractHandPose(lms: Landmarks): HandPose | null {
  const wrist = lms[LM.WRIST];
  const indexMcp = lms[LM.INDEX_MCP];
  const middleMcp = lms[LM.MIDDLE_MCP];
  const pinkyMcp = lms[LM.PINKY_MCP];
  if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) return null;

  const scale = Math.max(1e-3, dist(wrist, middleMcp));

  // Image-plane angle of the knuckle ridge (lm5 → lm17). The CSS mirror
  // flips x, so to report a "user-frame" angle we negate the raw x-delta.
  const dx = -(pinkyMcp.x - indexMcp.x);
  const dy = pinkyMcp.y - indexMcp.y;
  const roll = Math.atan2(dy, dx);

  // Depth signal: how much further/closer middle-MCP is than wrist.
  // Negative MediaPipe z is *toward* camera; we flip sign so positive
  // pitch = wrist bent so palm faces upward (toward camera).
  const pitch = -(middleMcp.z - wrist.z) / scale;

  if (!Number.isFinite(roll) || !Number.isFinite(pitch)) return null;

  const palmCenter: Vec3 = {
    x: (wrist.x + middleMcp.x) * 0.5,
    y: (wrist.y + middleMcp.y) * 0.5,
    z: (wrist.z + middleMcp.z) * 0.5,
  };

  return { palmCenter, roll, pitch, scale };
}

/**
 * Wrap an angular delta into (-π, π]. Constant time — no `while` loop, so
 * non-finite or huge inputs can't hang the frame.
 */
export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const TWO_PI = 2 * Math.PI;
  return ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}
