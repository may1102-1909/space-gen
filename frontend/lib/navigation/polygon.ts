/** Planar (x, z) polygon helpers for confining the camera to a room. Pure, no three.js. */
export type Pt = [number, number];

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface BoundaryHit {
  point: Pt;
  distance: number;
  /** Unit normal of the edge the point lies on (arbitrary side). */
  normal: Pt;
}

/** Closest point on the polygon boundary (all edges) to p. */
export function closestPointOnPolygon(p: Pt, poly: Pt[]): BoundaryHit {
  let best: BoundaryHit = { point: poly[0], distance: Infinity, normal: [0, 1] };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
    const q: Pt = [a[0] + t * dx, a[1] + t * dz];
    const distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (distance < best.distance) {
      const len = Math.sqrt(len2) || 1;
      best = { point: q, distance, normal: [-dz / len, dx / len] };
    }
  }
  return best;
}

export function polygonCentroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

/**
 * A point inside the polygon at least `margin` from the nearest wall.
 * Points already comfortably inside are returned unchanged; outside points are projected onto the
 * boundary and pushed inward along the edge normal (works for concave rooms such as an L).
 */
export function clampToPolygon(p: Pt, poly: Pt[], margin = 0.25): Pt {
  if (poly.length < 3) return p;
  const inside = pointInPolygon(p, poly);
  const hit = closestPointOnPolygon(p, poly);
  if (inside && hit.distance >= margin) return p;
  const eps = 1e-4;
  const valid = (q: Pt) => pointInPolygon(q, poly) && closestPointOnPolygon(q, poly).distance >= margin - eps;
  for (const sign of [1, -1]) {
    // Push inward from the boundary point, then relax away from whichever wall is still too close (corners).
    let q: Pt = [hit.point[0] + hit.normal[0] * sign * margin, hit.point[1] + hit.normal[1] * sign * margin];
    for (let i = 0; i < 6 && pointInPolygon(q, poly) && !valid(q); i++) {
      const h = closestPointOnPolygon(q, poly);
      const d = h.distance || 1e-6;
      const push = margin - h.distance;
      q = [q[0] + ((q[0] - h.point[0]) / d) * push, q[1] + ((q[1] - h.point[1]) / d) * push];
    }
    if (valid(q)) return q;
  }
  // Sharp or narrow geometry: the valid grid point nearest to p.
  const xs = poly.map((v) => v[0]);
  const zs = poly.map((v) => v[1]);
  const step = 0.05;
  let best: Pt | null = null;
  let bestDist = Infinity;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) {
      const d = Math.hypot(x - p[0], z - p[1]);
      if (d < bestDist && valid([x, z])) { best = [x, z]; bestDist = d; }
    }
  }
  if (best) return best;
  const c = polygonCentroid(poly);
  return pointInPolygon(c, poly) ? c : hit.point;
}
