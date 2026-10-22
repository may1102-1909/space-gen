#!/usr/bin/env python3
"""Generate canonical JSON Schemas from versioned Pydantic v2 contracts.

Outputs schemas to contracts/schemas/ for use by frontend, backend, AI models,
and CI drift verification.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Add backend to sys.path so models can be imported
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from models.contracts import (
    AssetRef,
    ConversionJobStatus,
    EditProposal,
    EditRecord,
    MaskRegion,
    ProjectManifest,
    RoomInterpretation,
    ScanAsset,
    SegmentedObject,
    Variant,
)

SCHEMAS_DIR = REPO_ROOT / "contracts" / "schemas"

TARGET_MODELS = {
    "ProjectManifest": ProjectManifest,
    "ScanAsset": ScanAsset,
    "MaskRegion": MaskRegion,
    "RoomInterpretation": RoomInterpretation,
    "EditProposal": EditProposal,
    "EditRecord": EditRecord,
    "AssetRef": AssetRef,
    "Variant": Variant,
    "ConversionJobStatus": ConversionJobStatus,
    "SegmentedObject": SegmentedObject,
}


def generate_schemas() -> None:
    SCHEMAS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generating JSON Schemas in {SCHEMAS_DIR}...")

    for name, model_cls in TARGET_MODELS.items():
        schema = model_cls.model_json_schema()
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        out_path = SCHEMAS_DIR / f"{name}.json"
        out_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
        print(f"  [OK] Written {out_path.relative_to(REPO_ROOT)}")

    print(f"Successfully generated {len(TARGET_MODELS)} JSON Schemas.")


if __name__ == "__main__":
    generate_schemas()
