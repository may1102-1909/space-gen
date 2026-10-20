"""Evaluate 3D object detection against hand-labelled oriented boxes.

    python scripts/eval_detection.py --synthetic
    python scripts/eval_detection.py labels.json /path/to/scan_folder [--detector owlv2|gemini|fixture]

``labels.json``: {"objects": [{"label": "sofa", "center": [x, y, z], "size": [x, y, z], "yaw": 0.0}]}
in the scene frame (Y-up, meters, after scanToScene). Prints IoU, recall and precision at IoU 0.25 and 0.5.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.object_detection.evaluation import (  # noqa: E402
    box_from_dict,
    evaluate,
    format_report,
    load_labelled_boxes,
)
from services.object_detection.runner import run_on_scan_folder  # noqa: E402
from services.object_detection.synthetic import write_scan_folder  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("labels", nargs="?", type=Path, help="hand-labelled boxes JSON")
    parser.add_argument("scan", nargs="?", type=Path, help="scan folder (splat .ply + COLMAP + keyframes)")
    parser.add_argument("--synthetic", action="store_true", help="evaluate the built-in synthetic scan")
    parser.add_argument("--detector", default=None, help="auto, gemini, owlv2 or fixture (default: auto)")
    parser.add_argument("--any-label", action="store_true", help="match boxes regardless of label")
    parser.add_argument("--json", action="store_true", help="print the metrics as JSON")
    args = parser.parse_args(argv)

    if args.synthetic:
        with tempfile.TemporaryDirectory() as tmp:
            scan = write_scan_folder(Path(tmp) / "synthetic_scan")
            result = run_on_scan_folder(scan, detector_name=args.detector or "fixture")
            truth = load_labelled_boxes(scan / "labels.json")
    elif args.labels and args.scan:
        result = run_on_scan_folder(args.scan, detector_name=args.detector or "auto")
        truth = load_labelled_boxes(args.labels)
    else:
        parser.error("pass --synthetic, or a labels JSON and a scan folder")

    preds = [box_from_dict(det.model_dump()) for det in result.detections]
    metrics = evaluate(preds, truth, match_labels=not args.any_label)
    print(json.dumps(metrics, indent=2) if args.json else format_report(metrics))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
