/**
 * Pure geometric helpers — no DOM, no Three.js. All functions are pure.
 *
 * MediaPipe landmark indices (canonical):
 *   0 wrist
 *   1-4   thumb (CMC, MCP, IP, TIP)
 *   5-8   index (MCP, PIP, DIP, TIP)
 *   9-12  middle
 *   13-16 ring
 *   17-20 pinky
 */

import type { HandMetrics, Landmark, Landmarks, Vec3 } from '../config/types.js';

export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

const FINGER_CHAINS: readonly (readonly [number, number, number, number])[] = [
  [1, 2, 3, 4],     // thumb
  [5, 6, 7, 8],     // index
  [9, 10, 11, 12],  // middle
  [13, 14, 15, 16], // ring
  [17, 18, 19, 20], // pinky
];

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  return len < 1e-9 ? { x: 0, y: 0, z: 0 } : scale(v, 1 / len);
}

export function dist(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/**
 * Curl heuristic for a single finger. Returns 0 (extended) → 1 (curled).
 *
 * Implementation: compute the angle at the PIP joint via the dot product of
 * the proximal and distal segment vectors, then map cos(angle) ∈ [-1, 1]
 * to a 0..1 curl value. A straight finger has angle ≈ 0 (cos≈1, curl=0);
 * a fully-curled finger approaches angle ≈ π (cos≈-1, curl=1).
 */
function fingerCurl(lms: Landmarks, chain: readonly [number, number, number, number]): number {
  const [a, b, c, d] = chain;
  const lmA = lms[a], lmB = lms[b], lmC = lms[c], lmD = lms[d];
  if (!lmA || !lmB || !lmC || !lmD) return 0;
  const v1 = normalize(sub(lmB, lmA));
  const v2 = normalize(sub(lmC, lmB));
  const v3 = normalize(sub(lmD, lmC));
  // average of the two joint angles → more stable than a single joint
  const cos1 = dot(v1, v2);
  const cos2 = dot(v2, v3);
  const avgCos = (cos1 + cos2) * 0.5;
  // map cos: 1 → 0, -1 → 1
  return Math.min(1, Math.max(0, (1 - avgCos) * 0.5));
}

/** Compute all the per-frame metrics gestures need. */
export function computeHandMetrics(lms: Landmarks): HandMetrics {
  const wrist = lms[LM.WRIST];
  const middleMcp = lms[LM.MIDDLE_MCP];
  const thumbTip = lms[LM.THUMB_TIP];
  const indexTip = lms[LM.INDEX_TIP];
  const indexMcp = lms[LM.INDEX_MCP];

  if (!wrist || !middleMcp || !thumbTip || !indexTip || !indexMcp) {
    return {
      scale: 1,
      curl: [0, 0, 0, 0, 0],
      pinch: 1,
      palm: { x: 0.5, y: 0.5, z: 0 },
      indexDir: { x: 0, y: -1, z: 0 },
    };
  }

  const handScale = Math.max(1e-3, dist(wrist, middleMcp));

  const curl: HandMetrics['curl'] = [
    fingerCurl(lms, FINGER_CHAINS[0]!),
    fingerCurl(lms, FINGER_CHAINS[1]!),
    fingerCurl(lms, FINGER_CHAINS[2]!),
    fingerCurl(lms, FINGER_CHAINS[3]!),
    fingerCurl(lms, FINGER_CHAINS[4]!),
  ];

  const pinch = dist(thumbTip, indexTip) / handScale;

  // palm centre = mean of wrist and the four MCPs
  const ringMcp = lms[LM.RING_MCP] ?? middleMcp;
  const pinkyMcp = lms[LM.PINKY_MCP] ?? middleMcp;
  const palm: Vec3 = {
    x: (wrist.x + indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 5,
    y: (wrist.y + indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 5,
    z: (wrist.z + indexMcp.z + middleMcp.z + ringMcp.z + pinkyMcp.z) / 5,
  };

  const indexDir = normalize(sub(indexTip, indexMcp));

  return { scale: handScale, curl, pinch, palm, indexDir };
}

/** Counts how many of the 4 non-thumb fingers are extended (curl < threshold). */
export function countExtendedFingers(metrics: HandMetrics, extendedMax: number): number {
  let n = 0;
  for (let i = 1; i < 5; i++) {
    const c = metrics.curl[i];
    if (c !== undefined && c < extendedMax) n++;
  }
  return n;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp to [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Image-space (mirrored) Vec3 → Three.js world space helper. The tracker
 *  returns x,y in [0,1] from the *un-mirrored* model. The video element is
 *  mirrored via CSS, so for an intuitive mapping we flip x here. */
export function imageToWorld2D(p: Landmark): { x: number; y: number; z: number } {
  return {
    x: (1 - p.x) * 2 - 1,
    y: -(p.y * 2 - 1),
    z: -p.z, // closer to camera → larger z in world
  };
}
