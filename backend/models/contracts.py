"""Shared data contracts between SpaceGen frontend and FastAPI backend.

Extend these Pydantic models to keep wire contracts synchronized with frontend/lib/contracts.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

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


class EditProposal(BaseModel):
    """Proposal emitted by AI assistant for user review before applying to the scene store."""

    proposal_id: str
    action: str  # add, remove, modify, replace
    target_id: Optional[str] = None
    node_type: str  # wall, slab, zone, door, window, item
    parameters: Dict[str, Any] = Field(default_factory=dict)
    summary: str = ""
    accepted: Optional[bool] = None


class ReconstructionJobStatus(BaseModel):
    """Reconstruction pipeline job tracking contract."""

    job_id: str
    status: str  # queued, running, ready_for_training, completed, failed
    progress: int = 0
    step: str = ""
    log: str = ""
    video_path: Optional[str] = None
    scene_path: Optional[str] = None
    splat_url: Optional[str] = None
    mesh_url: Optional[str] = None
    demo: bool = False


__all__ = [
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
    "EditProposal",
    "ReconstructionJobStatus",
]
