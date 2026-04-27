/**
 * Public event surface of the hand-control layer. These types are what
 * a consumer (a website, a React component, an npm-package user) sees.
 *
 * Coordinates are reported in CSS pixels relative to a "viewport"
 * (configurable on `HandControl`). x grows left → right of the user's
 * visual frame (already un-mirrored from the camera).
 */

import type { GestureState, HandFrame } from '../config/types.js';

/** A point in the consumer's coordinate space (CSS px). */
export interface CursorPoint {
  x: number;
  y: number;
}

export interface CursorEvent extends CursorPoint {
  /** Stable per-hand id, matches HandTracker slot ids. */
  handId: number;
  /** True iff at least one hand is present and the index fingertip is visible. */
  visible: boolean;
}

export interface PinchEvent extends CursorPoint {
  handId: number;
  /** ms timestamp of the underlying pinch transition. */
  at: number;
}

export interface PinchMoveEvent extends PinchEvent {
  /** CSS-px delta since the previous frame. */
  dx: number;
  dy: number;
}

export interface PinchEndEvent extends PinchEvent {
  /** Total CSS-px traveled since pinchStart. */
  totalDx: number;
  totalDy: number;
  /** Release velocity in CSS px / second (smoothed last 100 ms). */
  vx: number;
  vy: number;
  /** ms duration of the pinch from start to end. */
  durationMs: number;
}

export interface ZoomEvent {
  /** Scale factor: >0 = spread (zoom in), <0 = pinch hands together. */
  delta: number;
}

export interface RotateEvent {
  /** Rotation in radians since the previous frame. */
  delta: number;
}

/**
 * Single-hand wrist orientation deltas. Emitted every frame a hand is
 * pinching, with frame-to-frame change in roll (wrist twist) and pitch
 * (wrist bend toward/away from camera). Consumers can apply this to a
 * held object's rotation.
 */
export interface HandPoseEvent {
  handId: number;
  /** Δroll since previous frame (rad), already deadzoned. */
  dRoll: number;
  /** Δpitch since previous frame (unitless, normalized by hand scale). */
  dPitch: number;
  /** Absolute current roll (rad) — useful if the consumer wants to track total. */
  roll: number;
  /** Absolute current pitch — useful if the consumer wants to track total. */
  pitch: number;
}

export interface HandControlEventMap {
  cursor: CursorEvent;
  pinchStart: PinchEvent;
  pinchMove: PinchMoveEvent;
  pinchEnd: PinchEndEvent;
  zoom: ZoomEvent;
  rotate: RotateEvent;
  handPose: HandPoseEvent;
}

/** Per-frame snapshot fed into each Source. */
export interface SourceFrame {
  hands: readonly HandFrame[];
  states: Readonly<Record<string, GestureState>>;
  nowMs: number;
  viewport: { width: number; height: number };
}

/** A source consumes a frame and emits events on the bus. */
export interface Source {
  step(frame: SourceFrame): void;
  reset(): void;
}
