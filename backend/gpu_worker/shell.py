"""Bake shell (floor / wall) appearance from the splat into textures Pascal can map without schema changes.

Pascal (@pascal-app/viewer 1.x) maps textures with world-planar UVs in meters and `material.texture.repeat`
(no offset field): slab tops use uv = (x, -z); wall faces use v = 1 - y and u = +-z (|n.x| dominant) or
+-x (|n.z| dominant) by the face normal's sign. With repeat r = 1/P the image tiles every P meters from the
world origin, so we bake the face into a P-sized tile and roll it so world coordinates land on the right
texels. Textures load with flipY = true, hence the final vertical flip.
Holes (where objects stood, or never observed) are filled with OpenCV Telea inpainting.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from gpu_worker.splat import Splat


@dataclass
class BakedTexture:
    image: np.ndarray  # (H, W, 3) uint8, ready to save as PNG
    repeat: tuple  # material.texture.repeat
    coverage: float  # fraction of the face observed before inpainting


def _bake(u, v, colors, weights, radii, u_range, v_range, px_per_m: int, margin: float = 0.25) -> BakedTexture:
    import cv2

    u0, v0 = np.floor(u_range[0] * px_per_m) / px_per_m, np.floor(v_range[0] * px_per_m) / px_per_m
    span_u, span_v = u_range[1] - u0, v_range[1] - v0
    w, h = int(np.ceil((span_u + margin) * px_per_m)), int(np.ceil((span_v + margin) * px_per_m))
    cu, cv_ = int(np.ceil(span_u * px_per_m)), int(np.ceil(span_v * px_per_m))
    col0 = np.floor((u - u0) * px_per_m).astype(int)
    row0 = np.floor((v - v0) * px_per_m).astype(int)
    acc = np.zeros((h * w, 3))
    wsum = np.zeros(h * w)
    r_px = np.maximum(np.round(radii * px_per_m).astype(int), 0)
    rmax = int(r_px.max()) if len(r_px) else 0
    # splat each Gaussian as a disc of its own radius so sparse splats still cover the face
    for dy in range(-rmax, rmax + 1):
        for dx in range(-rmax, rmax + 1):
            col, row = col0 + dx, row0 + dy
            ok = (dx * dx + dy * dy <= r_px * r_px) & (col >= 0) & (col < cu) & (row >= 0) & (row < cv_)
            flat = row[ok] * w + col[ok]
            np.add.at(acc, flat, colors[ok] * weights[ok, None])
            np.add.at(wsum, flat, weights[ok])
    img = (np.clip(acc / np.maximum(wsum, 1e-9)[:, None], 0, 1) * 255).astype(np.uint8).reshape(h, w, 3)
    covered = (wsum > 0).reshape(h, w)
    domain = np.zeros((h, w), bool)
    domain[:cv_, :cu] = True
    coverage = float(covered[domain].mean())
    img = cv2.inpaint(img, (domain & ~covered).astype(np.uint8), 3, cv2.INPAINT_TELEA)
    # local texel (row, col) sits at world (v0 + row/px, u0 + col/px); tile texel = that coordinate mod P.
    img = np.roll(img, (round(v0 * px_per_m) % h, round(u0 * px_per_m) % w), axis=(0, 1))
    return BakedTexture(np.ascontiguousarray(img[::-1]), (px_per_m / w, px_per_m / h), coverage)


def bake_floor(splat: Splat, shell_mask: np.ndarray, outline, px_per_m: int = 100, band: float = 0.05) -> BakedTexture:
    poly = np.asarray(outline, float)
    sel = shell_mask & (np.abs(splat.means[:, 1]) < band)
    m = splat.means[sel]
    u, v = m[:, 0], -m[:, 2]
    radii = splat.scales[sel].mean(axis=1)
    u_range, v_range = (poly[:, 0].min(), poly[:, 0].max()), (-poly[:, 1].max(), -poly[:, 1].min())
    return _bake(u, v, splat.colors[sel], splat.opacities[sel], radii, u_range, v_range, px_per_m)


def bake_wall(
    splat: Splat,
    shell_mask: np.ndarray,
    start,
    end,
    height: float,
    room_center,
    px_per_m: int = 100,
    band: float = 0.08,
) -> BakedTexture:
    """Bake the room-facing face of a wall segment (scene frame, start/end on the floor)."""
    a, b = np.asarray(start, float)[[0, 2]], np.asarray(end, float)[[0, 2]]
    t = (b - a) / np.linalg.norm(b - a)
    n = np.array([-t[1], t[0]])
    rc = np.asarray(room_center, float)
    if ((rc[[0, 2]] if len(rc) == 3 else rc) - a) @ n < 0:
        n = -n
    xz = splat.means[:, [0, 2]] - a
    along, off = xz @ t, xz @ n
    sel = shell_mask & (np.abs(off) < band) & (along >= 0) & (along <= np.linalg.norm(b - a))
    m = splat.means[sel]
    ends = np.array([a, b])
    if abs(n[0]) >= abs(n[1]):
        sign, axis = (1.0 if n[0] >= 0 else -1.0), 1  # u = +-z
    else:
        sign, axis = (1.0 if n[1] >= 0 else -1.0), 0  # u = +-x
    u = sign * m[:, [0, 2]][:, axis]
    u_ends = sign * ends[:, axis]
    v = 1 - m[:, 1]
    radii = splat.scales[sel].mean(axis=1)
    u_range, v_range = (u_ends.min(), u_ends.max()), (1 - height, 1.0)
    return _bake(u, v, splat.colors[sel], splat.opacities[sel], radii, u_range, v_range, px_per_m)
