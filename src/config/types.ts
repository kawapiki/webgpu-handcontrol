/**
 * Core shared types. Keep this file dependency-free except for sibling
 * config-shape types (also dependency-free).
 *
 * Convention: every gesture is a pure function operating on a HandFrame snapshot
 * plus its previous state. This keeps gestures testable in isolation.
 */

import type { GestureConfig } from './gestureConfig.js';

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

/** A single MediaPipe hand landmark in normalized image space (0..1) plus z (relative depth). */
export type Landmark = Vec3;

/** 21 landmarks per hand, in MediaPipe's canonical order. */
export type Landmarks = readonly Landmark[];

export type Handedness = 'Left' | 'Right' | 'Unknown';

/** A snapshot of one detected hand at a single point in time, after smoothing. */
export interface HandFrame {
  /** Stable id assigned by our tracker (not the model's). */
  id: number;
  handedness: Handedness;
  /** Smoothed landmarks. */
  landmarks: Landmarks;
  /** Raw landmarks before filtering — useful for the debug overlay. */
  rawLandmarks: Landmarks;
  /** Model confidence for this hand. */
  score: number;
  /** Convenience cached metrics — see geometry.ts. Filled by the tracker. */
  metrics: HandMetrics;
}

/** Geometric scalars pre-computed once per frame so gesture detectors stay cheap. */
export interface HandMetrics {
  /** Approximate hand size (wrist→middle-MCP distance), used to normalise distances. */
  scale: number;
  /** Curl per finger (0 = fully extended, 1 = fully curled). thumb,index,middle,ring,pinky. */
  curl: readonly [number, number, number, number, number];
  /** Pinch distance (thumb tip ↔ index tip) normalised by hand scale. */
  pinch: number;
  /** Palm centre in normalised image space. */
  palm: Vec3;
  /** Index-finger tip direction unit vector (from MCP to tip), in image space. */
  indexDir: Vec3;
}

/** A snapshot of all hands seen this frame. */
export interface FrameInput {
  hands: HandFrame[];
  /** ms since epoch when the underlying camera frame was captured. */
  timestampMs: number;
}

/** Generic state container kept by each gesture detector across frames. */
export interface GestureState<T = unknown> {
  /** Whether the gesture is currently considered "on". */
  active: boolean;
  /** 0..1 confidence the gesture is being performed. */
  confidence: number;
  /** Wall-clock ms when the gesture last entered the active state. */
  enteredAt: number | null;
  /** Per-gesture custom payload (e.g. grabbed object id). */
  data: T;
  /** Diagnostic conditions — used by the "Why didn't it fire?" panel. */
  conditions: GestureCondition[];
}

export interface GestureCondition {
  label: string;
  value: number | string;
  passed: boolean;
}

export interface GestureContext {
  nowMs: number;
  /** Wall-clock ms of the previous frame (or nowMs on first frame). */
  prevMs: number;
  /** Read-only view of all gesture states this frame, keyed by name. */
  states: Readonly<Record<string, GestureState>>;
  /** Live tuning bag — one snapshot per frame. Detectors read thresholds from here. */
  config: GestureConfig;
}

/** A gesture detector — one per file under src/gestures. */
export interface GestureDetector<T = unknown> {
  /** Stable, snake_case id used as the state key. */
  readonly name: string;
  /** Initial state for the very first frame. */
  initial(): GestureState<T>;
  /** Pure function: produce next state from current frame + previous state. */
  detect(
    input: FrameInput,
    prev: GestureState<T>,
    ctx: GestureContext,
  ): GestureState<T>;
}
