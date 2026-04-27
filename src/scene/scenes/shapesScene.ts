/**
 * "Shapes" demo. Mode-free, pinch-as-the-only-verb interaction:
 *
 *   any hand visible             →  cursor on the index fingertip + hover
 *   pinch on hovered shape       →  drag the shape (translate)
 *   pinch + wrist twist / pitch  →  rotate the held shape (Y / X axes)
 *   pinch in empty space         →  draw a 3D stroke
 *   short pinch (air-tap)        →  spin the hovered shape
 *
 * The cursor and hover are NOT gated on the `point` gesture. We use the
 * index fingertip directly via a screen-space ray; pinch is the only
 * action verb. This way wrist roll / pitch fire the moment you grab,
 * even when the pose isn't a "perfect point" (which fails frequently
 * mid-pinch because the index curl creeps up).
 *
 * Hover feedback has three tiers:
 *   1. cursor on shape, hand relaxed              → soft green emissive
 *   2. cursor on shape, hand closing toward pinch → emissive brightens
 *      smoothly as a function of the pinch metric (pre-pinch armed)
 *   3. shape grabbed                              → drag styling persists
 *
 * Depth: the cursor's distance from the camera comes from `estimateDepth(...)`
 * (utilities/depth.ts), so reaching forward physically pushes the cursor
 * deeper into the scene and pulling back brings it forward.
 */

import * as THREE from 'three/webgpu';

import { params } from '../../config/parameters.js';
import type { GestureState, HandFrame } from '../../config/types.js';
import { logger } from '../../debug/logger.js';
import type { PinchData } from '../../gestures/pinch.js';
import { clamp } from '../../util/geometry.js';
import { estimateDepth } from '../depth.js';
import { extractHandPose, wrapAngle } from '../../util/handPose.js';
import { pickNearest } from '../raycaster.js';
import type { DemoScene, SceneStepInput } from './types.js';

type DragKind = 'shape' | 'stroke' | null;

/** Max points per stroke. Beyond this we just stop appending. */
const MAX_STROKE_POINTS = 1024;
/** Min ms a pinch must be held over empty space before we commit to drawing.
 *  Prevents a pinch that briefly misses a shape from leaking into a stroke. */
const STROKE_COMMIT_MS = 120;

export class ShapesScene implements DemoScene {
  readonly name = 'shapes';
  readonly label = 'Shapes';
  readonly root = new THREE.Group();

  private readonly cursor: THREE.Mesh;
  private readonly grabbables: THREE.Mesh[] = [];
  private readonly strokes = new THREE.Group();

  private dragKind: DragKind = null;
  private dragHandId: number | null = null;
  private grabbedObject: THREE.Mesh | null = null;
  private grabbedDepth = 0;
  private grabbedOffset = new THREE.Vector3();
  private prevRoll: number | null = null;
  private prevPitch: number | null = null;

  private currentStroke: THREE.Line | null = null;
  private currentStrokeBuffer: Float32Array | null = null;
  private currentStrokeCount = 0;
  private lastStrokePoint = new THREE.Vector3();
  private lastTapHandled = 0;
  /** Time pinch first started over empty space — used for STROKE_COMMIT_MS gate. */
  private pinchAirSince = 0;

  // Pre-allocated scratch math objects. Methods that need a Vector2/Vector3
  // reuse these instead of `new`-ing every frame — avoids GC microstutters
  // in the rAF loop.
  private readonly _ndc = new THREE.Vector2();
  private readonly _scratchA = new THREE.Vector3();

