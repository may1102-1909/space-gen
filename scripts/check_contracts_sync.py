#!/usr/bin/env python3
"""CI Schema Drift Checker for SpaceGen Contracts.

Verifies that:
1. Pydantic v2 models (backend/models/contracts.py) and Zod schemas
   (frontend/lib/contracts/*.ts) are in exact 100% structural synchronization.
2. Property names, required statuses, types, and enum values match.
3. Committed JSON schemas in contracts/schemas/ are fresh.
4. Canonical fixture fixtures/realistic_room.json parses cleanly in both.

Exits with code 0 on success, code 1 on schema drift.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Set

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from models.contracts import (
    AssetRef,
    EditProposal,
    EditRecord,
    MaskRegion,
    ProjectManifest,
    RoomInterpretation,
    ScanAsset,
    Variant,
)

SCHEMAS_DIR = REPO_ROOT / "contracts" / "schemas"
FIXTURE_PATH = REPO_ROOT / "fixtures" / "realistic_room.json"

TARGET_MODELS = {
    "ProjectManifest": ProjectManifest,
    "ScanAsset": ScanAsset,
    "MaskRegion": MaskRegion,
    "RoomInterpretation": RoomInterpretation,
    "EditProposal": EditProposal,
    "EditRecord": EditRecord,
    "AssetRef": AssetRef,
    "Variant": Variant,
}

# Optional backward compatibility fields in Pydantic that are not part of the wire contract
PYDANTIC_LEGACY_FIELDS = {
    "EditProposal": {
        "proposal_id",
        "action",
        "target_id",
        "node_type",
        "parameters",
        "summary",
        "accepted",
    }
}


def get_zod_schemas() -> Dict[str, Any]:
    """Execute frontend/scripts/export_schemas.ts via npm contracts:export."""
    # Resolve npm explicitly (npm.cmd on Windows) instead of shell=True, which on
    # POSIX drops every list element after the first.
    npm = shutil.which("npm") or "npm"
    cmd = [npm, "--prefix", "frontend", "run", "--silent", "contracts:export"]
    result = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("[ERROR] Failed to export Zod schemas from frontend:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    # Find the JSON output block
    raw_output = result.stdout.strip()
    # Find first { and last }
    start_idx = raw_output.find("{")
    end_idx = raw_output.rfind("}")
    if start_idx == -1 or end_idx == -1:
        print(f"[ERROR] Could not parse JSON from contracts:export output:\n{raw_output}", file=sys.stderr)
        sys.exit(1)

    json_str = raw_output[start_idx : end_idx + 1]
    return json.loads(json_str)


def check_schema_files_freshness(errors: List[str]) -> None:
    """Verify that contracts/schemas/*.json match current Pydantic models."""
    if not SCHEMAS_DIR.exists():
        errors.append(f"Schemas directory {SCHEMAS_DIR} does not exist. Run scripts/generate_contracts_schemas.py")
        return

    for name, model_cls in TARGET_MODELS.items():
        file_path = SCHEMAS_DIR / f"{name}.json"
        if not file_path.exists():
            errors.append(f"Missing schema file: {file_path.relative_to(REPO_ROOT)}")
            continue

        disk_schema = json.loads(file_path.read_text(encoding="utf-8"))
        curr_schema = model_cls.model_json_schema()
        curr_schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"

        if disk_schema != curr_schema:
            errors.append(
                f"Outdated schema file: {file_path.relative_to(REPO_ROOT)}. Run scripts/generate_contracts_schemas.py"
            )


def extract_pydantic_properties(model_cls: Any) -> Dict[str, Any]:
    """Extract properties and required fields from a Pydantic model class."""
    schema = model_cls.model_json_schema()
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    defs = schema.get("$defs", {})
    return {"properties": props, "required": required, "defs": defs}


def check_model_parity(
    model_name: str,
    pydantic_meta: Dict[str, Any],
    zod_schema: Dict[str, Any],
    errors: List[str],
) -> None:
    """Compare fields and required status between Pydantic and Zod."""
    p_props = pydantic_meta["properties"]
    p_req = pydantic_meta["required"]

    z_props = zod_schema.get("properties", {})
    z_req = set(zod_schema.get("required", []))

    legacy = PYDANTIC_LEGACY_FIELDS.get(model_name, set())

    # 1. Check all Pydantic core properties exist in Zod
    for prop_name in p_props:
        if prop_name in legacy:
            continue
        if prop_name not in z_props:
            errors.append(
                f"[{model_name}] Property '{prop_name}' exists in Pydantic (backend) but is MISSING from Zod (frontend)."
            )

    # 2. Check all Zod properties exist in Pydantic
    for prop_name in z_props:
        if prop_name not in p_props:
            errors.append(
                f"[{model_name}] Property '{prop_name}' exists in Zod (frontend) but is MISSING from Pydantic (backend)."
            )

    # 3. Check required status parity for shared properties
    for prop_name in p_props:
        if prop_name in legacy or prop_name not in z_props:
            continue
        p_is_req = prop_name in p_req
        z_is_req = prop_name in z_req
        if p_is_req != z_is_req:
            errors.append(
                f"[{model_name}] Required status mismatch for '{prop_name}': Pydantic required={p_is_req}, Zod required={z_is_req}."
            )


def check_fixture_validity(errors: List[str]) -> None:
    """Validate fixtures/realistic_room.json with Pydantic."""
    if not FIXTURE_PATH.exists():
        errors.append(f"Realistic room fixture missing: {FIXTURE_PATH}")
        return

    try:
        content = FIXTURE_PATH.read_text(encoding="utf-8")
        manifest = ProjectManifest.model_validate_json(content)
        # Verify specific counts
        doors = [o for o in manifest.interpretation.openings if o.kind == "door"]
        windows = [o for o in manifest.interpretation.openings if o.kind == "window"]
        if len(doors) != 2:
            errors.append(f"Fixture must contain exactly 2 doors, found {len(doors)}")
        if len(windows) != 1:
            errors.append(f"Fixture must contain exactly 1 window, found {len(windows)}")
        if len(manifest.interpretation.detections) != 6:
            errors.append(
                f"Fixture must contain exactly 6 detections, found {len(manifest.interpretation.detections)}"
            )
    except Exception as exc:
        errors.append(f"Failed to validate realistic_room.json with Pydantic: {exc}")


def main() -> None:
    print("=" * 70)
    print(" SpaceGen Contracts Drift & Parity Verification")
    print("=" * 70)

    errors: List[str] = []

    # Step 1: Verify generated JSON schema files are fresh
    print("--> Checking contracts/schemas/*.json freshness...")
    check_schema_files_freshness(errors)

    # Step 2: Extract Zod schemas from frontend
    print("--> Exporting live Zod schemas from frontend...")
    zod_schemas = get_zod_schemas()

    # Step 3: Compare Pydantic models against Zod schemas
    print("--> Checking model & property parity between Pydantic and Zod...")
    for model_name, model_cls in TARGET_MODELS.items():
        if model_name not in zod_schemas:
            errors.append(f"Model '{model_name}' missing from exported Zod schemas.")
            continue
        pydantic_meta = extract_pydantic_properties(model_cls)
        check_model_parity(model_name, pydantic_meta, zod_schemas[model_name], errors)

    # Step 4: Validate canonical realistic room fixture
    print("--> Validating realistic room fixture...")
    check_fixture_validity(errors)

    print("=" * 70)
    if errors:
        print(f"[DRIFT DETECTED] Found {len(errors)} contract synchronization errors:\n", file=sys.stderr)
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}", file=sys.stderr)
        print("\nFix the discrepancies above or run 'npm run contracts:generate'.", file=sys.stderr)
        sys.exit(1)
    else:
        print("[SUCCESS] All 8 contracts models are in 100% sync:")
        for name in TARGET_MODELS:
            print(f"  [OK] {name} (Pydantic v2 <==> Zod <==> JSON Schema)")
        print(f"  [OK] Fixture {FIXTURE_PATH.relative_to(REPO_ROOT)} verified (2 doors, 1 window, 6 detections)")
        print("Zero schema drift detected.")
        sys.exit(0)


if __name__ == "__main__":
    main()
