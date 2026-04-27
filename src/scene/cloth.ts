/**
 * Verlet cloth — minimal but enough for a believable drape.
 *
 * Vertices are stored in a single Float32Array so the same buffer can be
 * handed to a Three.js BufferAttribute (zero-copy). Constraints are
 * structural (axis-aligned neighbours) plus shear (diagonals) for stiffness.
 *
 * Keep this module Three.js-free where possible — it's just numbers and
 * arrays. The scene wrapper around it owns rendering.
 */

import type { Vec3 } from '../config/types.js';

export interface ClothConfig {
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** World-space centre of the *top edge* of the cloth before settling. */
  origin: Vec3;
  /** Per-second velocity retention (1 = no damping, 0 = freeze). */
  damping: number;
  gravity: Vec3;
  constraintIterations: number;
  /** AABB collider — vertices are pushed to its nearest face if they end up inside. */
  box: { min: Vec3; max: Vec3 } | null;
  /** Axis-aligned ground plane (y=value); vertices clamped above. null = no ground. */
  groundY: number | null;
}

export class ClothSim {
  readonly positions: Float32Array;
  private readonly prev: Float32Array;
  private readonly links: ReadonlyArray<readonly [number, number, number]>;
  private readonly cfg: ClothConfig;
  private grabbed: number | null = null;
  private grabTarget: Vec3 = { x: 0, y: 0, z: 0 };
  private accumulator = 0;
  private readonly fixedDt = 1 / 120;

  constructor(cfg: ClothConfig) {
    this.cfg = cfg;
    const n = cfg.cols * cfg.rows;
    this.positions = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);

