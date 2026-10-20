"""Shared data contracts between SpaceGen frontend and FastAPI backend.

Versioned Pydantic v2 schemas kept strictly in sync with frontend/lib/contracts/*.ts.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

# Re-exports from legacy scene model for backward compatibility
from models.scene import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    Dimensions,
    ImageGenerationRequest,
    Material,
    Position,
    SceneGraph,
    SceneObject,
    SpatialRelationship,
    VariantRequest,
)

# ---------------------------------------------------------------------------
# 1. Primitives & Geometry (Frame: Y-up, meters, floor at y=0)
# ---------------------------------------------------------------------------

Provenance = Literal["auto", "user"]
Vector3 = Tuple[float, float, float]
Matrix4 = Tuple[
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
    float,
]
Point2D = Tuple[float, float]


class BoundingBox3D(BaseModel):
    min: Vector3
    max: Vector3


class OrientedBoundingBox(BaseModel):
    center: Vector3
    size: Vector3
    yaw: float


# ---------------------------------------------------------------------------
# 2. Scan Asset & Splat Mask Regions
# ---------------------------------------------------------------------------

ScanFormat = Literal["sog", "spz", "ply", "splat"]
ScaleSource = Literal["none", "user_measurement", "sensor"]


class ScanAsset(BaseModel):
    url: str
    format: ScanFormat
    scanToScene: Matrix4
    scaleSource: ScaleSource
    bounds: BoundingBox3D


class MaskRegion(BaseModel):
    id: str
    obb: OrientedBoundingBox
    feather: float = Field(ge=0.0)
    enabled: bool


# ---------------------------------------------------------------------------
# 3. Room Interpretation (Geometric & Semantic extraction)
# ---------------------------------------------------------------------------

OpeningKind = Literal["door", "window", "opening"]
DetectionStatus = Literal["auto", "verified", "corrected", "rejected"]


class FloorPlane(BaseModel):
    normal: Vector3
    constant: float
    provenance: Provenance


class WallInterpretation(BaseModel):
    id: str
    start: Vector3
    end: Vector3
    height: float = Field(gt=0.0)
    thickness: float = Field(gt=0.0)
    confidence: float = Field(ge=0.0, le=1.0)
    provenance: Provenance


class OpeningInterpretation(BaseModel):
    id: str
    wallId: str
    kind: OpeningKind
    offset: float = Field(ge=0.0)
    width: float = Field(gt=0.0)
    height: float = Field(gt=0.0)
    sill: float = Field(ge=0.0)
    confidence: float = Field(ge=0.0, le=1.0)
    provenance: Provenance


class DetectionInterpretation(BaseModel):
    id: str
    category: str
    label: str
    obb: OrientedBoundingBox
    confidence: float = Field(ge=0.0, le=1.0)
    maskRegionId: Optional[str] = None
    status: DetectionStatus
    provenance: Provenance


class RoomInterpretation(BaseModel):
    provenance: Provenance
    floor: FloorPlane
    ceilingHeight: float = Field(gt=0.0)
    outline: List[Point2D]
    walls: List[WallInterpretation]
    openings: List[OpeningInterpretation]
    detections: List[DetectionInterpretation]


# ---------------------------------------------------------------------------
# 4. Edit Proposal & History
# ---------------------------------------------------------------------------

EditOp = Literal["replace", "add", "move", "remove"]
AssetSource = Literal["catalog", "upload", "generated"]
AssetFormat = Literal["glb", "gltf"]
ViolationSeverity = Literal["error", "warning", "info"]
ProposalStatus = Literal["pending", "accepted", "rejected"]


class ProposalAssetDimensions(BaseModel):
    width: float = Field(gt=0.0)
    height: float = Field(gt=0.0)
    depth: float = Field(gt=0.0)


class ProposalAsset(BaseModel):
    source: AssetSource
    url: str
    dimensions: ProposalAssetDimensions


class ProposalTransform(BaseModel):
    position: Vector3
    rotationY: float
    scale: Vector3


class Violation(BaseModel):
    rule: str
    severity: ViolationSeverity
    detail: str
    nodeIds: List[str]


class ProposalValidation(BaseModel):
    ok: bool
    violations: List[Violation]


class EditProposal(BaseModel):
    """Proposal emitted by AI assistant for user review before applying to the scene store."""

    id: str
    op: EditOp
    targetNodeId: Optional[str] = None
    asset: Optional[ProposalAsset] = None
    transform: Optional[ProposalTransform] = None
    rationale: str
    validation: ProposalValidation
    status: ProposalStatus

    # Backward compatibility attributes (optional)
    proposal_id: Optional[str] = None
    action: Optional[str] = None
    target_id: Optional[str] = None
    node_type: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    summary: Optional[str] = None
    accepted: Optional[bool] = None

    def model_post_init(self, __context: Any) -> None:
        # Keep legacy fields synchronized if provided
        if not self.proposal_id:
            self.proposal_id = self.id
        if not self.action:
            self.action = self.op
        if not self.target_id and self.targetNodeId:
            self.target_id = self.targetNodeId
        if not self.summary:
            self.summary = self.rationale


class EditRecord(BaseModel):
    id: str
    timestamp: str
    proposalId: Optional[str] = None
    op: EditOp
    targetNodeId: Optional[str] = None
    description: str
    userComment: Optional[str] = None


# ---------------------------------------------------------------------------
# 5. Asset References, Scene Variants & Project Manifest
# ---------------------------------------------------------------------------


class AssetRef(BaseModel):
    id: str
    name: str
    source: AssetSource
    url: str
    format: AssetFormat
    dimensions: ProposalAssetDimensions
    categories: List[str]
    thumbnail: Optional[str] = None


class Variant(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    sceneSnapshot: Dict[str, Any]
    createdAt: str
    parentVariantId: Optional[str] = None


class ProjectManifest(BaseModel):
    schemaVersion: str
    id: str
    name: str
    scan: ScanAsset
    interpretation: RoomInterpretation
    maskRegions: List[MaskRegion]
    sceneSnapshot: Dict[str, Any]
    assets: List[AssetRef]
    history: List[EditRecord]
    variants: List[Variant]
    activeVariantId: str


# ---------------------------------------------------------------------------
# 6. Legacy pipeline job status
# ---------------------------------------------------------------------------


class ReconstructionJobStatus(BaseModel):
    """Reconstruction pipeline job tracking contract."""

    job_id: str
    status: str
    progress: int = 0
    step: str = ""
    log: str = ""
    video_path: Optional[str] = None
    scene_path: Optional[str] = None
    splat_url: Optional[str] = None
    mesh_url: Optional[str] = None
    demo: bool = False


__all__ = [
    # Legacy re-exports
    "Material",
    "Position",
    "Dimensions",
    "SceneObject",
    "SpatialRelationship",
    "SceneGraph",
    "ChatMessage",
    "ChatRequest",
    "ChatResponse",
    "ImageGenerationRequest",
    "VariantRequest",
    "ReconstructionJobStatus",
    # Geometry & Primitives
    "Provenance",
    "Vector3",
    "Matrix4",
    "Point2D",
    "BoundingBox3D",
    "OrientedBoundingBox",
    # Scan & Mask
    "ScanFormat",
    "ScaleSource",
    "ScanAsset",
    "MaskRegion",
    # Room Interpretation
    "OpeningKind",
    "DetectionStatus",
    "FloorPlane",
    "WallInterpretation",
    "OpeningInterpretation",
    "DetectionInterpretation",
    "RoomInterpretation",
    # Proposal & History
    "EditOp",
    "AssetSource",
    "AssetFormat",
    "ViolationSeverity",
    "ProposalStatus",
    "ProposalAssetDimensions",
    "ProposalAsset",
    "ProposalTransform",
    "Violation",
    "ProposalValidation",
    "EditProposal",
    "EditRecord",
    # Manifest & Variants
    "AssetRef",
    "Variant",
    "ProjectManifest",
]