  constructor() {
    const cursorGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const cursorMat = new THREE.MeshStandardMaterial({
      color: 0x4ad295,
      emissive: 0x4ad295,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.9,
    });
    this.cursor = new THREE.Mesh(cursorGeo, cursorMat);
    this.cursor.visible = false;
    this.root.add(this.cursor);

    const palette = [0xef5b5b, 0xf0b429, 0x4ad295, 0x4a90e2, 0xb74af0];
    const shapes: Array<() => THREE.BufferGeometry> = [
      () => new THREE.BoxGeometry(0.6, 0.6, 0.6),
      () => new THREE.IcosahedronGeometry(0.4, 0),
      () => new THREE.TorusKnotGeometry(0.32, 0.1, 80, 16),
      () => new THREE.ConeGeometry(0.4, 0.7, 24),
      () => new THREE.OctahedronGeometry(0.45, 0),
    ];
    for (let i = 0; i < 5; i++) {
      const geo = shapes[i]!();
      const mat = new THREE.MeshStandardMaterial({
        color: palette[i % palette.length]!,
        roughness: 0.45,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const a = (i / 5) * Math.PI * 2;
      mesh.position.set(Math.cos(a) * 1.6, Math.sin(a) * 0.6, 0);
      mesh.userData.baseColor = mat.color.getHex();
      this.root.add(mesh);
      this.grabbables.push(mesh);
    }

    this.root.add(this.strokes);
  }

  activate(): void { this.root.visible = true; }
  deactivate(): void {
    this.root.visible = false;
    this.endDrag();
    this.cursor.visible = false;
    this.setHovered(null, 0);
  }

  step(input: SceneStepInput): void {
    const { hands, states, camera, raycaster } = input;
    const pinch = states['pinch'] as GestureState<PinchData> | undefined;

    // 1. Pick the active hand. Prefer the hand currently dragging (so the
    //    cursor doesn't jump if a second hand becomes the "first" later);
    //    else the hand currently pinching; else the first detected hand.
    const activeHand = this.pickActiveHand(hands, pinch);

    let hoveredShape: THREE.Mesh | null = null;
    let armingFactor = 0;

    if (activeHand) {
      const tip = activeHand.landmarks[8];
      if (tip) {
        // 2. Build a screen-space ray through the index fingertip.
        this._ndc.set((1 - tip.x) * 2 - 1, -(tip.y * 2 - 1));
        raycaster.setFromCamera(this._ndc, camera);

        // 3. Hover detection.
        hoveredShape = pickNearest(raycaster, this.grabbables);

        // 4. Armed factor: how close the hand is to the pinch enter
        //    threshold, only meaningful when on a hovered shape.
        if (hoveredShape) {
          const armingRange = params.pinch.enter * 2;
          armingFactor = clamp(1 - activeHand.metrics.pinch / armingRange, 0, 1);
        }

        // 5. Place the cursor: on the surface if hovering, else at depth.
        if (hoveredShape) {
          const hits = raycaster.intersectObject(hoveredShape, false);
          if (hits[0]) this._scratchA.copy(hits[0].point);
        } else {
          const depth = estimateDepth(activeHand.landmarks);
          raycaster.ray.at(depth, this._scratchA);
        }
        this.cursor.position.copy(this._scratchA);
        this.cursor.visible = true;

        // 6. Air-tap → spin the hovered shape (uses the gesture detector's
        //    debounced tap event, not raw pinch state).
        if (
          pinch?.data.tappedAt &&
          pinch.data.tappedAt !== this.lastTapHandled &&
          hoveredShape
        ) {
          this.lastTapHandled = pinch.data.tappedAt;
          hoveredShape.userData.spin = (hoveredShape.userData.spin ?? 0) + Math.PI;
          logger.info(`tap on ${hoveredShape.geometry.type}`);
        }
      }
    } else {
      this.cursor.visible = false;
    }
    this.setHovered(hoveredShape, armingFactor);

    // 7. Decay any pending air-tap spin.
    for (const m of this.grabbables) {
      const spin = (m.userData.spin as number) ?? 0;
      if (spin !== 0) {
        const stepAmt = Math.sign(spin) * Math.min(Math.abs(spin), 0.15);
        m.rotation.y += stepAmt;
        m.userData.spin = spin - stepAmt;
      }
    }

    // 8. Pinch-driven drag/stroke. With a small commit-delay for stroke
    //    so a pinch that misses a shape doesn't immediately become a draw.
    const pinchedHandId = this.activePinchHand(pinch);
    if (pinchedHandId === null) {
      this.endDrag();
      this.pinchAirSince = 0;
      return;
    }

    if (this.dragKind === null) {
      if (hoveredShape) {
        this.startShapeDrag(pinchedHandId, hoveredShape, hands, camera, raycaster);
        this.pinchAirSince = 0;
      } else {
        // Empty-space pinch — start the timer; only commit to stroke after
        // STROKE_COMMIT_MS so we don't leak into a draw on a near-miss.
        if (this.pinchAirSince === 0) this.pinchAirSince = performance.now();
        if (performance.now() - this.pinchAirSince >= STROKE_COMMIT_MS) {
          this.startStrokeDrag(pinchedHandId);
        }
      }
    }

    if (this.dragKind === 'shape' && this.grabbedObject) {
      this.continueShapeDrag(pinchedHandId, hands, camera, raycaster);
      this.applyWristRotation(pinchedHandId, hands);
    } else if (this.dragKind === 'stroke') {
      this.continueStroke(pinchedHandId, hands, camera, raycaster);
    }
  }

  private pickActiveHand(
    hands: readonly HandFrame[],
    pinch: GestureState<PinchData> | undefined,
  ): HandFrame | null {
    if (hands.length === 0) return null;
    if (this.dragHandId !== null) {
      const h = hands.find((x) => x.id === this.dragHandId);
      if (h) return h;
    }
    if (pinch?.active) {
      for (const [idStr, perHand] of Object.entries(pinch.data.perHand)) {
        if (perHand.pinched) {
          const h = hands.find((x) => x.id === Number(idStr));
          if (h) return h;
        }
      }
    }
    return hands[0]!;
  }

  private activePinchHand(pinch: GestureState<PinchData> | undefined): number | null {
    if (!pinch?.active) return null;
    if (this.dragHandId !== null && pinch.data.perHand[this.dragHandId]?.pinched) {
      return this.dragHandId;
    }
    for (const [idStr, perHand] of Object.entries(pinch.data.perHand)) {
      if (perHand.pinched) return Number(idStr);
    }
    return null;
  }

  private startShapeDrag(
    handId: number,
    hoveredShape: THREE.Mesh,
    hands: readonly HandFrame[],
    camera: THREE.PerspectiveCamera,
    raycaster: THREE.Raycaster,
  ): void {
    this.dragKind = 'shape';
    this.dragHandId = handId;
    this.grabbedObject = hoveredShape;
    this.grabbedDepth = hoveredShape.position.distanceTo(camera.position);
    raycaster.ray.at(this.grabbedDepth, this._scratchA);
    this.grabbedOffset.copy(hoveredShape.position).sub(this._scratchA);
    const hand = hands.find((h) => h.id === handId);
    const pose = hand ? extractHandPose(hand.landmarks) : null;
    this.prevRoll = pose?.roll ?? null;
    this.prevPitch = pose?.pitch ?? null;
    logger.info(`grabbed ${hoveredShape.geometry.type}`);
  }

  /**
   * Stroke storage: ONE pre-allocated Float32Array per stroke, ONE
   * BufferAttribute attached at start, then in-place writes + setDrawRange.
   * The previous version allocated a fresh BufferAttribute every frame, which
   * leaked GPU buffers under WebGPU and could freeze the page after a few
   * seconds of holding a pinch in empty space.
   */
  private startStrokeDrag(handId: number): void {
    this.dragKind = 'stroke';
    this.dragHandId = handId;
    this.currentStrokeBuffer = new Float32Array(MAX_STROKE_POINTS * 3);
    this.currentStrokeCount = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.currentStrokeBuffer, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: 0x4ad295 });
    this.currentStroke = new THREE.Line(geo, mat);
    this.strokes.add(this.currentStroke);
  }

