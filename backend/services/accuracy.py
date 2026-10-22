"""Accuracy harness core: match recovered room structure to a ReferenceRoom and summarise errors."""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

from models.contracts import RoomInterpretation
from models.reference_room import ReferenceRoom

LINEAR_METRICS = ("wall_length", "ceiling_height", "opening_width", "opening_height")
MISSING_OPENING_COST = 0.5  # metres-equivalent penalty when a wall mapping leaves a GT opening without candidates


def _wall_length(wall) -> float:
    return math.hypot(wall.end[0] - wall.start[0], wall.end[2] - wall.start[2])


def match_walls(reference: ReferenceRoom, interp: RoomInterpretation) -> Tuple[Dict[str, int], bool]:
    """Map reference wall id -> recovered wall index, and whether the recovered loop runs reversed.

    Equal counts: best cyclic shift in either direction (lengths plus opening presence break the
    ties a rectangle has). Unequal counts: greedy one-to-one by length within 25% of the reference.
    """
    ref = reference.walls
    rec = [_wall_length(w) for w in interp.walls]
    n = len(ref)
    if n == len(rec) and n:
        kinds_on = [{o.kind for o in interp.openings if o.wallId == w.id} for w in interp.walls]
        pos = {w.id: i for i, w in enumerate(ref)}
        best: Optional[Tuple[float, int, bool]] = None
        for reverse in (False, True):
            for shift in range(n):
                idx = [((shift - i) if reverse else (shift + i)) % n for i in range(n)]
                cost = sum(abs(ref[i].length - rec[idx[i]]) for i in range(n))
                cost += MISSING_OPENING_COST * sum(
                    op.kind not in kinds_on[idx[pos[op.wall]]] for op in reference.openings
                )
                if best is None or cost < best[0] - 1e-9:
                    best = (cost, shift, reverse)
        _, shift, reverse = best
        return {w.id: ((shift - i) if reverse else (shift + i)) % n for i, w in enumerate(ref)}, reverse
    pairs = sorted(
        (abs(w.length - r) / w.length, w.id, k)
        for w in ref
        for k, r in enumerate(rec)
        if abs(w.length - r) <= 0.25 * w.length
    )
    used_ref, used_rec, mapping = set(), set(), {}
    for _, wid, k in pairs:
        if wid not in used_ref and k not in used_rec:
            mapping[wid] = k
            used_ref.add(wid)
            used_rec.add(k)
    return mapping, False


def evaluate(reference: ReferenceRoom, interp: RoomInterpretation) -> Dict:
    """Per-room errors: list of (metric, truth_m, measured_m) samples plus match counts."""
    mapping, reverse = match_walls(reference, interp)
    samples: List[Dict] = []

    def add(metric: str, truth: float, measured: float, ref_id: str) -> None:
        samples.append({"metric": metric, "id": ref_id, "truth_m": truth, "measured_m": measured})

    add("ceiling_height", reference.ceilingHeight, interp.ceilingHeight, "ceiling")
    for w in reference.walls:
        if w.id in mapping:
            add("wall_length", w.length, _wall_length(interp.walls[mapping[w.id]]), w.id)

    used = set()
    matched_openings = 0
    for op in reference.openings:
        k = mapping.get(op.wall)
        if k is None:
            continue
        wall = interp.walls[k]
        length = _wall_length(wall)
        best = None
        for j, rec in enumerate(interp.openings):
            if j in used or rec.wallId != wall.id or rec.kind != op.kind:
                continue
            cost = abs(rec.width - op.width) + abs(rec.height - op.height)
            if op.offset is not None:
                rec_offset = length - rec.offset if reverse else rec.offset
                cost += abs(rec_offset - op.offset)
            if best is None or cost < best[0]:
                best = (cost, j)
        if best is None:
            continue
        used.add(best[1])
        matched_openings += 1
        rec = interp.openings[best[1]]
        add("opening_width", op.width, rec.width, op.id)
        add("opening_height", op.height, rec.height, op.id)
        if op.sill is not None:
            add("opening_sill", op.sill, rec.sill, op.id)

    return {
        "id": reference.id,
        "scaleSource": reference.scan.scaleSource,
        "groundTruthSource": reference.groundTruthSource,
        "walls_expected": len(reference.walls),
        "walls_found": len(interp.walls),
        "walls_matched": len(mapping),
        "openings_expected": len(reference.openings),
        "openings_found": len(interp.openings),
        "openings_matched": matched_openings,
        "samples": samples,
    }


def summarise(samples: Sequence[Dict]) -> Dict:
    """mean/max absolute error in cm and in % of the true value."""
    if not samples:
        return {"n": 0}
    cm = [abs(s["measured_m"] - s["truth_m"]) * 100 for s in samples]
    pct = [abs(s["measured_m"] - s["truth_m"]) / s["truth_m"] * 100 for s in samples if s["truth_m"] > 0]
    return {
        "n": len(cm),
        "mean_cm": sum(cm) / len(cm),
        "max_cm": max(cm),
        "mean_pct": sum(pct) / len(pct) if pct else None,
        "max_pct": max(pct) if pct else None,
    }


def build_report(rooms: Sequence[Dict]) -> Dict:
    """Aggregate per metric and per scaleSource, plus the error table the frontend reads."""
    by_source: Dict[str, Dict] = {}
    for source in sorted({r["scaleSource"] for r in rooms}):
        group = [r for r in rooms if r["scaleSource"] == source]
        samples = [s for r in group for s in r["samples"]]
        metrics = sorted({s["metric"] for s in samples})
        by_source[source] = {
            "rooms": len(group),
            "metrics": {m: summarise([s for s in samples if s["metric"] == m]) for m in metrics},
            "linear": summarise([s for s in samples if s["metric"] in LINEAR_METRICS]),
            "walls_matched": f"{sum(r['walls_matched'] for r in group)}/{sum(r['walls_expected'] for r in group)}",
            "openings_matched": f"{sum(r['openings_matched'] for r in group)}/{sum(r['openings_expected'] for r in group)}",
        }
    return {"rooms": list(rooms), "byScaleSource": by_source}


def error_table(report: Dict, basis: str) -> Dict:
    """Display budget per scaleSource: +-(value * relativePct). Uses the MAX relative error: with a
    handful of rooms the mean understates what a user can hit."""
    table = {}
    for source, data in report["byScaleSource"].items():
        lin = data["linear"]
        if not lin.get("n"):
            continue
        table[source] = {
            "relativePct": round(lin["max_pct"], 2),
            "samples": lin["n"],
            "rooms": data["rooms"],
        }
    return {"version": 1, "basis": basis, "scaleSources": table}


def _fmt(v: Optional[float]) -> str:
    return "-" if v is None else f"{v:.1f}"


def to_markdown(report: Dict, basis: str) -> str:
    lines = [
        f"# Room-structure accuracy ({basis})",
        "",
        "| scaleSource | metric | n | mean cm | max cm | mean % | max % |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for source, data in report["byScaleSource"].items():
        for metric, s in [*data["metrics"].items(), ("all linear", data["linear"])]:
            lines.append(
                f"| {source} | {metric} | {s['n']} | {_fmt(s.get('mean_cm'))} | {_fmt(s.get('max_cm'))} | "
                f"{_fmt(s.get('mean_pct'))} | {_fmt(s.get('max_pct'))} |"
            )
    lines += ["", "| scaleSource | rooms | walls matched | openings matched |", "|---|---:|---:|---:|"]
    for source, data in report["byScaleSource"].items():
        lines.append(f"| {source} | {data['rooms']} | {data['walls_matched']} | {data['openings_matched']} |")
    return "\n".join(lines) + "\n"
