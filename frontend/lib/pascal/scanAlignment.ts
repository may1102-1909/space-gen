import type { Matrix4, Vector3 } from '@/lib/contracts/primitives';

export const IDENTITY_SCAN_TO_SCENE: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vector3): Vector3 => {
  const length = Math.hypot(...v);
  if (length < 1e-8) throw new Error('Floor points must not be collinear.');
  return [v[0] / length, v[1] / length, v[2] / length];
};

/**
 * Fits a best-fit plane through 3+ scan points (least-squares / PCA) and returns
 * a 4x4 matrix that maps the floor normal to +Y and translates the floor to y=0.
 */
export function floorAlignmentFromPoints(points: Vector3[]): Matrix4 {
  if (points.length < 3) throw new Error('Pick at least three floor points.');
  const n = points.length;

  const centroid: Vector3 = [0, 0, 0];
  for (const p of points) {
    centroid[0] += p[0] / n;
    centroid[1] += p[1] / n;
    centroid[2] += p[2] / n;
  }

  let normal: Vector3;

  if (n === 3) {
    const [a, b, c] = points;
    normal = normalize(cross(sub(b, a), sub(c, a)));
  } else {
    // Check for collinearity across points
    const v0 = normalize(sub(points[1], points[0]));
    let hasNonCollinear = false;
    for (let i = 2; i < n; i++) {
      const diff = sub(points[i], points[0]);
      const proj = dot(diff, v0);
      const perp = sub(diff, [v0[0] * proj, v0[1] * proj, v0[2] * proj]);
      if (Math.hypot(...perp) > 1e-5) {
        hasNonCollinear = true;
        break;
      }
    }
    if (!hasNonCollinear) throw new Error('Floor points must not be collinear.');

    // Covariance matrix C of centered points
    let c00 = 0, c01 = 0, c02 = 0;
    let c11 = 0, c12 = 0, c22 = 0;
    for (const p of points) {
      const dx = p[0] - centroid[0];
      const dy = p[1] - centroid[1];
      const dz = p[2] - centroid[2];
      c00 += dx * dx;
      c01 += dx * dy;
      c02 += dx * dz;
      c11 += dy * dy;
      c12 += dy * dz;
      c22 += dz * dz;
    }

    // Power iteration on (tr(C) + 1)*I - C to extract the eigenvector with minimum eigenvalue of C
    const tr = c00 + c11 + c22;
    const shift = tr + 1.0;
    const m00 = shift - c00, m01 = -c01, m02 = -c02;
    const m10 = -c01, m11 = shift - c11, m12 = -c12;
    const m20 = -c02, m21 = -c12, m22 = shift - c22;

    let vx = 0, vy = 1, vz = 0;
    for (let iter = 0; iter < 40; iter++) {
      const nx = m00 * vx + m01 * vy + m02 * vz;
      const ny = m10 * vx + m11 * vy + m12 * vz;
      const nz = m20 * vx + m21 * vy + m22 * vz;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-8) {
        vx = 1; vy = 0; vz = 0;
        continue;
      }
      vx = nx / len;
      vy = ny / len;
      vz = nz / len;
    }
    normal = [vx, vy, vz];
  }

  if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]];
  const axis = cross(normal, [0, 1, 0]);
  const sin = Math.hypot(...axis);
  const cos = Math.max(-1, Math.min(1, dot(normal, [0, 1, 0])));
  let rotation: number[];
  if (sin < 1e-8) {
    rotation = cos > 0
      ? [1, 0, 0, 0, 1, 0, 0, 0, 1]
      : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  } else {
    const [x, y, z] = normalize(axis);
    const k = 1 - cos;
    rotation = [
      cos + x * x * k, x * y * k - z * sin, x * z * k + y * sin,
      y * x * k + z * sin, cos + y * y * k, y * z * k - x * sin,
      z * x * k - y * sin, z * y * k + x * sin, cos + z * z * k,
    ];
  }
  const rotatedFloorY = rotation[3] * centroid[0] + rotation[4] * centroid[1] + rotation[5] * centroid[2];
  return [
    rotation[0], rotation[1], rotation[2], 0,
    rotation[3], rotation[4], rotation[5], -rotatedFloorY,
    rotation[6], rotation[7], rotation[8], 0,
    0, 0, 0, 1,
  ] as Matrix4;
}

/** Applies uniform metric scale, then Y-axis wall-square rotation to an existing transform. */
export function applyMetricAlignment(
  matrix: Matrix4,
  measuredPoints: [Vector3, Vector3],
  distanceMeters: number,
  wallYawRadians: number,
): Matrix4 {
  const [a, b] = measuredPoints;
  const currentA = transformPoint(matrix, a);
  const currentB = transformPoint(matrix, b);
  const measured = Math.hypot(...sub(currentA, currentB));
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || measured < 1e-8) {
    throw new Error('Enter a positive distance and pick two distinct points.');
  }
  const scale = distanceMeters / measured;
  const c = Math.cos(wallYawRadians);
  const s = Math.sin(wallYawRadians);
  const adjust: Matrix4 = [
    scale * c, 0, -scale * s, 0,
    0, scale, 0, 0,
    scale * s, 0, scale * c, 0,
    0, 0, 0, 1,
  ];
  return multiplyMatrix4(adjust, matrix);
}

export function multiplyMatrix4(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      for (let k = 0; k < 4; k += 1) out[row * 4 + col] += a[row * 4 + k] * b[k * 4 + col];
    }
  }
  return out as Matrix4;
}

export function transformPoint(matrix: Matrix4, point: Vector3): Vector3 {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}
