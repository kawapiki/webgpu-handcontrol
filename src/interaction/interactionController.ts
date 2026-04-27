/**
 * Maps gesture state to scene actions. Handles three things:
 *
 *   1. Global mode switching (pointer / move / draw) via finger count.
 *   2. Two-handed gestures that act on the world pivot (zoom, rotate).
 *   3. Delegating per-frame work to the currently-active demo scene.
 *
 * The mode/global handlers are tiny, so this file is mostly glue. Per-
 * scene logic lives in `src/scene/scenes/<scene>.ts`.
 */

import * as THREE from 'three/webgpu';

import { params } from '../config/parameters.js';
import type { GestureState, HandFrame } from '../config/types.js';
import { logger } from '../debug/logger.js';
import type { TwoHandRotateData } from '../gestures/twoHandRotate.js';
import type { TwoHandZoomData } from '../gestures/twoHandZoom.js';
import type { SceneManager } from '../scene/scenes/index.js';
import type { Mode } from '../scene/scenes/types.js';
import { clamp } from '../util/geometry.js';

export class InteractionController {
  private mode: Mode = 'pointer';
  private modeChangedAt = 0;
  private raycaster = new THREE.Raycaster();
  private prevTimeMs = performance.now();

  constructor(
    private scene: { camera: THREE.PerspectiveCamera; worldPivot: THREE.Group },
    private sceneManager: SceneManager,
    private modeBadge: HTMLElement,
  ) {
    this.updateBadge();
  }

  getMode(): Mode { return this.mode; }

  setMode(next: Mode, nowMs: number): void {
    if (next === this.mode) return;
    if (nowMs - this.modeChangedAt < params.modeSwitch.cooldownMs) return;
    this.mode = next;
    this.modeChangedAt = nowMs;
    this.updateBadge();
    logger.info(`mode → ${next}`);
  }

  step(hands: HandFrame[], states: Readonly<Record<string, GestureState>>, nowMs: number): void {
    this.handleModeSwitch(hands, nowMs);
    this.handleTwoHand(states);

    const dtMs = nowMs - this.prevTimeMs;
    this.prevTimeMs = nowMs;
    this.sceneManager.step({
      hands,
      states,
      camera: this.scene.camera,
      raycaster: this.raycaster,
      dtMs,
      mode: this.mode,
    });
  }

  private updateBadge(): void {
    const b = this.modeBadge.querySelector('b');
    if (b) b.textContent = this.mode;
  }

  private handleModeSwitch(hands: HandFrame[], nowMs: number): void {
    if (hands.length !== 1) return;
    const h = hands[0]!;
    const extended = h.metrics.curl.slice(1).filter((c) => c !== undefined && c < params.point.indexExtendedMax).length;
    if (extended === 1) this.setMode('pointer', nowMs);
    else if (extended === 2) this.setMode('move', nowMs);
    else if (extended === 3) this.setMode('draw', nowMs);
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
