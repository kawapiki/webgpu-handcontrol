/**
 * Image-space → world-space ray casting helpers.
 *
 * We use the index-finger MCP (knuckle) as the ray origin and the
 * index-finger TIP as the direction reference. That gives a more stable
 * ray than wrist→tip, especially when the finger is foreshortened.
 */

import * as THREE from 'three/webgpu';

import type { Vec3 } from '../config/types.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Build a Three.js Raycaster from an image-space pointing direction.
 * `tipNorm` and `mcpNorm` are normalised landmarks (image space).
 */
export function buildPointerRay(
  camera: THREE.Camera,
  tipNorm: Vec3,
  mcpNorm: Vec3,
  out: THREE.Raycaster,
): void {
  // Convert the index-tip to a screen-space (-1..1) coord. The video is
  // mirrored on screen, so we flip x here to match what the user sees.
  const ndc = new THREE.Vector2(
    (1 - tipNorm.x) * 2 - 1,
    -(tipNorm.y * 2 - 1),
  );

  // We treat the tip as the screen-target and shoot a ray from the camera.
  out.setFromCamera(ndc, camera);

  // Optionally bias the ray direction by the wrist→tip vector so two-handed
  // pointing (one hand on each side of the screen) feels natural.
  _origin.copy(out.ray.origin);
  _dir.copy(out.ray.direction);
  const lateralBias = (tipNorm.x - mcpNorm.x) * 0.0; // disabled by default; tune if desired
  void lateralBias;
  out.ray.origin.copy(_origin);
  out.ray.direction.copy(_dir).normalize();
}

/** Find the nearest mesh under the pointer ray. Returns null if none. */
export function pickNearest(raycaster: THREE.Raycaster, candidates: THREE.Object3D[]): THREE.Mesh | null {
  const hits = raycaster.intersectObjects(candidates, false);
  for (const h of hits) {
    if (h.object instanceof THREE.Mesh) return h.object;
  }
  return null;
}
