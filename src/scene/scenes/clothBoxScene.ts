/**
 * "Cloth Box" demo: a box hidden under a draped cloth. Pinch the cloth
 * with thumb-and-index, drag to pull it off, release to drop it.
 *
 * Only runs in `draw` mode (the pinch-based mode) — outside it the
 * scene simulates physics but never grabs, so accidental hand poses
 * can't pull the cloth.
 *
 * Pinch logic uses the existing `pinch` gesture detector (per-hand) so
 * all the noise-prevention layers (hysteresis, hold-time, etc.) apply
 * here too. The first hand to enter pinch grabs; subsequent pinches by
 * other hands are ignored until that hand releases.
 */

import * as THREE from 'three/webgpu';

import type { GestureState, Vec3 } from '../../config/types.js';
import { logger } from '../../debug/logger.js';
import type { PinchData } from '../../gestures/pinch.js';
import { ClothSim } from '../cloth.js';
import type { DemoScene, SceneStepInput } from './types.js';

const COLS = 16;
const ROWS = 16;
const CLOTH_W = 1.6;
const CLOTH_H = 1.6;
const BOX_SIZE = 0.6;
const GRAB_RADIUS = 0.35;

export class ClothBoxScene implements DemoScene {
  readonly name = 'clothBox';
  readonly label = 'Box under cloth';
  readonly root = new THREE.Group();

  private readonly box: THREE.Mesh;
  private readonly cloth: THREE.Mesh;
  private readonly clothGeo: THREE.BufferGeometry;
  private readonly sim: ClothSim;
  private readonly cursor: THREE.Mesh;
  private grabbedHandId: number | null = null;
  private grabDepth = 0;
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpVec2: Vec3 = { x: 0, y: 0, z: 0 };

