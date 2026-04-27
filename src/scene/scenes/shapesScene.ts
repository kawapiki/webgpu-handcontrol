/**
 * "Shapes" demo: a cluster of grabbable primitives plus a pointer cursor.
 *
 * Honours the global mode:
 *   pointer — index-finger ray + hover highlight + air-tap to spin a shape.
 *   move    — closed-fist grab translates the shape under the palm.
 *   draw    — pinch-and-drag emits a line stroke in 3D space.
 */

import * as THREE from 'three/webgpu';

import { params } from '../../config/parameters.js';
import type { GestureState } from '../../config/types.js';
import { logger } from '../../debug/logger.js';
import type { GrabData } from '../../gestures/grab.js';
import type { PinchData } from '../../gestures/pinch.js';
import type { PointData } from '../../gestures/point.js';
import { buildPointerRay, pickNearest } from '../raycaster.js';
import type { DemoScene, SceneStepInput } from './types.js';

export class ShapesScene implements DemoScene {
  readonly name = 'shapes';
  readonly label = 'Shapes';
  readonly root = new THREE.Group();

  private readonly cursor: THREE.Mesh;
  private readonly grabbables: THREE.Mesh[] = [];
  private readonly strokes = new THREE.Group();
  private grabbedObject: THREE.Mesh | null = null;
  private grabbedOffset = new THREE.Vector3();
  private currentStroke: THREE.Line | null = null;
  private lastStrokePoint = new THREE.Vector3();

  constructor() {
    // Pointer cursor — small bright sphere.
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
    this.releaseGrab();
    this.endStroke();
    this.cursor.visible = false;
    this.setHovered(null);
  }

  step(input: SceneStepInput): void {
    switch (input.mode) {
      case 'pointer': return this.stepPointer(input);
      case 'move':    return this.stepMove(input);
      case 'draw':    return this.stepDraw(input);
    }
  }

  private setHovered(hovered: THREE.Mesh | null): void {
    for (const m of this.grabbables) {
      const mat = m.material as THREE.MeshStandardMaterial;
      const base = m.userData.baseColor as number;
      if (m === hovered) {
        mat.emissive.setHex(0x4ad295);
        mat.emissiveIntensity = 0.4;
      } else {
        mat.emissive.setHex(base);
        mat.emissiveIntensity = 0;
      }
    }
  }

  private stepPointer({ hands, states, camera, raycaster }: SceneStepInput): void {
    const point = states['point'] as GestureState<PointData> | undefined;
    const pinch = states['pinch'] as GestureState<PinchData> | undefined;

    if (!point?.active || !point.data.tip) {
      this.cursor.visible = false;
      this.setHovered(null);
      return;
    }

    const hand = hands.find((h) => h.id === point.data.handId);
    const mcp = hand?.landmarks[5] ?? point.data.tip;
    buildPointerRay(camera, point.data.tip, mcp, raycaster);

    const hovered = pickNearest(raycaster, this.grabbables);
    this.setHovered(hovered);

    const cursorPos = new THREE.Vector3();
    if (hovered) {
      const hits = raycaster.intersectObject(hovered, false);
      if (hits[0]) cursorPos.copy(hits[0].point);
    } else {
      raycaster.ray.at(4, cursorPos);
    }
    this.cursor.position.copy(cursorPos);
    this.cursor.visible = true;

    if (pinch?.data.tappedAt && hovered) {
      const lastTapHandled = (this.cursor.userData.lastTapHandled as number) ?? 0;
      if (pinch.data.tappedAt !== lastTapHandled) {
        this.cursor.userData.lastTapHandled = pinch.data.tappedAt;
        hovered.userData.spin = (hovered.userData.spin ?? 0) + Math.PI;
        logger.info(`tap on ${hovered.geometry.type}`);
      }
    }
    for (const m of this.grabbables) {
      const spin = (m.userData.spin as number) ?? 0;
      if (spin !== 0) {
        const stepAmt = Math.sign(spin) * Math.min(Math.abs(spin), 0.15);
        m.rotation.y += stepAmt;
        m.userData.spin = spin - stepAmt;
      }
    }
  }

  private stepMove({ hands, states, camera, raycaster }: SceneStepInput): void {
    const grab = states['grab'] as GestureState<GrabData> | undefined;
    if (!grab?.active || grab.data.handId === null) {
      this.releaseGrab();
      return;
    }
    const hand = hands.find((h) => h.id === grab.data.handId);
    if (!hand) return;

    if (!this.grabbedObject) {
      const palmNorm = hand.metrics.palm;
      const ndc = new THREE.Vector2((1 - palmNorm.x) * 2 - 1, -(palmNorm.y * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      const hovered = pickNearest(raycaster, this.grabbables);
      if (!hovered) return;
      this.grabbedObject = hovered;
      const target = new THREE.Vector3();
      raycaster.ray.at(hovered.position.distanceTo(camera.position), target);
      this.grabbedOffset.copy(hovered.position).sub(target);
      logger.info(`grabbed ${hovered.geometry.type}`);
    }

    const palmNorm = hand.metrics.palm;
    const ndc = new THREE.Vector2((1 - palmNorm.x) * 2 - 1, -(palmNorm.y * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const target = new THREE.Vector3();
    const distFromCam = this.grabbedObject.position.distanceTo(camera.position);
    raycaster.ray.at(distFromCam, target);
    this.grabbedObject.position.copy(target).add(this.grabbedOffset);

    const zBias = (palmNorm.z ?? 0) * params.scene.grabGain;
    this.grabbedObject.position.z += zBias * 0.05;
  }

  private stepDraw({ states, camera, raycaster }: SceneStepInput): void {
    const point = states['point'] as GestureState<PointData> | undefined;
    const pinch = states['pinch'] as GestureState<PinchData> | undefined;
    if (!point?.active || !point.data.tip || !pinch?.active) {
      this.endStroke();
      return;
    }
    const ndc = new THREE.Vector2((1 - point.data.tip.x) * 2 - 1, -(point.data.tip.y * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    raycaster.ray.at(4, p);
    if (this.currentStroke && this.lastStrokePoint.distanceTo(p) < 0.02) return;
    this.currentStroke = appendStrokePoint(this.strokes, this.currentStroke, p);
    this.lastStrokePoint.copy(p);
  }

  private endStroke(): void { this.currentStroke = null; }

  private releaseGrab(): void {
    if (this.grabbedObject) {
      logger.info(`released ${this.grabbedObject.geometry.type}`);
      this.grabbedObject = null;
    }
  }
}

function appendStrokePoint(parent: THREE.Group, current: THREE.Line | null, point: THREE.Vector3): THREE.Line {
  if (!current) {
    const geo = new THREE.BufferGeometry().setFromPoints([point.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0x4ad295 });
    const line = new THREE.Line(geo, mat);
    parent.add(line);
    return line;
  }
  const positions = (current.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const len = positions.length / 3;
  const next = new Float32Array(positions.length + 3);
  next.set(positions);
  next[len * 3] = point.x;
  next[len * 3 + 1] = point.y;
  next[len * 3 + 2] = point.z;
  current.geometry.setAttribute('position', new THREE.BufferAttribute(next, 3));
  current.geometry.computeBoundingSphere();
  return current;
}
