/**
 * Three.js scene wrapper. Uses Three's unified `WebGPURenderer` from the
 * `'three/webgpu'` bundle.
 *
 * Important: every runtime `import * as THREE from 'three/webgpu'` in the
 * codebase must come from `'three/webgpu'` (NOT `'three'`). The two bundles
 * export classes with the same names but different internal pipelines —
 * mixing them produces an all-black render with no warnings (because the
 * WebGPURenderer cannot translate WebGL-only Material instances). Types
 * are identical so `import type * as THREE from 'three'` is fine.
 */

import * as THREE from 'three/webgpu';

import { params } from '../config/parameters.js';
import { logger } from '../debug/logger.js';

export interface SceneHandles {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** A pivot the controller can rotate/translate as a whole. Demos attach here. */
  worldPivot: THREE.Group;
  render: () => void;
  resize: (w: number, h: number) => void;
  /** True if the active backend is WebGPU; false if Three fell back to WebGL2. */
  usingWebGPU: boolean;
}

export async function createScene(canvas: HTMLCanvasElement): Promise<SceneHandles> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  const usingWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  logger.info(`renderer: ${usingWebGPU ? 'WebGPU' : 'WebGL2 (fallback)'}`);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c2230);

  const camera = new THREE.PerspectiveCamera(params.scene.fov, 1, 0.1, 100);
  camera.position.set(0, 0.4, 5);

  const worldPivot = new THREE.Group();
  scene.add(worldPivot);

  // Bright, directional-but-soft lighting. WebGPURenderer respects the same
  // light classes as WebGLRenderer (just different internal compilation).
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xffeacd, 0x404858, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(5, 7, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa6c3ff, 0.6);
  fill.position.set(-4, 3, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x4ad295, 0.5);
  rim.position.set(-3, 2, -4);
  scene.add(rim);

  const grid = new THREE.GridHelper(20, 20, 0x2a3140, 0x1a1f28);
  grid.position.y = -2;
  (grid.material as THREE.Material).opacity = 0.6;
  (grid.material as THREE.Material).transparent = true;
  scene.add(grid);

  const resize = (w: number, h: number) => {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = params.scene.fov;
    camera.updateProjectionMatrix();
  };

  const render = () => {
    renderer.renderAsync(scene, camera);
  };

  return { renderer, scene, camera, worldPivot, render, resize, usingWebGPU };
}