  private continueShapeDrag(
    handId: number,
    hands: readonly HandFrame[],
    camera: THREE.PerspectiveCamera,
    raycaster: THREE.Raycaster,
  ): void {
    if (!this.grabbedObject) return;
    const hand = hands.find((h) => h.id === handId);
    const tip = hand?.landmarks[8];
    if (!hand || !tip) return;
    if (!Number.isFinite(tip.x) || !Number.isFinite(tip.y)) return;
    this._ndc.set((1 - tip.x) * 2 - 1, -(tip.y * 2 - 1));
    raycaster.setFromCamera(this._ndc, camera);
    this.grabbedDepth = estimateDepth(hand.landmarks);
    raycaster.ray.at(this.grabbedDepth, this._scratchA);
    if (!Number.isFinite(this._scratchA.x) || !Number.isFinite(this._scratchA.y) || !Number.isFinite(this._scratchA.z)) return;
    this.grabbedObject.position.copy(this._scratchA).add(this.grabbedOffset);
  }

  private continueStroke(
    handId: number,
    hands: readonly HandFrame[],
    camera: THREE.PerspectiveCamera,
    raycaster: THREE.Raycaster,
  ): void {
    if (!this.currentStroke || !this.currentStrokeBuffer) return;
    if (this.currentStrokeCount >= MAX_STROKE_POINTS) return;

    const hand = hands.find((h) => h.id === handId);
    const tip = hand?.landmarks[8];
    if (!hand || !tip) return;
    this._ndc.set((1 - tip.x) * 2 - 1, -(tip.y * 2 - 1));
    raycaster.setFromCamera(this._ndc, camera);
    const p = this._scratchA;
    raycaster.ray.at(estimateDepth(hand.landmarks), p);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    if (this.currentStrokeCount > 0 && this.lastStrokePoint.distanceTo(p) < 0.02) return;

    const off = this.currentStrokeCount * 3;
    this.currentStrokeBuffer[off]     = p.x;
    this.currentStrokeBuffer[off + 1] = p.y;
    this.currentStrokeBuffer[off + 2] = p.z;
    this.currentStrokeCount += 1;

    const attr = this.currentStroke.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.currentStroke.geometry.setDrawRange(0, this.currentStrokeCount);
    this.lastStrokePoint.copy(p);
  }

