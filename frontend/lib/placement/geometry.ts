import type { OrientedBoundingBox } from '@/lib/contracts';
import type { Vec2 } from './types';

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
};

/** Plan-space front direction for a yaw (front = local +Z). */
export const frontOf = (yaw: number): Vec2 => [Math.sin(yaw), Math.cos(yaw)];
/** Yaw whose front points along `dir`. */
export const yawFacing = (dir: Vec2): number => Math.atan2(dir[0], dir[1]);
/** Yaw whose local +X axis points along `dir`. */
export const yawAlong = (dir: Vec2): number => Math.atan2(-dir[1], dir[0]);

/** Footprint corners of an OBB in plan [x, z], counter-clockwise order not guaranteed but convex and consistent. */
export function footprint(obb: OrientedBoundingBox): Vec2[] {
  return rectCorners([obb.center[0], obb.center[2]], obb.size[0], obb.size[2], obb.yaw);
}

export function rectCorners(center: Vec2, width: number, depth: number, yaw: number): Vec2[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const hw = width / 2;
  const hd = depth / 2;
  // three.js Ry: local +X -> (cos, -sin), local +Z -> (sin, cos)
  const ax: Vec2 = [c * hw, -s * hw];
  const az: Vec2 = [s * hd, c * hd];
  const [cx, cz] = center;
  return [
    [cx - ax[0] - az[0], cz - ax[1] - az[1]],
    [cx + ax[0] - az[0], cz + ax[1] - az[1]],
    [cx + ax[0] + az[0], cz + ax[1] + az[1]],
    [cx - ax[0] + az[0], cz - ax[1] + az[1]],
  ];
}

function project(poly: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p[0] * axis[0] + p[1] * axis[1];
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/**
 * Separating-axis test for convex polygons. Returns the minimum penetration depth
 * across all edge normals; <= 0 means the polygons are separated (or just touching).
 */
export function penetration(a: Vec2[], b: Vec2[]): number {
  let best = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const axis = normalize([-(q[1] - p[1]), q[0] - p[0]]);
      if (axis[0] === 0 && axis[1] === 0) continue;
      const [amin, amax] = project(a, axis);
      const [bmin, bmax] = project(b, axis);
      const overlap = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (overlap <= 0) return overlap;
      if (overlap < best) best = overlap;
    }
  }
  return best;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return len(sub(p, add(a, scale(ab, t))));
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointPolygonDistance(p: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, pointSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return best;
}

/** Distance between two convex polygons; 0 when they intersect. */
export function polygonDistance(a: Vec2[], b: Vec2[]): number {
  if (penetration(a, b) > 0) return 0;
  let best = Infinity;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    for (const p of from) {
      for (let i = 0; i < to.length; i++) {
        best = Math.min(best, pointSegmentDistance(p, to[i], to[(i + 1) % to.length]));
      }
    }
  }
  return best;
}

/** Keeps the part of a convex polygon where (q - origin)·normal >= 0. */
export function clipHalfPlane(poly: Vec2[], origin: Vec2, normal: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = dot(sub(p, origin), normal);
    const dq = dot(sub(q, origin), normal);
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq);
      out.push(add(p, scale(sub(q, p), t)));
    }
  }
  return out;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return poly.length ? [x / poly.length, z / poly.length] : [0, 0];
}

/** Overlap length of two 1-D intervals (negative when disjoint). */
export const intervalOverlap = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  Math.min(aMax, bMax) - Math.max(aMin, bMin);
