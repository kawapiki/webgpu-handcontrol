/**
 * 3D hand skeleton — renders each tracked hand as joint spheres + bones
 * inside the scene, so the user can see where their hand lives in world
 * coordinates without consulting the 2D camera-overlay.
 *
 * How positioning works:
 *   For each landmark we cast a ray from the camera through its
 *   image-space NDC position (same projection the cursor uses), then
 *   place the joint at `depth + landmark.z * zScale` along that ray.
 *   The result is a plane-of-hand that bows in/out with MediaPipe's
 *   relative-depth signal — flat enough to feel anchored, deep enough
 *   to see foreshortening.
 *
 * Attached to scene root (NOT worldPivot) so the visual hand stays in
 * the user's reference frame even while two-hand-rotate spins the world.
 */

import * as THREE from 'three/webgpu';

import { params } from '../config/parameters.js';
import type { HandFrame, Handedness } from '../config/types.js';

const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [0, 9], [9, 10], [10, 11], [11, 12],     // middle
  [0, 13], [13, 14], [14, 15], [15, 16],   // ring
  [0, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [5, 9], [9, 13], [13, 17],               // palm web
];

const HAND_COLOURS: Record<Handedness, number> = {
  Left: 0x4ad295,
  Right: 0xf0b429,
  Unknown: 0x8a8a8a,
};

const LANDMARK_COUNT = 21;
const TIP_INDICES = new Set([4, 8, 12, 16, 20]);

class RenderedHand {
  readonly group = new THREE.Group();
  private readonly joints: THREE.Mesh[] = [];
  private readonly bones: THREE.LineSegments;
  private readonly bonePositions: Float32Array;
  private readonly worldPositions: THREE.Vector3[];

  constructor(handedness: Handedness) {
    const colour = HAND_COLOURS[handedness] ?? HAND_COLOURS.Unknown;

    const jointGeo = new THREE.SphereGeometry(0.03, 12, 10);
    const jointMat = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: 0.55,
      roughness: 0.6,
    });
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const m = new THREE.Mesh(jointGeo, jointMat);
      if (TIP_INDICES.has(i)) m.scale.setScalar(1.25);
      this.joints.push(m);
      this.group.add(m);
    }

    this.bonePositions = new Float32Array(BONES.length * 2 * 3);
    const boneGeo = new THREE.BufferGeometry();
    boneGeo.setAttribute('position', new THREE.BufferAttribute(this.bonePositions, 3));
    const boneMat = new THREE.LineBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.85,
    });
    this.bones = new THREE.LineSegments(boneGeo, boneMat);
    this.group.add(this.bones);

    this.worldPositions = new Array(LANDMARK_COUNT);
    for (let i = 0; i < LANDMARK_COUNT; i++) this.worldPositions[i] = new THREE.Vector3();
  }

  update(
    hand: HandFrame,
    camera: THREE.PerspectiveCamera,
    raycaster: THREE.Raycaster,
    depth: number,
    zScale: number,
  ): void {
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const lm = hand.landmarks[i];
      if (!lm) {
        // Reuse last known position for missing landmarks.
        this.worldPositions[i]!.copy(this.joints[i]!.position);
        continue;
      }
      // CSS mirrors the video; flip x so the rendered hand visually
      // matches what the user sees on screen.
      ndc.set((1 - lm.x) * 2 - 1, -(lm.y * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      const t = depth + lm.z * zScale;
      raycaster.ray.at(t, tmp);
      this.joints[i]!.position.copy(tmp);
      this.worldPositions[i]!.copy(tmp);
    }

    for (let bi = 0; bi < BONES.length; bi++) {
      const bone = BONES[bi]!;
      const a = this.worldPositions[bone[0]]!;
      const b = this.worldPositions[bone[1]]!;
      const off = bi * 6;
      this.bonePositions[off    ] = a.x;
      this.bonePositions[off + 1] = a.y;
      this.bonePositions[off + 2] = a.z;
      this.bonePositions[off + 3] = b.x;
      this.bonePositions[off + 4] = b.y;
      this.bonePositions[off + 5] = b.z;
    }
    (this.bones.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
    this.bones.geometry.computeBoundingSphere();
  }

  dispose(): void {
    for (const m of this.joints) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.bones.geometry.dispose();
    (this.bones.material as THREE.Material).dispose();
  }
}

export class HandMesh {
  readonly root = new THREE.Group();
  private rendered = new Map<number, RenderedHand>();
  private readonly raycaster = new THREE.Raycaster();

  attachTo(parent: THREE.Object3D): void {
    parent.add(this.root);
  }

  update(hands: HandFrame[], camera: THREE.PerspectiveCamera): void {
    if (!params.handMesh.show) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    const seen = new Set<number>();
    for (const hand of hands) {
      seen.add(hand.id);
      let r = this.rendered.get(hand.id);
      if (!r) {
        r = new RenderedHand(hand.handedness);
        this.rendered.set(hand.id, r);
        this.root.add(r.group);
      }
      r.group.visible = true;
      r.update(hand, camera, this.raycaster, params.handMesh.depth, params.handMesh.zScale);
    }
    for (const [id, r] of this.rendered) {
      if (!seen.has(id)) {
        r.group.visible = false;
        // Dispose entries we haven't seen for a while.
        if (this.rendered.size > 4) {
          this.root.remove(r.group);
          r.dispose();
          this.rendered.delete(id);
        }
      }
    }
  }
}
