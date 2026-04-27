/**
 * The contract a "demo scene" must implement to be plugged into the
 * SceneManager. Keep this interface tiny — anything domain-specific
 * stays inside the scene module itself.
 */

import type * as THREE from 'three';

import type { GestureState, HandFrame } from '../../config/types.js';

/** Coarse interaction mode shared by multiple scenes. */
export type Mode = 'pointer' | 'move' | 'draw';

export interface SceneStepInput {
  hands: HandFrame[];
  states: Readonly<Record<string, GestureState>>;
  camera: THREE.PerspectiveCamera;
  raycaster: THREE.Raycaster;
  /** Wall-clock ms since the previous frame. */
  dtMs: number;
  /** Current global mode — scenes may ignore it. */
  mode: Mode;
}

export interface DemoScene {
  /** Stable id used as the registry key. */
  readonly name: string;
  /** Human-friendly label for the scene picker. */
  readonly label: string;
  /** Scene root — added to the world pivot so two-hand zoom/rotate works. */
  readonly root: THREE.Group;
  /** Run one frame of scene logic. Called only while this scene is active. */
  step(input: SceneStepInput): void;
  /** Called when the scene becomes active. */
  activate(): void;
  /** Called when the scene becomes inactive. Must release any held state. */
  deactivate(): void;
}
