/**
 * Depth estimation from hand-image size.
 *
 * Idea: a hand has a fairly fixed physical size (~18 cm wrist-to-knuckles).
 * The 2D image-plane distance between the wrist (lm0) and the middle-MCP
 * (lm9) is therefore inversely proportional to the hand's distance from
 * the camera. Bigger image size = closer to camera; smaller = farther.
 *
 * Mapping (linear in *ratio*):
 *
 *   ratio = imageSize / referenceScale
 *   depth = baseDepth + gain * (ratio - 1)
 *   depth ← clamp(depth, min, max)
 *
 * Properties:
 *   - At reference size, depth equals baseDepth.
 *   - Bigger hand (arm forward, close to camera) → ratio > 1 → depth grows.
 *     The cursor / grabbed object pushes deeper into the scene, away
 *     from the user.
 *   - Smaller hand (arm pulled back) → ratio < 1 → depth shrinks. Items
 *     come forward, closer to the user.
 *   - The user can flip this by setting gain negative (Tweakpane).
 *
 * Why image-plane (XY) only — not 3D (XYZ)? MediaPipe's z is a relative
 * depth signal that's noisier than XY by an order of magnitude. The 2D
 * size is much more stable and physically meaningful as a distance proxy.
 */

import { params } from '../config/parameters.js';
import type { Landmarks } from '../config/types.js';
import { clamp } from '../util/geometry.js';

/** 2D image-plane distance between wrist and middle-MCP, in normalized [0,1] units. */
export function imageHandSize(landmarks: Landmarks): number {
  const w = landmarks[0];
  const m = landmarks[9];
  if (!w || !m) return params.depth.referenceScale;
  return Math.hypot(w.x - m.x, w.y - m.y);
}

/** Estimate world-space depth (units along ray from camera) from this hand's image size. */
export function estimateDepth(landmarks: Landmarks): number {
  const ratio = handSizeRatio(landmarks);
  const depth = params.depth.baseDepth + params.depth.gain * (ratio - 1);
  return clamp(depth, params.depth.min, params.depth.max);
}

/** Hand size relative to the reference scale. >1 = closer than reference, <1 = farther. */
export function handSizeRatio(landmarks: Landmarks): number {
  const sz = Math.max(0.01, imageHandSize(landmarks));
  return sz / Math.max(0.01, params.depth.referenceScale);
}