    // Lay out the cloth as a horizontal sheet centred on `origin`. Springs
    // are then satisfied by Verlet integration → it falls and drapes.
    const stepX = cfg.width / (cfg.cols - 1);
    const stepZ = cfg.height / (cfg.rows - 1);
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        const i = (r * cfg.cols + c) * 3;
        this.positions[i] = cfg.origin.x - cfg.width / 2 + c * stepX;
        this.positions[i + 1] = cfg.origin.y;
        this.positions[i + 2] = cfg.origin.z - cfg.height / 2 + r * stepZ;
        this.prev[i] = this.positions[i]!;
        this.prev[i + 1] = this.positions[i + 1]!;
        this.prev[i + 2] = this.positions[i + 2]!;
      }
    }

    // Build constraint links: structural (4-neighbour) + shear (diagonals).
    const links: Array<[number, number, number]> = [];
    const idx = (r: number, c: number) => r * cfg.cols + c;
    const dist = (a: number, b: number) => {
      const ax = this.positions[a * 3]!;
      const ay = this.positions[a * 3 + 1]!;
      const az = this.positions[a * 3 + 2]!;
      const bx = this.positions[b * 3]!;
      const by = this.positions[b * 3 + 1]!;
      const bz = this.positions[b * 3 + 2]!;
      return Math.hypot(bx - ax, by - ay, bz - az);
    };
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        const i = idx(r, c);
        if (c + 1 < cfg.cols) { const j = idx(r, c + 1); links.push([i, j, dist(i, j)]); }
        if (r + 1 < cfg.rows) { const j = idx(r + 1, c); links.push([i, j, dist(i, j)]); }
        if (c + 1 < cfg.cols && r + 1 < cfg.rows) {
          const j = idx(r + 1, c + 1); links.push([i, j, dist(i, j)]);
          const k = idx(r + 1, c); const l = idx(r, c + 1); links.push([k, l, dist(k, l)]);
        }
      }
    }
    this.links = links;
  }

  setGrabbed(idx: number | null, target?: Vec3): void {
    this.grabbed = idx;
    if (target) this.grabTarget = { ...target };
  }

  updateGrabTarget(target: Vec3): void {
    this.grabTarget = { ...target };
  }

  getGrabbedIndex(): number | null { return this.grabbed; }

  vertex(i: number, out: Vec3): Vec3 {
    out.x = this.positions[i * 3]!;
    out.y = this.positions[i * 3 + 1]!;
    out.z = this.positions[i * 3 + 2]!;
    return out;
  }

  /**
   * Step the cloth simulation forward. Uses an internal accumulator so
   * physics runs at a fixed substep regardless of frame rate — keeps the
   * drape stable when frames hitch.
   */
  step(dtMs: number): void {
    this.accumulator += Math.min(0.05, dtMs / 1000); // cap dt to 50ms to avoid blow-up
    while (this.accumulator >= this.fixedDt) {
      this.substep(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }
  }

  private substep(dt: number): void {
    const n = this.cfg.cols * this.cfg.rows;
    const damp = Math.pow(this.cfg.damping, dt);
    const gx = this.cfg.gravity.x * dt * dt;
    const gy = this.cfg.gravity.y * dt * dt;
    const gz = this.cfg.gravity.z * dt * dt;

    for (let i = 0; i < n; i++) {
      if (i === this.grabbed) {
        const k = i * 3;
        this.positions[k]     = this.grabTarget.x;
        this.positions[k + 1] = this.grabTarget.y;
        this.positions[k + 2] = this.grabTarget.z;
        this.prev[k]     = this.grabTarget.x;
        this.prev[k + 1] = this.grabTarget.y;
        this.prev[k + 2] = this.grabTarget.z;
        continue;
      }
      const k = i * 3;
      const px = this.positions[k]!, py = this.positions[k + 1]!, pz = this.positions[k + 2]!;
      const vx = (px - this.prev[k]!) * damp;
      const vy = (py - this.prev[k + 1]!) * damp;
      const vz = (pz - this.prev[k + 2]!) * damp;
      this.prev[k] = px; this.prev[k + 1] = py; this.prev[k + 2] = pz;
      this.positions[k]     = px + vx + gx;
      this.positions[k + 1] = py + vy + gy;
      this.positions[k + 2] = pz + vz + gz;
    }

    for (let it = 0; it < this.cfg.constraintIterations; it++) {
      // Distance constraints
      for (const [a, b, rest] of this.links) {
        const aIdx = a * 3, bIdx = b * 3;
        const ax = this.positions[aIdx]!, ay = this.positions[aIdx + 1]!, az = this.positions[aIdx + 2]!;
        const bx = this.positions[bIdx]!, by = this.positions[bIdx + 1]!, bz = this.positions[bIdx + 2]!;
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-6) continue;
        const diff = (d - rest) / d * 0.5;
        const ox = dx * diff, oy = dy * diff, oz = dz * diff;
        const aLocked = a === this.grabbed;
        const bLocked = b === this.grabbed;
        if (!aLocked && !bLocked) {
          this.positions[aIdx]     = ax + ox;
          this.positions[aIdx + 1] = ay + oy;
          this.positions[aIdx + 2] = az + oz;
          this.positions[bIdx]     = bx - ox;
          this.positions[bIdx + 1] = by - oy;
          this.positions[bIdx + 2] = bz - oz;
        } else if (aLocked && !bLocked) {
          this.positions[bIdx]     = bx - 2 * ox;
          this.positions[bIdx + 1] = by - 2 * oy;
          this.positions[bIdx + 2] = bz - 2 * oz;
        } else if (!aLocked && bLocked) {
          this.positions[aIdx]     = ax + 2 * ox;
          this.positions[aIdx + 1] = ay + 2 * oy;
          this.positions[aIdx + 2] = az + 2 * oz;
        }
      }

      // Box & ground collisions
      const box = this.cfg.box;
      const groundY = this.cfg.groundY;
      for (let i = 0; i < n; i++) {
        if (i === this.grabbed) continue;
        const k = i * 3;
        const x = this.positions[k]!, y = this.positions[k + 1]!, z = this.positions[k + 2]!;
        if (groundY !== null && y < groundY) {
          this.positions[k + 1] = groundY;
          // friction on ground contact
          this.prev[k]     = this.positions[k]!     - (this.positions[k]!     - this.prev[k]!)     * 0.85;
          this.prev[k + 2] = this.positions[k + 2]! - (this.positions[k + 2]! - this.prev[k + 2]!) * 0.85;
        }
        if (box && x > box.min.x && x < box.max.x && y > box.min.y && y < box.max.y && z > box.min.z && z < box.max.z) {
          // Push to nearest face
          const dxMin = x - box.min.x, dxMax = box.max.x - x;
          const dyMin = y - box.min.y, dyMax = box.max.y - y;
          const dzMin = z - box.min.z, dzMax = box.max.z - z;
          const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
          if (m === dxMin) this.positions[k] = box.min.x;
          else if (m === dxMax) this.positions[k] = box.max.x;
          else if (m === dyMin) this.positions[k + 1] = box.min.y;
          else if (m === dyMax) this.positions[k + 1] = box.max.y;
          else if (m === dzMin) this.positions[k + 2] = box.min.z;
          else this.positions[k + 2] = box.max.z;
          // friction
          this.prev[k]     = this.positions[k]!     - (this.positions[k]!     - this.prev[k]!)     * 0.92;
          this.prev[k + 2] = this.positions[k + 2]! - (this.positions[k + 2]! - this.prev[k + 2]!) * 0.92;
        }
      }
    }
  }
}
