/**
 * Scene registry & manager. To add a new demo scene:
 *   1. Implement `DemoScene` in `src/scene/scenes/<yourScene>.ts`.
 *   2. Add it to the `scenes` array in `createSceneManager()`.
 *   3. Optionally bump the keyboard cycle in `src/main.ts` if you want
 *      a dedicated key for it.
 */

import type * as THREE from 'three';

import { logger } from '../../debug/logger.js';
import { ClothBoxScene } from './clothBoxScene.js';
import { ShapesScene } from './shapesScene.js';
import type { DemoScene, SceneStepInput } from './types.js';

export class SceneManager {
  private readonly scenes: DemoScene[];
  private activeIdx = 0;

  constructor(parent: THREE.Group, scenes: DemoScene[]) {
    if (scenes.length === 0) throw new Error('SceneManager: at least one scene required');
    this.scenes = scenes;
    for (const s of scenes) {
      s.root.visible = false;
      parent.add(s.root);
    }
    this.scenes[0]!.activate();
  }

  list(): ReadonlyArray<{ name: string; label: string }> {
    return this.scenes.map((s) => ({ name: s.name, label: s.label }));
  }

  get active(): DemoScene { return this.scenes[this.activeIdx]!; }

  setActiveByName(name: string): void {
    const idx = this.scenes.findIndex((s) => s.name === name);
    if (idx < 0 || idx === this.activeIdx) return;
    this.scenes[this.activeIdx]!.deactivate();
    this.activeIdx = idx;
    this.scenes[this.activeIdx]!.activate();
    logger.info(`scene → ${name}`);
  }

  cycle(direction: 1 | -1): void {
    const next = (this.activeIdx + direction + this.scenes.length) % this.scenes.length;
    this.setActiveByName(this.scenes[next]!.name);
  }

  step(input: SceneStepInput): void {
    this.active.step(input);
  }
}

export function createSceneManager(parent: THREE.Group): SceneManager {
  return new SceneManager(parent, [new ShapesScene(), new ClothBoxScene()]);
}

export type { DemoScene, SceneStepInput, Mode } from './types.js';
