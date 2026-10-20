/**
 * 2D (XZ-plane) geometry helpers for placement validation.
 * Frame: Y-up, meters. Yaw follows three.js: local +X -> (cos, -sin), local +Z -> (sin, cos),
 * so an item's "front" (local +Z) points along (sin yaw, cos yaw) in (x, z).
 */

export type Vec2 = [number, number];
export type Poly = Vec2[];

export interface Obb2 {
  cx: number;
  cz: number;
  /** Half extents along local X (width) and local Z (depth). */
  hx: number;
  hz: number;
  yaw: number;
  /** Unit local X axis and local Z axis (front) in world XZ. */
  ax: Vec2;
  az: Vec2;
  corners: Poly;
}

export function makeObb2(cx: number, cz: number, hx: number, hz: number, yaw: number): Obb2 {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const ax: Vec2 = [c, -s];
  const az: Vec2 = [s, c];
  const corner = (u: number, v: number): Vec2 => [
    cx + ax[0] * u * hx + az[0] * v * hz,
    cz + ax[1] * u * hx + az[1] * v * hz,
  ];
  return { cx, cz, hx, hz, yaw, ax, az, corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] };
}

export function frontOf(yaw: number): Vec2 {
  return [Math.sin(yaw), Math.cos(yaw)];
}

export function yawFacing(dx: number, dz: number): number {
  let y = Math.atan2(dx, dz);
  if (y <= -Math.PI + 1e-9) y = Math.PI; // canonical range (-π, π]
  const r = Math.round(y * 1e9) / 1e9;
  return r === 0 ? 0 : r;
}

export function pointInPolygon(p: Vec2, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export function distPointPolygonEdge(p: Vec2, poly: Poly): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distPointSegment(p, poly[j], poly[i]));
  return d;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** True when segments cross at interior points of both (touching/collinear does not count). */
export function segmentsProperlyCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps = 1e-9): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
}

/**
 * Whether `inner` lies within `outer` (outer may be concave). Vertices may sit within `tol`
 * of the boundary; any proper edge crossing means containment fails.
 */
export function polygonContains(outer: Poly, inner: Poly, tol = 0.01): boolean {
  for (const p of inner) {
    if (!pointInPolygon(p, outer) && distPointPolygonEdge(p, outer) > tol) return false;
  }
  for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
    for (let k = 0, l = outer.length - 1; k < outer.length; l = k++) {
      if (segmentsProperlyCross(inner[j], inner[i], outer[l], outer[k], 1e-6)) return false;
    }
  }
  return true;
}

function project(poly: Poly, ax: number, az: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = p[0] * ax + p[1] * az;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

export interface SeparationResult {
  /** > 0: gap along the best separating axis (lower bound of true distance); < 0: penetration depth. */
  gap: number;
  axis: Vec2;
  /** Overlap length of both shapes along the direction perpendicular to `axis`. */
  lateralOverlap: number;
}

/** SAT for two convex polygons. */
export function convexSeparation(p: Poly, q: Poly): SeparationResult {
  let best = -Infinity;
  let bestAxis: Vec2 = [1, 0];
  for (const poly of [p, q]) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      let ax = poly[i][1] - poly[j][1];
      let az = poly[j][0] - poly[i][0];
      const len = Math.hypot(ax, az);
      if (len < 1e-12) continue;
      ax /= len;
      az /= len;
      const [pl, ph] = project(p, ax, az);
      const [ql, qh] = project(q, ax, az);
      const gap = Math.max(ql - ph, pl - qh);
      if (gap > best) {
        best = gap;
        bestAxis = [ax, az];
      }
    }
  }
  const [pl, ph] = project(p, -bestAxis[1], bestAxis[0]);
  const [ql, qh] = project(q, -bestAxis[1], bestAxis[0]);
  return { gap: best, axis: bestAxis, lateralOverlap: Math.min(ph, qh) - Math.max(pl, ql) };
}

/** Sector (quarter disc) polygon: apex, radius, from direction u sweeping 90° toward n. Convex. */
export function sectorPolygon(apex: Vec2, u: Vec2, n: Vec2, radius: number, segments = 8): Poly {
  const pts: Poly = [apex];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * (Math.PI / 2);
    pts.push([apex[0] + radius * (Math.cos(t) * u[0] + Math.sin(t) * n[0]), apex[1] + radius * (Math.cos(t) * u[1] + Math.sin(t) * n[1])]);
  }
  return pts;
}

export function polygonCentroid(poly: Poly): Vec2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cz += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return poly[0] ?? [0, 0];
  return [cx / (3 * a), cz / (3 * a)];
}

export function polygonBounds(poly: Poly): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** Cheap lower bound on the gap between two OBBs (centre distance minus circumradii); may be negative. */
export function obbBroadGap(a: Obb2, b: Obb2): number {
  const dx = a.cx - b.cx;
  const dz = a.cz - b.cz;
  return Math.sqrt(dx * dx + dz * dz) - Math.sqrt(a.hx * a.hx + a.hz * a.hz) - Math.sqrt(b.hx * b.hx + b.hz * b.hz);
}
