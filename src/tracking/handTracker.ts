/**
 * Thin wrapper around MediaPipe's HandLandmarker. Owns:
 *   - the model & WASM loading (with a GPU delegate when available)
 *   - per-hand stable id assignment (model output isn't temporally stable)
 *   - per-hand landmark smoothing
 *   - per-frame metrics computation
 *
 * Inputs go in via `detect(videoEl, timestampMs)`; you get a FrameInput out.
 */

import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

import { params } from '../config/parameters.js';
import type { FrameInput, HandFrame, Handedness, Landmark, Landmarks } from '../config/types.js';
import { logger } from '../debug/logger.js';
import { LandmarkSmoother } from '../filters/landmarkSmoother.js';
import { computeHandMetrics, dist } from '../util/geometry.js';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

interface TrackedHand {
  id: number;
  smoother: LandmarkSmoother;
  /** Last-known palm position — used to match this slot to the next frame's detections. */
  lastPalm: { x: number; y: number; z: number };
  lastSeenAt: number;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private nextId = 1;
  private tracked = new Map<number, TrackedHand>();

  async init(): Promise<void> {
    logger.info('loading hand landmarker model…');
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      numHands: params.detection.maxHands,
      runningMode: 'VIDEO',
      minHandDetectionConfidence: params.detection.minHandScore,
      minHandPresenceConfidence: params.detection.minHandScore,
      minTrackingConfidence: params.detection.minHandScore,
    });
    logger.info('hand landmarker ready (GPU delegate).');
  }

  detect(videoEl: HTMLVideoElement, timestampMs: number): FrameInput {
    if (!this.landmarker) {
      return { hands: [], timestampMs };
    }

    let result: HandLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(videoEl, timestampMs);
    } catch (err) {
      logger.error(`detectForVideo failed: ${(err as Error).message}`);
      return { hands: [], timestampMs };
    }

    const detections: Array<{ raw: Landmarks; handedness: Handedness; score: number }> = [];
    const n = result.landmarks.length;
    for (let i = 0; i < n; i++) {
      const lms = result.landmarks[i];
      if (!lms) continue;
      const handednessGroup = result.handedness[i];
      const handedness = (handednessGroup?.[0]?.categoryName ?? 'Unknown') as Handedness;
      const score = handednessGroup?.[0]?.score ?? 0;
      // MediaPipe's `landmarks` are NormalizedLandmark with {x, y, z}
      const raw: Landmark[] = lms.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      detections.push({ raw, handedness, score });
    }

    // Stable-id assignment: greedy nearest-palm matching to existing slots.
    const assigned = this.assignIds(detections);

    const hands: HandFrame[] = assigned.map(({ id, raw, handedness, score }) => {
      const slot = this.tracked.get(id)!;
      const smoothed = slot.smoother.smooth(raw, timestampMs);
      const metrics = computeHandMetrics(smoothed);
      slot.lastPalm = metrics.palm;
      slot.lastSeenAt = timestampMs;
      return {
        id,
        handedness,
        landmarks: smoothed,
        rawLandmarks: raw,
        score,
        metrics,
      };
    });

    // Evict slots not seen for >500ms — frees their filter state.
    for (const [id, slot] of this.tracked) {
      if (timestampMs - slot.lastSeenAt > 500) {
        this.tracked.delete(id);
      }
    }

    return { hands, timestampMs };
  }

  private assignIds(
    detections: Array<{ raw: Landmarks; handedness: Handedness; score: number }>,
  ): Array<{ id: number; raw: Landmarks; handedness: Handedness; score: number }> {
    const out: Array<{ id: number; raw: Landmarks; handedness: Handedness; score: number }> = [];
    const usedSlots = new Set<number>();

    for (const det of detections) {
      // Compute palm centre for matching against slot.lastPalm — cheap proxy.
      const wrist = det.raw[0] ?? { x: 0.5, y: 0.5, z: 0 };
      const middleMcp = det.raw[9] ?? wrist;
      const palm = {
        x: (wrist.x + middleMcp.x) * 0.5,
        y: (wrist.y + middleMcp.y) * 0.5,
        z: (wrist.z + middleMcp.z) * 0.5,
      };

      let bestId: number | null = null;
      let bestDist = 0.15; // threshold: don't match across the screen
      for (const [id, slot] of this.tracked) {
        if (usedSlots.has(id)) continue;
        const d = dist(palm, slot.lastPalm);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }

      if (bestId === null) {
        bestId = this.nextId++;
        this.tracked.set(bestId, {
          id: bestId,
          smoother: new LandmarkSmoother(),
          lastPalm: palm,
          lastSeenAt: 0,
        });
      }

      usedSlots.add(bestId);
      out.push({ id: bestId, ...det });
    }

    return out;
  }
}
