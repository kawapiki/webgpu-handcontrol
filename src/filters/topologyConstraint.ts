/**
 * Bone-length topology constraint — fixes "orphan landmark" artefacts.
 *
 * Why this exists:
 *   The One Euro Filter operates per-axis, per-landmark, independently.
 *   When the underlying model briefly mis-detects a fingertip (or a single
 *   axis fails the velocity gate and gets clamped to the previous value),
 *   that one landmark drifts away from its kinematic neighbours. The chain
 *   topology breaks: bone lengths balloon, joint angles become nonsense,
 *   and metrics that depend on chain geometry (`curl`, `indexDir`,
 *   `palm normal`) get poisoned. Pinch survives because it only reads
 *   distance between two endpoints; point and grab don't.
 *
 * How this fixes it:
 *   For each tracked hand we maintain an EMA of each bone's length. On
 *   every frame we walk the kinematic tree from the wrist outward; for
 *   each bone (parent → child) we replace the child position with
 *   `parent + (child - parent).normalize() * referenceLength`. This
 *   preserves the *direction* of the smoothed signal (the bend) while
 *   restoring the *length* (anatomy). Joint angles are preserved.
 *
 *   The reference is only updated from observations whose bones are
 *   within a sane ratio of the existing reference, so anomalies don't
 *   poison it. On first frame the reference bootstraps from the current
 *   landmarks (any reasonable starting pose works, since bone lengths
 *   are pose-invariant).
 *
 * Apply twice per frame:
 *   1. On raw input, before filtering — gives the filter clean topology.
 *   2. On filtered output — undoes any topology drift the filter induced.
 */

import type { Landmark, Landmarks } from '../config/types.js';

/**
 * Kinematic tree: each chain starts at the wrist (0) and walks out to
 * the fingertip. Index 0 is always the parent of index 1 in the chain,
 * etc., so we can iterate `(prev, curr)` along the array.
 */
const FINGER_CHAINS: ReadonlyArray<readonly number[]> = [
  [0, 1, 2, 3, 4],     // wrist → thumb tip
  [0, 5, 6, 7, 8],     // wrist → index tip
  [0, 9, 10, 11, 12],  // wrist → middle tip
  [0, 13, 14, 15, 16], // wrist → ring tip
  [0, 17, 18, 19, 20], // wrist → pinky tip
];

/** Update the reference only when the observed length is within these bounds of it. */
const REF_UPDATE_LO = 0.7;
const REF_UPDATE_HI = 1.4;
const REF_EMA_ALPHA = 0.05;

/** Anomaly = bone whose length is more than this fraction off reference. */
const ANOMALY_TOLERANCE = 0.35;

function boneKey(a: number, b: number): number { return a * 32 + b; }

export class TopologyConstraint {
  private refLengths = new Map<number, number>();
  private initialized = false;
  private lastAnomalyCount = 0;

  reset(): void {
    this.refLengths.clear();
    this.initialized = false;
    this.lastAnomalyCount = 0;
  }

  /** Number of bones that exceeded the anomaly tolerance the last time `apply` was called. */
  anomalyCount(): number { return this.lastAnomalyCount; }

  /**
   * Run a topology pass over `landmarks`. Returns a new array; never
   * mutates the input. Call with `updateReference=true` for raw input,
   * `updateReference=false` for already-filtered output.
   */
  apply(landmarks: Landmarks, updateReference: boolean): Landmark[] {
    const n = landmarks.length;
    const out: Landmark[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = landmarks[i] ?? { x: 0, y: 0, z: 0 };

    if (!this.initialized) {
      this.bootstrap(out);
      this.initialized = true;
      this.lastAnomalyCount = 0;
      return out;
    }

    let anomalies = 0;

    for (const chain of FINGER_CHAINS) {
      for (let i = 1; i < chain.length; i++) {
        const parentIdx = chain[i - 1]!;
        const childIdx = chain[i]!;
        const expected = this.refLengths.get(boneKey(parentIdx, childIdx));
        if (expected === undefined) continue;

        const parent = out[parentIdx]!;
        const child = out[childIdx]!;
        const dx = child.x - parent.x;
        const dy = child.y - parent.y;
        const dz = child.z - parent.z;
        const observed = Math.hypot(dx, dy, dz);

        if (observed < 1e-6) {
          // Degenerate direction (fingertip collapsed onto parent). Reuse
          // the previous bone direction by leaving the child at its raw
          // position (better than zeroing).
          continue;
        }

        const dev = Math.abs(observed - expected) / expected;
        if (dev > ANOMALY_TOLERANCE) anomalies++;

        const inv = expected / observed;
        out[childIdx] = {
          x: parent.x + dx * inv,
          y: parent.y + dy * inv,
          z: parent.z + dz * inv,
        };
      }
    }

    this.lastAnomalyCount = anomalies;

    if (updateReference) this.updateReference(landmarks);

    return out;
  }

  private bootstrap(landmarks: Landmark[]): void {
    for (const chain of FINGER_CHAINS) {
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1]!, b = chain[i]!;
        const la = landmarks[a]!, lb = landmarks[b]!;
        const len = Math.hypot(lb.x - la.x, lb.y - la.y, lb.z - la.z);
        if (len > 1e-6) this.refLengths.set(boneKey(a, b), len);
      }
    }
  }

  private updateReference(landmarks: Landmarks): void {
    for (const chain of FINGER_CHAINS) {
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1]!, b = chain[i]!;
        const la = landmarks[a], lb = landmarks[b];
        if (!la || !lb) continue;
        const len = Math.hypot(lb.x - la.x, lb.y - la.y, lb.z - la.z);
        if (len < 1e-6) continue;
        const key = boneKey(a, b);
        const ref = this.refLengths.get(key);
        if (ref === undefined) {
          this.refLengths.set(key, len);
          continue;
        }
        // Reject obvious outliers from the EMA so a single bad frame
        // doesn't drift the reference.
        const ratio = len / ref;
        if (ratio < REF_UPDATE_LO || ratio > REF_UPDATE_HI) continue;
        this.refLengths.set(key, ref + REF_EMA_ALPHA * (len - ref));
      }
    }
  }
}
