from pathlib import Path

import pytest
from pydantic import ValidationError

from models.contracts import (
    EditProposal,
    ProjectManifest,
    ProposalAsset,
    ProposalAssetDimensions,
    ProposalTransform,
    ProposalValidation,
    ScanAsset,
    Violation,
)


@pytest.fixture
def realistic_room_json() -> str:
    fixture_path = Path(__file__).parent / "fixtures" / "realistic_room.json"
    if not fixture_path.exists():
        fixture_path = Path(__file__).resolve().parent.parent.parent / "fixtures" / "realistic_room.json"
    return fixture_path.read_text(encoding="utf-8")


def test_pydantic_parses_realistic_room_fixture(realistic_room_json: str):
    manifest = ProjectManifest.model_validate_json(realistic_room_json)

    assert manifest.schemaVersion == "1.0.0"
    assert manifest.id == "proj_living_room_01"
    assert manifest.name == "Modern Living & Dining Room"

    # 1. Scan asset checks
    assert manifest.scan.format == "sog"
    assert len(manifest.scan.scanToScene) == 16
    assert manifest.scan.scaleSource == "sensor"

    # 2. Room interpretation checks (2 doors, 1 window, 6 detections)
    interp = manifest.interpretation
    assert interp.provenance == "auto"
    assert len(interp.walls) == 4

    doors = [o for o in interp.openings if o.kind == "door"]
    windows = [o for o in interp.openings if o.kind == "window"]
    assert len(doors) == 2
    assert len(windows) == 1
    assert len(interp.openings) == 3

    assert len(interp.detections) == 6
    for det in interp.detections:
        assert det.provenance == "auto"
        assert len(det.obb.center) == 3
        assert len(det.obb.size) == 3
        assert isinstance(det.obb.yaw, float)
        assert 0.0 <= det.confidence <= 1.0

    # 3. Mask regions
    assert len(manifest.maskRegions) == 6

    # 4. Measured GLB asset references
    assert len(manifest.assets) == 5
    for asset in manifest.assets:
        assert asset.format == "glb"
        assert asset.dimensions.width > 0
        assert asset.dimensions.height > 0
        assert asset.dimensions.depth > 0

    # 5. Variants
    assert len(manifest.variants) == 1
    assert manifest.activeVariantId == "var_baseline"


def test_pydantic_lossless_roundtrip_serialization(realistic_room_json: str):
    manifest1 = ProjectManifest.model_validate_json(realistic_room_json)
    dumped_json = manifest1.model_dump_json(indent=2)
    manifest2 = ProjectManifest.model_validate_json(dumped_json)

    assert manifest1.model_dump() == manifest2.model_dump()


def test_edit_proposal_operations_and_validation():
    # Valid proposal
    proposal = EditProposal(
        id="prop_sofa_01",
        op="replace",
        targetNodeId="item_sofa_01",
        asset=ProposalAsset(
            source="catalog",
            url="/assets/models/sofa.glb",
            dimensions=ProposalAssetDimensions(width=2.3, height=0.95, depth=1.0),
        ),
        transform=ProposalTransform(
            position=(4.0, 0.0, 4.5),
            rotationY=0.0,
            scale=(1.0, 1.0, 1.0),
        ),
        rationale="Replace scanned sofa with clean GLB model.",
        validation=ProposalValidation(
            ok=True,
            violations=[],
        ),
        status="pending",
    )

    assert proposal.id == "prop_sofa_01"
    assert proposal.op == "replace"
    assert proposal.validation.ok is True

    # Remove proposal with validation violation
    remove_prop = EditProposal(
        id="prop_remove_01",
        op="remove",
        targetNodeId="item_chair_left",
        rationale="Remove chair to improve circulation.",
        validation=ProposalValidation(
            ok=False,
            violations=[
                Violation(
                    rule="MIN_CLEARANCE",
                    severity="warning",
                    detail="Increased clearance to 1.8m",
                    nodeIds=["item_chair_left", "door_balcony"],
                )
            ],
        ),
        status="pending",
    )

    assert remove_prop.op == "remove"
    assert len(remove_prop.validation.violations) == 1
    assert remove_prop.validation.violations[0].severity == "warning"


def test_invalid_contract_payload_rejection():
    # Invalid scanToScene matrix (must be 16 floats)
    with pytest.raises(ValidationError):
        ScanAsset(
            url="/scan.sog",
            format="sog",
            scanToScene=(1.0, 0.0),  # invalid length
            scaleSource="sensor",
            bounds={"min": (0.0, 0.0, 0.0), "max": (1.0, 1.0, 1.0)},
        )

    # Invalid op
    with pytest.raises(ValidationError):
        EditProposal(
            id="p1",
            op="invalid_action",  # not replace|add|move|remove
            rationale="test",
        )


def test_schema_drift_comparator_detects_mismatches():
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))
    from check_contracts_sync import check_model_parity

    # Simulate mock Pydantic and Zod models with drift
    mock_pydantic_meta = {
        "properties": {
            "id": {"type": "string"},
            "backend_only_field": {"type": "string"},
            "shared_field": {"type": "number"},
        },
        "required": {"id", "backend_only_field"},
        "defs": {},
    }

    mock_zod_schema = {
        "properties": {
            "id": {"type": "string"},
            "frontend_only_field": {"type": "string"},
            "shared_field": {"type": "number"},
        },
        "required": ["id", "shared_field"],  # shared_field required in Zod but not Pydantic
    }

    errors = []
    check_model_parity("MockModel", mock_pydantic_meta, mock_zod_schema, errors)

    assert len(errors) == 3
    assert any("backend_only_field" in e for e in errors)
    assert any("frontend_only_field" in e for e in errors)
    assert any("shared_field" in e and "Required status mismatch" in e for e in errors)
