"""2D open-vocabulary detectors behind a single interface.

* ``GeminiDetector``  - Gemini bounding boxes (needs GEMINI_API_KEY; no extra dependencies).
* ``Owlv2Detector``   - OWLv2 via transformers/torch, imported lazily (see requirements-gpu.txt).
* ``FixtureDetector`` - deterministic boxes keyed by image name, for tests and evaluation.
"""

from __future__ import annotations

import io
import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from config import settings

DEFAULT_LABELS: tuple[str, ...] = (
    "sofa",
    "chair",
    "armchair",
    "table",
    "coffee table",
    "dining table",
    "desk",
    "bed",
    "nightstand",
    "bookshelf",
    "cabinet",
    "dresser",
    "tv",
    "tv stand",
    "lamp",
    "plant",
    "rug",
    "stool",
)

# Gemini returns no calibrated score; this prior is used when the model omits one.
GEMINI_DEFAULT_SCORE = 0.6


class DetectorUnavailable(RuntimeError):
    """The requested detector cannot run in this environment."""


@dataclass(frozen=True)
class Frame:
    name: str
    path: Path | None
    width: int
    height: int


@dataclass(frozen=True)
class Detection2D:
    label: str
    score: float
    box: tuple[float, float, float, float]  # (x0, y0, x1, y1), normalized to [0, 1]


class Detector2D(ABC):
    name: str = "detector"

    @abstractmethod
    def detect(self, frame: Frame, labels: Sequence[str]) -> list[Detection2D]: ...


class FixtureDetector(Detector2D):
    name = "fixture"

    def __init__(self, boxes: Mapping[str, Sequence[Detection2D]]):
        self._boxes = {k: list(v) for k, v in boxes.items()}

    def detect(self, frame: Frame, labels: Sequence[str]) -> list[Detection2D]:
        wanted = {label.lower() for label in labels}
        return [d for d in self._boxes.get(frame.name, []) if d.label.lower() in wanted]


def _clamp_box(x0: float, y0: float, x1: float, y1: float) -> tuple[float, float, float, float] | None:
    x0, x1 = sorted((min(max(x0, 0.0), 1.0), min(max(x1, 0.0), 1.0)))
    y0, y1 = sorted((min(max(y0, 0.0), 1.0), min(max(y1, 0.0), 1.0)))
    if x1 - x0 < 1e-3 or y1 - y0 < 1e-3:
        return None
    return x0, y0, x1, y1


def _load_rgb(frame: Frame):
    from PIL import Image

    if frame.path is None or not frame.path.exists():
        raise FileNotFoundError(f"Keyframe image not found for {frame.name}")
    return Image.open(frame.path).convert("RGB")


class GeminiDetector(Detector2D):
    name = "gemini"
    _PROMPT = (
        "Detect every instance of these object categories in the room photo: {labels}. "
        "Return ONLY a JSON array. Each item: "
        '{{"label": <one of the categories>, "box_2d": [ymin, xmin, ymax, xmax] with values 0-1000, '
        '"confidence": <0-1>}}. Do not invent objects that are not visible. Return [] if none.'
    )

    def __init__(self, api_key: str | None = None, model: str | None = None, client: Any = None):
        self.model = model or settings.gemini_fast_model
        if client is not None:
            self._client = client
            return
        key = api_key if api_key is not None else settings.gemini_api_key
        if not self.is_configured(key):
            raise DetectorUnavailable("Gemini detector needs GEMINI_API_KEY to be set")
        from google import genai

        self._client = genai.Client(api_key=key)

    @staticmethod
    def is_configured(api_key: str | None = None) -> bool:
        key = settings.gemini_api_key if api_key is None else api_key
        return bool(key) and key not in ("your_key_here", "None")

    def detect(self, frame: Frame, labels: Sequence[str]) -> list[Detection2D]:
        from google.genai import types

        image = _load_rgb(frame)
        image.thumbnail((1024, 1024))
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=88)
        response = self._client.models.generate_content(
            model=self.model,
            contents=[
                self._PROMPT.format(labels=", ".join(labels)),
                types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
            ],
            config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0),
        )
        return self.parse_response(response.text or "[]", labels)

    @staticmethod
    def parse_response(text: str, labels: Sequence[str]) -> list[Detection2D]:
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        try:
            items = json.loads(text)
        except json.JSONDecodeError:
            return []
        if isinstance(items, dict):
            items = items.get("detections") or items.get("objects") or []
        wanted = {label.lower(): label for label in labels}
        out: list[Detection2D] = []
        for item in items if isinstance(items, list) else []:
            try:
                label = wanted.get(str(item["label"]).lower())
                ymin, xmin, ymax, xmax = (float(v) / 1000.0 for v in item["box_2d"])
                score = float(item.get("confidence", item.get("score", GEMINI_DEFAULT_SCORE)))
            except (KeyError, TypeError, ValueError):
                continue
            box = _clamp_box(xmin, ymin, xmax, ymax)
            if label and box:
                out.append(Detection2D(label, min(max(score, 0.0), 1.0), box))
        return out


class Owlv2Detector(Detector2D):
    """OWLv2 open-vocabulary detector. Runs on CUDA when available, otherwise (slowly) on CPU."""

    name = "owlv2"

    def __init__(self, model_id: str = "google/owlv2-base-patch16-ensemble", threshold: float = 0.2):
        try:
            import torch
            from transformers import Owlv2ForObjectDetection, Owlv2Processor
        except ImportError as exc:
            raise DetectorUnavailable("OWLv2 needs torch and transformers (pip install -r requirements-gpu.txt)") from exc
        self._torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.threshold = threshold
        self._processor = Owlv2Processor.from_pretrained(model_id)
        self._model = Owlv2ForObjectDetection.from_pretrained(model_id).to(self.device).eval()

    def detect(self, frame: Frame, labels: Sequence[str]) -> list[Detection2D]:
        image = _load_rgb(frame)
        w, h = image.size
        queries = [f"a photo of a {label}" for label in labels]
        inputs = self._processor(text=[queries], images=image, return_tensors="pt").to(self.device)
        with self._torch.no_grad():
            outputs = self._model(**inputs)
        # OWLv2 pads the image to a square, so boxes are relative to max(w, h).
        side = max(w, h)
        results = self._processor.post_process_object_detection(
            outputs, threshold=self.threshold, target_sizes=self._torch.tensor([[side, side]], device=self.device)
        )[0]
        out: list[Detection2D] = []
        for score, idx, box in zip(results["scores"], results["labels"], results["boxes"], strict=True):
            x0, y0, x1, y1 = (float(v) for v in box)
            clamped = _clamp_box(x0 / w, y0 / h, x1 / w, y1 / h)
            if clamped:
                out.append(Detection2D(labels[int(idx)], float(score), clamped))
        return out


def get_detector(name: str = "auto") -> Detector2D:
    """Build a detector by name. ``auto`` prefers OWLv2 when torch+transformers exist, else Gemini."""
    name = (name or "auto").lower()
    if name == "owlv2":
        return Owlv2Detector()
    if name == "gemini":
        return GeminiDetector()
    if name != "auto":
        raise DetectorUnavailable(f"Unknown detector '{name}' (use auto, gemini or owlv2)")
    try:
        return Owlv2Detector()
    except DetectorUnavailable:
        pass
    if GeminiDetector.is_configured():
        return GeminiDetector()
    raise DetectorUnavailable(
        "No object detector available: set GEMINI_API_KEY or install requirements-gpu.txt (torch + transformers)"
    )