  constructor() {
    // Hidden treasure box.
    const boxGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xd4a14a,
      roughness: 0.45,
      metalness: 0.4,
      emissive: 0x331a00,
      emissiveIntensity: 0.2,
    });
    this.box = new THREE.Mesh(boxGeo, boxMat);
    this.box.position.set(0, -1.2, 0);
    this.root.add(this.box);

    // Ground plane (visual only — the sim has its own groundY value).
    const groundGeo = new THREE.PlaneGeometry(6, 6);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1f242c, roughness: 1.0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    this.root.add(ground);

    // Cloth simulation. The cloth starts above the box and falls onto it,
    // settling into a natural drape shape during construction.
    const half = BOX_SIZE / 2;
    this.sim = new ClothSim({
      cols: COLS,
      rows: ROWS,
      width: CLOTH_W,
      height: CLOTH_H,
      origin: { x: 0, y: -0.55, z: 0 },
      damping: 0.985,
      gravity: { x: 0, y: -9.8, z: 0 },
      constraintIterations: 6,
      box: {
        min: { x: -half, y: -1.2 - half, z: -half },
        max: { x:  half, y: -1.2 + half, z:  half },
      },
      groundY: -1.5,
    });

    // Build geometry directly over the sim's position buffer (zero-copy).
    this.clothGeo = new THREE.BufferGeometry();
    this.clothGeo.setAttribute('position', new THREE.BufferAttribute(this.sim.positions, 3));
    const indices: number[] = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = r * COLS + c;
        const b = a + 1;
        const cIdx = a + COLS;
        const d = cIdx + 1;
        indices.push(a, cIdx, b, b, cIdx, d);
      }
    }
    this.clothGeo.setIndex(indices);
    this.clothGeo.computeVertexNormals();

    const clothMat = new THREE.MeshStandardMaterial({
      color: 0x6b8af0,
      roughness: 0.85,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    this.cloth = new THREE.Mesh(this.clothGeo, clothMat);
    this.root.add(this.cloth);

    // Pre-bake settling so the user sees a draped cloth on first frame.
    for (let i = 0; i < 240; i++) this.sim.step(1000 / 60);
    (this.clothGeo.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
    this.clothGeo.computeVertexNormals();

    // Pinch cursor marker — a small ring at the grab point.
    const cursorGeo = new THREE.TorusGeometry(0.07, 0.012, 12, 24);
    const cursorMat = new THREE.MeshStandardMaterial({
      color: 0x4ad295,
      emissive: 0x4ad295,
      emissiveIntensity: 0.8,
    });
    this.cursor = new THREE.Mesh(cursorGeo, cursorMat);
    this.cursor.visible = false;
    this.root.add(this.cursor);

    this.root.visible = false;
  }

  activate(): void { this.root.visible = true; }
  deactivate(): void {
    this.root.visible = false;
    this.releaseGrab();
  }

  step({ hands, states, camera, raycaster, dtMs, mode }: SceneStepInput): void {
    const pinch = states['pinch'] as GestureState<PinchData> | undefined;

    // Decide who's pinching. Outside `draw` mode, force release so a
    // stray pinch from another mode (or a noisy frame) can't grab.
    let pinchedHandId: number | null = null;
    if (mode === 'draw' && pinch?.active) {
      // Prefer the hand we already grabbed with, if it's still pinching.
      if (this.grabbedHandId !== null && pinch.data.perHand[this.grabbedHandId]?.pinched) {
        pinchedHandId = this.grabbedHandId;
      } else {
        for (const [idStr, perHand] of Object.entries(pinch.data.perHand)) {
          if (perHand.pinched) { pinchedHandId = Number(idStr); break; }
        }
      }
    }

    if (pinchedHandId === null) {
      this.releaseGrab();
    } else {
      const hand = hands.find((h) => h.id === pinchedHandId);
      if (hand) {
        const thumb = hand.landmarks[4];
        const index = hand.landmarks[8];
        if (thumb && index) {
          // Pinch position = midpoint of thumb-tip and index-tip (in image space).
          const midX = (thumb.x + index.x) * 0.5;
          const midY = (thumb.y + index.y) * 0.5;
          const ndc = new THREE.Vector2((1 - midX) * 2 - 1, -(midY * 2 - 1));
          raycaster.setFromCamera(ndc, camera);

          if (this.grabbedHandId === null) {
            // New grab: find nearest cloth vertex within GRAB_RADIUS of the ray.
            const idx = this.findNearestVertex(raycaster, GRAB_RADIUS);
            if (idx !== null) {
              this.sim.vertex(idx, this.tmpVec2);
              this.tmpVec.set(this.tmpVec2.x, this.tmpVec2.y, this.tmpVec2.z);
              this.grabDepth = this.tmpVec.distanceTo(camera.position);
              this.sim.setGrabbed(idx, this.tmpVec2);
              this.grabbedHandId = pinchedHandId;
              logger.info(`grabbed cloth vertex #${idx}`);
            }
          } else {
            // Continue dragging — project the ray to the grab depth.
            raycaster.ray.at(this.grabDepth, this.tmpVec);
            this.tmpVec2.x = this.tmpVec.x;
            this.tmpVec2.y = this.tmpVec.y;
            this.tmpVec2.z = this.tmpVec.z;
            this.sim.updateGrabTarget(this.tmpVec2);
            this.cursor.position.copy(this.tmpVec);
            this.cursor.visible = true;
          }
        }
      }
    }

    // Step physics, then push positions back to the GPU.
    this.sim.step(dtMs);
    (this.clothGeo.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
    this.clothGeo.computeVertexNormals();

    if (this.grabbedHandId === null) this.cursor.visible = false;
  }

  private findNearestVertex(raycaster: THREE.Raycaster, maxDist: number): number | null {
    let best = -1;
    let bestDist = maxDist;
    const ray = raycaster.ray;
    const p = new THREE.Vector3();
    const total = COLS * ROWS;
    for (let i = 0; i < total; i++) {
      p.set(this.sim.positions[i * 3]!, this.sim.positions[i * 3 + 1]!, this.sim.positions[i * 3 + 2]!);
      const d = ray.distanceToPoint(p);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best === -1 ? null : best;
  }

  private releaseGrab(): void {
    if (this.grabbedHandId !== null) {
      logger.info('released cloth');
      this.sim.setGrabbed(null);
      this.grabbedHandId = null;
    }
    this.cursor.visible = false;
  }
}
