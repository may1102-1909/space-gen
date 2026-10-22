"""Training-free lifting of per-view 2D instance masks to per-Gaussian object labels.

Per view, every pixel gets the index of the detection covering it (0 = background). Two lifting rules:
- "contribution" (FlashSplat-style): each Gaussian accumulates its blending weight per pixel label
  (see Renderer.contributions); occluded Gaussians get ~0 weight so they do not vote.
- "center": the Gaussian centre is projected, depth-tested against the rendered depth and votes once
  for the label under it (the point-voting baseline, as T11 does for splat centres).
Cross-view association: detections of the same label whose majority Gaussians overlap
(|A & B| / min(|A|, |B|) >= overlap) are merged with union-find; groups seen in < min_views views are
dropped (inconsistent detector hits).
Assignment (FlashSplat's closed form with a background prior): a Gaussian joins its best instance k when
that instance's accumulated weight beats bg_weight * prior * background, where background is summed only
over the views that detected k. A view that missed the object is not evidence of absence; counting it
lets a few missed detections erase the faces only those views see.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence

import numpy as np

from gpu_worker.render import Renderer
from gpu_worker.splat import Splat
from services.object_detection.detectors import Detection2D
from services.object_detection.geometry import CameraView, fit_obb, points_in_obb
from services.object_detection.lifting import _voxel_components


@dataclass
class ObjectInstance:
    id: str
    label: str
    indices: np.ndarray
    obb: dict
    confidence: float
    n_views: int


@dataclass
class SegmentResult:
    labels: np.ndarray  # (N,) 0 = background / shell, k = instances[k - 1]
    instances: List[ObjectInstance] = field(default_factory=list)


def label_map(dets: Sequence[Detection2D], height: int, width: int) -> np.ndarray:
    """Pixel -> detection index + 1; higher-scoring masks are painted last and win overlaps."""
    lm = np.zeros((height, width), dtype=np.int64)
    for i in sorted(range(len(dets)), key=lambda i: dets[i].score):
        d = dets[i]
        if d.mask is not None:
            lm[d.mask] = i + 1
        else:
            x0, y0, x1, y1 = (int(round(v)) for v in d.box)
            lm[max(y0, 0) : y1, max(x0, 0) : x1] = i + 1
    return lm


def view_weights(
    renderer: Renderer, splat: Splat, cam: CameraView, dets: Sequence[Detection2D], method: str
) -> np.ndarray:
    lm = label_map(dets, cam.height, cam.width)
    if method == "contribution":
        return renderer.contributions(splat, cam, lm, len(dets) + 1)
    if method != "center":
        raise ValueError(f"unknown lifting method {method!r}")
    out = renderer.render(splat, cam)
    uv, z = cam.project(splat.means)
    ok = cam.in_image(uv, z)
    px, py = uv[ok, 0].astype(int), uv[ok, 1].astype(int)
    surf = out.depth[py, px]
    vis = (out.alpha[py, px] > 0.5) & (z[ok] <= surf * 1.03 + 0.05)
    votes = np.zeros((len(splat), len(dets) + 1))
    idx = np.nonzero(ok)[0][vis]
    votes[idx, lm[py[vis], px[vis]]] = 1.0
    return votes


def segment(
    splat: Splat,
    cams: Sequence[CameraView],
    detections: Sequence[Sequence[Detection2D]],
    renderer: Renderer,
    method: str = "contribution",
    min_views: int = 2,
    overlap: float = 0.3,
    bg_weight: float = 1.0,
    min_gaussians: int = 30,
    voxel: float = 0.1,
    bg_prior: Optional[np.ndarray] = None,
    unseen_margin: float = 0.05,
    unseen_weight: float = 0.1,
    floor_band: float = 0.04,
    edge: float = 0.03,
) -> SegmentResult:
    """bg_prior: optional per-Gaussian multiplier on the background score (e.g. > 1 on T10 shell planes)."""
    n = len(splat)
    seen = np.zeros(n)
    bg_views = {}  # view -> (indices, background weights)
    records = []  # (view, label, score, idx, weights, majority members)
    for v, (cam, dets) in enumerate(zip(cams, detections)):
        if not dets:
            continue
        w = view_weights(renderer, splat, cam, dets, method)
        nz0 = np.nonzero(w[:, 0] > 0)[0]
        bg_views[v] = (nz0, w[nz0, 0])
        total = w.sum(axis=1)
        seen += total
        for i, d in enumerate(dets):
            col = w[:, i + 1]
            nz = np.nonzero(col > 0)[0]
            members = nz[col[nz] > 0.5 * total[nz]]
            if len(members):
                records.append((v, d.label, d.score, nz, col[nz], members))

    # shortcut: O(R^2) pairwise overlap over detections; fine for a few hundred, bucket by label/view for more.
    parent = list(range(len(records)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(records)):
        for j in range(i + 1, len(records)):
            a, b = records[i], records[j]
            if a[1] != b[1] or a[0] == b[0]:
                continue
            inter = len(np.intersect1d(a[5], b[5], assume_unique=True))
            if inter / min(len(a[5]), len(b[5])) >= overlap:
                parent[find(i)] = find(j)

    groups: dict = {}
    for i in range(len(records)):
        groups.setdefault(find(i), []).append(i)
    groups = [g for g in groups.values() if len({records[i][0] for i in g}) >= min_views]

    fg = np.zeros((n, len(groups) + 1))
    for k, g in enumerate(groups, start=1):
        for i in g:
            np.add.at(fg[:, k], records[i][3], records[i][4])
    best = np.argmax(fg[:, 1:], axis=1) + 1 if groups else np.zeros(n, dtype=np.int64)
    best_val = fg[np.arange(n), best] if groups else np.zeros(n)
    background = np.zeros(n)
    for k, g in enumerate(groups, start=1):
        mine = best == k
        for v in {records[i][0] for i in g}:
            idx, val = bg_views[v]
            sel = mine[idx]
            np.add.at(background, idx[sel], val[sel])
    background *= bg_weight * (1.0 if bg_prior is None else bg_prior)
    labels = np.where((best_val > background) & (best_val > 0), best, 0)

    result = SegmentResult(np.zeros(n, dtype=np.int64))
    for k, g in enumerate(groups, start=1):
        idx = np.nonzero(labels == k)[0]
        if len(idx) < min_gaussians:
            continue
        comps = _voxel_components(splat.means[idx], voxel)
        idx = idx[max(comps, key=len)]  # drop mask-bleed fragments away from the main body
        if len(idx) < min_gaussians:
            continue
        # Gaussians that never covered a tenth of a pixel in any view (backs against walls, undersides) join the instance whose box holds them.
        obb = fit_obb(splat.means[idx])
        grown = np.asarray(obb["size"]) + 2 * unseen_margin
        unseen = (seen < unseen_weight) & (result.labels == 0)
        if bg_prior is not None:
            unseen &= bg_prior <= 1.0  # never pull hidden shell (floor under a sofa) into an object
        unseen = np.nonzero(unseen)[0]
        extra = unseen[points_in_obb(splat.means[unseen], obb["center"], grown, obb["yaw"])]
        idx = np.union1d(idx, extra)
        if bg_prior is not None and obb["size"][1] > 0.15:
            # floor hidden under a (non-flat) object is floor; keep a thin edge so side faces stay whole
            c, sz = obb["center"], obb["size"]
            under = points_in_obb(
                splat.means[idx], (c[0], 0.0, c[2]), (sz[0] - 2 * edge, 2 * floor_band, sz[2] - 2 * edge), obb["yaw"]
            )
            idx = idx[~(under & (bg_prior[idx] > 1.0))]
        views = {records[i][0] for i in g}
        result.instances.append(
            ObjectInstance(
                id=f"obj_{len(result.instances)}",
                label=records[g[0]][1],
                indices=idx,
                obb=fit_obb(splat.means[idx]),
                confidence=float(np.mean([records[i][2] for i in g])),  # mean detector score
                n_views=len(views),
            )
        )
        result.labels[idx] = len(result.instances)
    return result


def shell_prior(splat: Splat, interpretation: dict, band: float = 0.04, weight: float = 3.0) -> np.ndarray:
    """Background multiplier: `weight` for Gaussians on the T10 floor (y ~ 0), ceiling or wall planes."""
    y = splat.means[:, 1]
    on = (np.abs(y) < band) | (np.abs(y - float(interpretation["ceilingHeight"])) < band)
    xz = splat.means[:, [0, 2]]
    for wall in interpretation.get("walls", []):
        a, b = np.asarray(wall["start"], float)[[0, 2]], np.asarray(wall["end"], float)[[0, 2]]
        t = (b - a) / max(float(np.linalg.norm(b - a)), 1e-9)
        d = xz - a
        along = d @ t
        on |= (np.abs(d @ np.array([-t[1], t[0]])) < band) & (along >= 0) & (along <= np.linalg.norm(b - a))
    return np.where(on, weight, 1.0)