  /**
   * Map the dragging hand's per-frame wrist roll/pitch onto the grabbed
   * object's local Y/X axes. Each axis has a deadzone + gain that's
   * tunable from Tweakpane.
   */
  private applyWristRotation(handId: number, hands: readonly HandFrame[]): void {
    if (!this.grabbedObject) return;
    const hand = hands.find((h) => h.id === handId);
    const pose = hand ? extractHandPose(hand.landmarks) : null;
    if (!pose) return;

    if (this.prevRoll !== null) {
      // Roll IS angular — wrap so a ±π crossing produces a small Δ.
      const dRoll = wrapAngle(pose.roll - this.prevRoll);
      if (Number.isFinite(dRoll) && Math.abs(dRoll) > params.objectRotate.rollDeadzone) {
        this.grabbedObject.rotation.y += dRoll * params.objectRotate.rollGain;
      }
    }
    if (this.prevPitch !== null) {
      // Pitch is a normalized depth signal (lm9.z − lm0.z), NOT angular,
      // so it doesn't wrap. Raw subtraction is correct here.
      const dPitch = pose.pitch - this.prevPitch;
      if (Number.isFinite(dPitch) && Math.abs(dPitch) > params.objectRotate.pitchDeadzone) {
        this.grabbedObject.rotation.x += dPitch * params.objectRotate.pitchGain;
      }
    }
    this.prevRoll = pose.roll;
    this.prevPitch = pose.pitch;
  }

  private endDrag(): void {
    if (this.dragKind === 'shape' && this.grabbedObject) {
      logger.info(`released ${this.grabbedObject.geometry.type}`);
    }
    this.dragKind = null;
    this.dragHandId = null;
    this.grabbedObject = null;
    this.currentStroke = null;
    this.currentStrokeBuffer = null;
    this.currentStrokeCount = 0;
    this.prevRoll = null;
    this.prevPitch = null;
  }

  /**
   * Three-tier hover feedback.
   *   armingFactor 0..1 brightens the emissive on the hovered shape.
   *   armingFactor === 0 + hovered = base hover. armingFactor → 1 = ready
   *   to grab.
   */
  private setHovered(hovered: THREE.Mesh | null, armingFactor: number): void {
    for (const m of this.grabbables) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const base = m.userData.baseColor as number;
      if (m === hovered) {
        const armed = clamp(armingFactor, 0, 1);
        // Hue shifts slightly toward warm when armed; intensity grows.
        const hex = armed > 0.5 ? 0xf0b429 : 0x4ad295;
        mat.emissive.setHex(hex);
        mat.emissiveIntensity = 0.3 + armed * 0.7;
      } else {
        mat.emissive.setHex(base);
        mat.emissiveIntensity = 0;
      }
    }
  }
}

