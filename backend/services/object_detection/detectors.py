"""2D object detectors behind one interface.

Adapters:
- GroundedSamDetector: open-vocabulary boxes (OWLv2 / Grounding DINO via transformers), refined to
  masks by SAM 2 when the `sam2` package is installed. Heavy deps are imported lazily.
- GeminiDetector: Gemini bounding boxes, used when an API key is configured.
- FakeDetector: projects known 3D boxes into each view with seeded noise (tests / evaluation).
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Protocol, Sequence

import numpy as np

from services.object_detection.geometry import CameraView, obb_corners


@dataclass
class Detection2D:
    label: str
    score: float
    box: tuple  # (x0, y0, x1, y1) in pixels
    mask: Optional[np.ndarray] = None  # (H, W) bool, optional


@dataclass
class Keyframe:
    name: str
    camera: CameraView
    image_path: Optional[Path] = None

    def load_image(self):
        from PIL import Image

        if self.image_path is None:
            raise FileNotFoundError(f"No image file for keyframe {self.name}")
        return Image.open(self.image_path).convert("RGB")


class Detector2D(Protocol):
    name: str

    def detect(self, frame: Keyframe, labels: Sequence[str]) -> List[Detection2D]: ...


# ---------------------------------------------------------------------------
# Fake detector
# ---------------------------------------------------------------------------


@dataclass
class FakeObject:
    label: str
    center: tuple
    size: tuple
    yaw: float


class FakeDetector:
    """Projects ground-truth OBBs and perturbs the boxes deterministically per keyframe name."""

    name = "fake"

    def __init__(
        self,
        objects: Sequence[FakeObject],
        box_noise: float = 0.0,
        miss_rate: float = 0.0,
        false_positive_rate: float = 0.0,
        min_visible_fraction: float = 0.5,
        seed: int = 0,
    ):
        self.objects = list(objects)
        self.box_noise = box_noise
        self.miss_rate = miss_rate
        self.false_positive_rate = false_positive_rate
        self.min_visible_fraction = min_visible_fraction
        self.seed = seed

    def detect(self, frame: Keyframe, labels: Sequence[str]) -> List[Detection2D]:
        cam = frame.camera
        rng = np.random.default_rng(self.seed + zlib.crc32(frame.name.encode()))
        out: List[Detection2D] = []
        for obj in self.objects:
            if obj.label not in labels:
                continue
            uv, depth = cam.project(obb_corners(obj.center, obj.size, obj.yaw))
            if np.any(depth <= 0.05):
                continue
            x0, y0 = uv.min(axis=0)
            x1, y1 = uv.max(axis=0)
            area = (x1 - x0) * (y1 - y0)
            cx0, cy0, cx1, cy1 = max(x0, 0), max(y0, 0), min(x1, cam.width), min(y1, cam.height)
            if area <= 0 or cx1 <= cx0 or cy1 <= cy0 or (cx1 - cx0) * (cy1 - cy0) / area < self.min_visible_fraction:
                continue
            if rng.random() < self.miss_rate:
                continue
            w, h = x1 - x0, y1 - y0
            jitter = rng.normal(0.0, self.box_noise, 4) * np.array([w, h, w, h])
            box = (cx0 + jitter[0], cy0 + jitter[1], cx1 + jitter[2], cy1 + jitter[3])
            out.append(Detection2D(obj.label, float(rng.uniform(0.6, 0.95)), _clip_box(box, cam)))
        if labels and rng.random() < self.false_positive_rate:
            w, h = rng.uniform(0.05, 0.3) * cam.width, rng.uniform(0.05, 0.3) * cam.height
            x0, y0 = rng.uniform(0, cam.width - w), rng.uniform(0, cam.height - h)
            label = labels[int(rng.integers(len(labels)))]
            out.append(Detection2D(label, float(rng.uniform(0.3, 0.6)), (x0, y0, x0 + w, y0 + h)))
        return out


def _clip_box(box, cam: CameraView) -> tuple:
    x0, y0, x1, y1 = box
    x0, x1 = sorted((float(np.clip(x0, 0, cam.width)), float(np.clip(x1, 0, cam.width))))
    y0, y1 = sorted((float(np.clip(y0, 0, cam.height)), float(np.clip(y1, 0, cam.height))))
    return (x0, y0, x1, y1)


# ---------------------------------------------------------------------------
# Open-vocabulary detector + SAM 2 (optional heavy deps)
# ---------------------------------------------------------------------------


class GroundedSamDetector:
    """OWLv2 or Grounding DINO boxes, refined with SAM 2 masks when available. Uses CUDA if present."""

    name = "grounded_sam"
    DEFAULT_MODEL = "google/owlv2-base-patch16-ensemble"

    def __init__(
        self, model_id: Optional[str] = None, sam_model_id: str = "facebook/sam2-hiera-small", threshold: float = 0.25
    ):
        import torch
        from transformers import pipeline

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.threshold = threshold
        self.model_id = model_id or os.getenv("DETECTOR_MODEL", self.DEFAULT_MODEL)
        self._pipe = pipeline("zero-shot-object-detection", model=self.model_id, device=self.device)
        self._sam = None
        if importlib.util.find_spec("sam2") is not None:
            from sam2.sam2_image_predictor import SAM2ImagePredictor

            self._sam = SAM2ImagePredictor.from_pretrained(sam_model_id, device=self.device)

    @staticmethod
    def is_available() -> bool:
        return all(importlib.util.find_spec(m) is not None for m in ("torch", "transformers"))

    def detect(self, frame: Keyframe, labels: Sequence[str]) -> List[Detection2D]:
        image = frame.load_image()
        raw = self._pipe(image, candidate_labels=list(labels), threshold=self.threshold)
        dets = [
            Detection2D(
                r["label"], float(r["score"]), (r["box"]["xmin"], r["box"]["ymin"], r["box"]["xmax"], r["box"]["ymax"])
            )
            for r in raw
        ]
        if self._sam is not None and dets:
            self._sam.set_image(np.asarray(image))
            for d in dets:
                masks, _, _ = self._sam.predict(box=np.array(d.box), multimask_output=False)
                d.mask = masks[0].astype(bool)
        return dets


# ---------------------------------------------------------------------------
# Gemini bounding boxes (fallback)
# ---------------------------------------------------------------------------

GEMINI_PROMPT = (
    "Detect every instance of these objects: {labels}. Return a JSON array; each item has "
    '"label" (one of the given names), "box_2d" as [ymin, xmin, ymax, xmax] normalized to 0-1000, '
    'and "score" between 0 and 1. Return [] if none are visible.'
)


def gemini_api_key() -> str:
    from config import settings

    for key in (settings.gemini_api_key, os.getenv("GEMINI_API_KEY", ""), os.getenv("GOOGLE_API_KEY", "")):
        if key and key not in ("your_key_here", "None"):
            return key
    return ""


def parse_gemini_boxes(text: str, width: int, height: int, labels: Sequence[str]) -> List[Detection2D]:
    """Parse Gemini's box_2d JSON (optionally fenced in ```json) into pixel-space detections."""
    match = re.search(r"\[.*\]", text, re.S)
    if not match:
        return []
    try:
        items = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    allowed = {label.lower(): label for label in labels}
    out: List[Detection2D] = []
    for item in items:
        if not isinstance(item, dict) or "box_2d" not in item:
            continue
        label = allowed.get(str(item.get("label", "")).strip().lower())
        try:
            ymin, xmin, ymax, xmax = (float(v) for v in item["box_2d"])
            score = float(item.get("score", 0.6))
        except (TypeError, ValueError):
            continue
        if label is None or xmax <= xmin or ymax <= ymin:
            continue
        box = (xmin / 1000 * width, ymin / 1000 * height, xmax / 1000 * width, ymax / 1000 * height)
        out.append(Detection2D(label, float(np.clip(score, 0.0, 1.0)), box))
    return out


class GeminiDetector:
    name = "gemini"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        from google import genai

        from config import settings

        self.client = genai.Client(api_key=api_key or gemini_api_key())
        self.model = model or settings.gemini_fast_model

    def detect(self, frame: Keyframe, labels: Sequence[str]) -> List[Detection2D]:
        from google.genai import types

        image = frame.load_image()
        response = self.client.models.generate_content(
            model=self.model,
            contents=[image, GEMINI_PROMPT.format(labels=", ".join(labels))],
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0),
        )
        return parse_gemini_boxes(response.text or "", image.width, image.height, labels)


def get_detector(name: str = "auto") -> Detector2D:
    """Resolve a detector by name; 'auto' prefers the local open-vocab model, then Gemini."""
    if name in ("auto", "grounded_sam") and GroundedSamDetector.is_available():
        return GroundedSamDetector()
    if name in ("auto", "gemini") and gemini_api_key():
        return GeminiDetector()
    raise RuntimeError(
        f"Detector '{name}' unavailable: install torch + transformers (and optionally sam2), "
        "or set GEMINI_API_KEY / GOOGLE_API_KEY."
    )
