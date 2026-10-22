"""Room-structure accuracy report against reference rooms (docs/accuracy.md).

Run from backend/:  python -m scripts.accuracy_report --synthetic [--frontend-table]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from models.reference_room import ReferenceRoom
from services.accuracy import build_report, error_table, evaluate, to_markdown
from services.room_structure import RoomStructureOptions, analyze_room, load_colmap_points, load_scan_points

BACKEND = Path(__file__).resolve().parents[1]
FRONTEND_TABLE = BACKEND.parent / "frontend" / "lib" / "measurement" / "errorTable.json"


def real_rooms(rooms_dir: Path):
    for ref_path in sorted(rooms_dir.glob("*/reference.json")):
        ref = ReferenceRoom.model_validate_json(ref_path.read_text(encoding="utf-8"))
        scan_path = ref_path.parent / ref.scan.path
        if ref.scan.format == "ply":
            positions, opacity = load_scan_points(scan_path)
        else:
            positions, opacity = load_colmap_points(scan_path), None
        colmap = load_colmap_points(ref_path.parent / ref.scan.colmapPoints) if ref.scan.colmapPoints else None
        yield ref, positions, opacity, colmap


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rooms-dir", type=Path, default=BACKEND / "data" / "accuracy" / "rooms")
    parser.add_argument("--out-dir", type=Path, default=BACKEND / "data" / "accuracy" / "reports")
    parser.add_argument("--synthetic", action="store_true", help="include the synthetic reference rooms")
    parser.add_argument("--frontend-table", action="store_true", help=f"write the error table to {FRONTEND_TABLE}")
    args = parser.parse_args(argv)

    cases = [(ref, pos, op, col) for ref, pos, op, col in real_rooms(args.rooms_dir)]
    has_real = bool(cases)
    if args.synthetic:
        from tests.synthetic_rooms import synthetic_references

        cases += [(ref, pos, op, None) for ref, pos, op in synthetic_references()]
    if not cases:
        parser.error(f"no reference rooms in {args.rooms_dir}; pass --synthetic to use the synthetic set")

    rooms = []
    for ref, positions, opacity, colmap in cases:
        options = RoomStructureOptions(up_hint=tuple(ref.scan.upHint)) if ref.scan.upHint else None
        result = analyze_room(positions, opacity, colmap, options=options)
        rooms.append(evaluate(ref, result.interpretation))

    basis = "mixed" if has_real and args.synthetic else ("real" if has_real else "synthetic")
    report = build_report(rooms)
    table = error_table(report, basis)
    md = to_markdown(report, basis)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "accuracy_report.json").write_text(
        json.dumps({**report, "errorTable": table}, indent=2), encoding="utf-8"
    )
    (args.out_dir / "accuracy_report.md").write_text(md, encoding="utf-8")
    if args.frontend_table:
        FRONTEND_TABLE.parent.mkdir(parents=True, exist_ok=True)
        FRONTEND_TABLE.write_text(json.dumps(table, indent=2) + "\n", encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
