/**
 * Public surface of `@kawapiki/handcontrol`.
 *
 * Run `npm run build:lib` to produce `dist-lib/` — that's the
 * publish artifact (ESM JS + .d.ts), with @mediapipe/tasks-vision
 * left as an external peer dep so the consuming site provides it.
 */

// High-level event surface.
export { HandControl } from './handControl.js';
export type { HandControlOptions, HandPoseConfig } from './handControl.js';
export { EventBus } from './eventBus.js';
export { DomBridge } from './domBridge.js';
export type { DomBridgeOptions } from './domBridge.js';
export type {
  CursorEvent, PinchEvent, PinchMoveEvent, PinchEndEvent,
  ZoomEvent, RotateEvent, HandPoseEvent, HandControlEventMap,
} from './types.js';

// Low-level pipeline. Consumers who want raw gesture state, custom
// scenes, or to write their own event sources reach for these.
export { HandTracker } from '../tracking/handTracker.js';
export { startCamera } from '../tracking/camera.js';
export type { CameraInit, CameraResult } from '../tracking/camera.js';
export { GestureRuntime, detectors } from '../gestures/index.js';
export { defaultGestureConfig } from '../config/gestureConfig.js';
export type {
  GestureConfig, SmoothingConfig, VelocityGateConfig,
  DetectionConfig, PinchConfig, PointConfig, OpenPalmConfig, TwoHandConfig,
} from '../config/gestureConfig.js';
export type {
  HandFrame, HandMetrics, FrameInput, Landmark, Landmarks, Handedness,
  GestureState, GestureCondition, GestureContext, GestureDetector,
  Vec2, Vec3,
} from '../config/types.js';

// Per-gesture data shapes — useful for typed event handlers in the consumer's app.
export type { PinchData } from '../gestures/pinch.js';
export type { PointData } from '../gestures/point.js';
export type { OpenPalmData } from '../gestures/openPalm.js';
export type { TwoHandZoomData } from '../gestures/twoHandZoom.js';
export type { TwoHandRotateData } from '../gestures/twoHandRotate.js';
