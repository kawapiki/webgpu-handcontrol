/**
 * Maps gesture state to scene actions. Two responsibilities:
 *
 *   1. Two-handed gestures that act on the world pivot (zoom, rotate).
 *   2. Delegating per-frame work to the currently-active demo scene.
 *
 * No more global "modes" — scenes are mode-free and decide what to do
 * based on what's under the cursor / pinch midpoint.
 */

import * as THREE from 'three/webgpu';

import { params } from '../config/parameters.js';
import type { GestureState, HandFrame } from '../config/types.js';
import type { TwoHandRotateData } from '../gestures/twoHandRotate.js';
import type { TwoHandZoomData } from '../gestures/twoHandZoom.js';
import type { SceneManager } from '../scene/scenes/index.js';
import { clamp } from '../util/geometry.js';

export class InteractionController {
  private raycaster = new THREE.Raycaster();
  private prevTimeMs = performance.now();

  constructor(
    private scene: { camera: THREE.PerspectiveCamera; worldPivot: THREE.Group },
    private sceneManager: SceneManager,
  ) {}

  step(hands: HandFrame[], states: Readonly<Record<string, GestureState>>, nowMs: number): void {
    this.handleTwoHand(states);

    const dtMs = nowMs - this.prevTimeMs;
    this.prevTimeMs = nowMs;
    this.sceneManager.step({
      hands,
      states,
      camera: this.scene.camera,
      raycaster: this.raycaster,
      dtMs,
    });
  }

  private handleTwoHand(states: Readonly<Record<string, GestureState>>): void {
    const zoom = states['two_hand_zoom'] as GestureState<TwoHandZoomData> | undefined;
    const rotate = states['two_hand_rotate'] as GestureState<TwoHandRotateData> | undefined;

    if (zoom?.active && Math.abs(zoom.data.delta) > 0) {
      const cam = this.scene.camera;
      const dz = -zoom.data.delta * params.scene.zoomGain;
      cam.position.z = clamp(cam.position.z + dz, 1.5, 20);
    }

    if (rotate?.active && Math.abs(rotate.data.delta) > 0) {
      this.scene.worldPivot.rotation.y += rotate.data.delta;
    }
  }
}
