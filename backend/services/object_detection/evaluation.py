"""3D OBB IoU, recall and precision against hand-labelled boxes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

from .geometry import obb_iou

ObbTuple = tuple[tuple[float, float, float], tuple[float, float, float], float]
LabelledBox = tuple[str, ObbTuple]
DEFAULT_THRESHOLDS = (0.25, 0.5)


def _norm(label: str) -> str:
    return label.strip().lower().replace("_", " ")


def box_from_dict(item: dict[str, Any]) -> LabelledBox:
    """Accept ``{label, center, size, yaw}`` or a contract detection ``{label|category, obb: {...}}``."""
    obb = item.get("obb", item)
    center, size = tuple(float(v) for v in obb["center"]), tuple(float(v) for v in obb["size"])
    return _norm(str(item.get("label") or item.get("category"))), (center, size, float(obb.get("yaw", 0.0)))


def load_labelled_boxes(path: Path) -> list[LabelledBox]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data if isinstance(data, list) else data.get("objects") or data.get("detections") or []
    return [box_from_dict(item) for item in items]


def match(
    preds: Sequence[LabelledBox], truth: Sequence[LabelledBox], match_labels: bool = True
) -> list[tuple[int, int, float]]:
    """Greedy one-to-one matching by descending IoU: (pred index, truth index, IoU)."""
    pairs = [
        (obb_iou(p[1], t[1]), i, j)
        for i, p in enumerate(preds)
        for j, t in enumerate(truth)
        if not match_labels or p[0] == t[0]
    ]
    used_p: set[int] = set()
    used_t: set[int] = set()
    matches = []
    for iou, i, j in sorted(pairs, reverse=True):
        if iou > 0 and i not in used_p and j not in used_t:
            used_p.add(i)
            used_t.add(j)
            matches.append((i, j, iou))
    return matches


def evaluate(
    preds: Iterable[LabelledBox],
    truth: Iterable[LabelledBox],
    thresholds: Sequence[float] = DEFAULT_THRESHOLDS,
    match_labels: bool = True,
) -> dict[str, Any]:
    preds, truth = list(preds), list(truth)
    matches = match(preds, truth, match_labels)
    result: dict[str, Any] = {"numPredictions": len(preds), "numGroundTruth": len(truth), "thresholds": {}}
    for thr in thresholds:
        tp = sum(1 for _, _, iou in matches if iou >= thr)
        result["thresholds"][f"{thr:g}"] = {
            "tp": tp,
            "fp": len(preds) - tp,
            "fn": len(truth) - tp,
            "recall": tp / len(truth) if truth else 1.0,
            "precision": tp / len(preds) if preds else 1.0,
        }
    ious = [iou for _, _, iou in matches]
    result["meanIou"] = float(np.mean(ious)) if ious else 0.0
    centre = [float(np.linalg.norm(np.subtract(preds[i][1][0], truth[j][1][0]))) for i, j, _ in matches]
    size = [float(np.max(np.abs(np.subtract(preds[i][1][1], truth[j][1][1])))) for i, j, _ in matches]
    result["maxCentreErrorM"] = max(centre, default=0.0)
    result["maxSizeErrorM"] = max(size, default=0.0)
    return result


def format_report(result: dict[str, Any]) -> str:
    lines = [
        f"predictions={result['numPredictions']} ground_truth={result['numGroundTruth']}",
        f"mean IoU (matched) = {result['meanIou']:.3f}",
        f"max centre error = {result['maxCentreErrorM'] * 1000:.1f} mm, max size error = {result['maxSizeErrorM'] * 1000:.1f} mm",
    ]
    for thr, row in result["thresholds"].items():
        lines.append(
            f"IoU>={thr}: recall={row['recall']:.2f} precision={row['precision']:.2f} (tp={row['tp']} fp={row['fp']} fn={row['fn']})"
        )
    return "\n".join(lines)
