"""Synthetic multi-view benchmark: known boxes in a walled room, ring of cameras, noisy fake detector.

Run `python -m services.object_detection.synthetic` from backend/ to print the IoU/recall table.
This stands in for real-scan evaluation until hand-labelled scans exist.
"""

from __future__ import annotations

from typing import Dict, List, Sequence

import numpy as np

from services.object_detection.detectors import FakeDetector, FakeObject, Keyframe
from services.object_detection.geometry import look_at_view, obb_iou, yaw_axes
from services.object_detection.lifting import LiftConfig, Lifted3D, run_detection

ROOM = (6.0, 2.6, 5.0)  # x, height, z; centered on the origin

OBJECTS = [
    FakeObject("sofa", (-1.2, 0.425, 1.3), (2.0, 0.85, 0.9), 0.3),
    FakeObject("table", (0.4, 0.375, 0.0), (1.2, 0.75, 0.8), 0.0),
    FakeObject("chair", (1.6, 0.45, -0.3), (0.5, 0.9, 0.5), 1.0),
    FakeObject("cabinet", (-2.4, 0.9, -1.9), (0.8, 1.8, 0.4), 0.0),
    FakeObject("lamp", (2.4, 0.75, 1.8), (0.3, 1.5, 0.3), 0.0),
    FakeObject("bed", (1.2, 0.3, -1.5), (1.6, 0.6, 1.4), np.pi / 2 - 0.2),
]
LABELS = sorted({o.label for o in OBJECTS})

NOISE_LEVELS = {
    "clean": dict(box_noise=0.0, miss_rate=0.0, false_positive_rate=0.0),
    "moderate": dict(box_noise=0.03, miss_rate=0.1, false_positive_rate=0.1),
    "heavy": dict(box_noise=0.08, miss_rate=0.25, false_positive_rate=0.3),
}


def sample_box_surface(rng, obj: FakeObject, density: float = 1500.0, bottom: bool = False) -> np.ndarray:
    sx, sy, sz = obj.size
    faces = [("y", 1, sx * sz), ("x", -1, sy * sz), ("x", 1, sy * sz), ("z", -1, sx * sy), ("z", 1, sx * sy)]
    if bottom:
        faces.append(("y", -1, sx * sz))
    pts = []
    for axis, sign, area in faces:
        n = max(8, int(area * density))
        u = rng.uniform(-0.5, 0.5, (n, 3)) * np.array([sx, sy, sz])
        u[:, "xyz".index(axis)] = sign * 0.5 * obj.size["xyz".index(axis)]
        pts.append(u)
    local = np.concatenate(pts)
    ax, az = yaw_axes(obj.yaw)
    return np.asarray(obj.center) + local[:, :1] * ax + local[:, 1:2] * np.array([0, 1.0, 0]) + local[:, 2:] * az


def build_scene(seed: int = 0, density: float = 1500.0):
    """Return (points, frames): splat-center stand-ins and a ring of 20 inward-facing keyframes."""
    rng = np.random.default_rng(seed)
    w, h, d = ROOM
    floor_n, wall_density = int(w * d * 400), 400.0
    floor = np.column_stack(
        [rng.uniform(-w / 2, w / 2, floor_n), np.zeros(floor_n), rng.uniform(-d / 2, d / 2, floor_n)]
    )
    walls = []
    for axis, half, span in ((0, w / 2, d), (2, d / 2, w)):
        for sign in (-1, 1):
            n = int(span * h * wall_density)
            p = np.column_stack([rng.uniform(-span / 2, span / 2, n), rng.uniform(0, h, n), np.full(n, sign * half)])
            walls.append(p if axis == 2 else p[:, [2, 1, 0]])
    objects = [sample_box_surface(rng, o, density) for o in OBJECTS]
    points = np.concatenate([floor, *walls, *objects])
    points += rng.normal(0, 0.005, points.shape)

    width, height = 640, 480
    K = np.array([[500.0, 0, width / 2], [0, 500.0, height / 2], [0, 0, 1]])
    frames = []
    for i, theta in enumerate(np.linspace(0, 2 * np.pi, 20, endpoint=False)):
        eye = (0.85 * w / 2 * np.cos(theta), 1.5, 0.85 * d / 2 * np.sin(theta))
        target = (-0.6 * eye[0], 0.5, -0.6 * eye[2])
        frames.append(Keyframe(f"frame_{i:03d}.jpg", look_at_view(eye, target, K, width, height)))
    return points, frames


def evaluate(preds: Sequence[Lifted3D], gts: Sequence[FakeObject] = OBJECTS) -> Dict[str, float]:
    """One-to-one greedy matching by IoU among same-label pairs."""
    pairs = []
    for pi, p in enumerate(preds):
        for gi, g in enumerate(gts):
            if p.label == g.label:
                iou = obb_iou(p.obb, {"center": g.center, "size": g.size, "yaw": g.yaw})
                pairs.append((iou, pi, gi))
    used_p, used_g, matched = set(), set(), []
    for iou, pi, gi in sorted(pairs, reverse=True):
        if pi in used_p or gi in used_g or iou <= 0:
            continue
        used_p.add(pi)
        used_g.add(gi)
        matched.append(iou)
    ious = np.array(matched + [0.0] * (len(gts) - len(matched)))
    return {
        "mean_iou": float(ious.mean()),
        "recall@0.25": float((ious >= 0.25).mean()),
        "recall@0.5": float((ious >= 0.5).mean()),
        "precision@0.25": float(sum(i >= 0.25 for i in matched) / max(len(preds), 1)),
        "n_pred": float(len(preds)),
    }


def run_benchmark(seed: int = 0, cfg: LiftConfig | None = None) -> Dict[str, Dict[str, float]]:
    points, frames = build_scene(seed)
    table = {}
    for name, noise in NOISE_LEVELS.items():
        detector = FakeDetector(OBJECTS, seed=seed, **noise)
        table[name] = evaluate(run_detection(detector, frames, LABELS, points, cfg))
    return table


def format_table(table: Dict[str, Dict[str, float]]) -> str:
    cols = ["mean_iou", "recall@0.25", "recall@0.5", "precision@0.25", "n_pred"]
    lines = ["| noise | " + " | ".join(cols) + " |", "|" + "---|" * (len(cols) + 1)]
    for name, row in table.items():
        lines.append(f"| {name} | " + " | ".join(f"{row[c]:.2f}" for c in cols) + " |")
    return "\n".join(lines)


def mean_benchmark(seeds: Sequence[int], cfg: LiftConfig | None = None) -> Dict[str, Dict[str, float]]:
    runs = [run_benchmark(seed, cfg) for seed in seeds]
    return {name: {k: float(np.mean([r[name][k] for r in runs])) for k in runs[0][name]} for name in NOISE_LEVELS}


def main(seeds: List[int] = [3, 4, 5]) -> None:
    # LiftConfig defaults were tuned on seeds 0-2; seeds 3-5 are held out.
    print(f"Synthetic benchmark, mean over seeds {seeds} ({len(OBJECTS)} objects, 20 views)")
    print(format_table(mean_benchmark(seeds)))


if __name__ == "__main__":
    main()
