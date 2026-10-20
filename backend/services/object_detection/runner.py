"""Run the detection pipeline on a scan folder."""

from __future__ import annotations

from pathlib import Path

from .detectors import Detector2D, FixtureDetector, get_detector
from .pipeline import DetectionResult, PipelineConfig, ProgressFn, run_pipeline
from .scan_folder import load_scan_folder
from .splat_io import load_splat_centers


def run_on_scan_folder(
    root: Path,
    detector: Detector2D | None = None,
    detector_name: str = "auto",
    config: PipelineConfig | None = None,
    progress: ProgressFn | None = None,
) -> DetectionResult:
    """Detect objects in ``root``. ``detector_name='fixture'`` reads ``detections.json`` from the folder."""
    scan = load_scan_folder(root)
    if detector is None:
        if detector_name == "fixture":
            detector = FixtureDetector.from_json(scan.root / "detections.json")
        else:
            detector = get_detector(detector_name)
    cfg = config or PipelineConfig()
    if scan.labels:
        cfg = PipelineConfig(**{**cfg.__dict__, "labels": tuple(scan.labels)})
    points = load_splat_centers(scan.splat_path)
    return run_pipeline(points, scan.model, scan.frames, detector, scan.scan_to_scene, cfg, progress)
