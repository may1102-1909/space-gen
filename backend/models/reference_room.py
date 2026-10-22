"""Ground-truth reference rooms for the accuracy harness (backend-only; see docs/accuracy.md).

A reference room pairs one scan with hand-measured dimensions (laser distance meter or
tape). Lengths are interior, wall face to wall face, in metres. Walls are listed in order
around the room; the harness matches them to the recovered walls by cyclic alignment.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from models.contracts import OpeningKind, ScaleSource

GroundTruthSource = Literal["laser", "tape", "roomplan", "synthetic"]
ScanFileFormat = Literal["ply", "colmap_points3d"]


class ReferenceScan(BaseModel):
    path: str = Field(description="Scan file relative to the reference.json, or 'synthetic://<name>'.")
    format: ScanFileFormat = "ply"
    colmapPoints: Optional[str] = Field(default=None, description="Optional points3D.txt/.bin relative path.")
    upHint: Optional[tuple[float, float, float]] = None
    scaleSource: ScaleSource = Field(description="How the scan got its metric scale.")


class ReferenceWall(BaseModel):
    id: str
    length: float = Field(gt=0.0, description="Interior wall length in metres.")
    label: Optional[str] = None


class ReferenceOpening(BaseModel):
    id: str
    wall: str = Field(description="Id of the ReferenceWall the opening is in.")
    kind: OpeningKind
    width: float = Field(gt=0.0)
    height: float = Field(gt=0.0)
    sill: Optional[float] = Field(default=None, ge=0.0, description="Floor to bottom of opening; 0 for doors.")
    offset: Optional[float] = Field(
        default=None, ge=0.0, description="wall start corner to opening CENTER (contract convention)."
    )


class ReferenceRoom(BaseModel):
    schemaVersion: Literal["1.0"] = "1.0"
    id: str
    name: str = ""
    groundTruthSource: GroundTruthSource = "laser"
    instrument: Optional[str] = None
    measuredAt: Optional[str] = None
    notes: Optional[str] = None
    scan: ReferenceScan
    ceilingHeight: float = Field(gt=0.0)
    walls: List[ReferenceWall] = Field(min_length=3)
    openings: List[ReferenceOpening] = Field(default_factory=list)

    @model_validator(mode="after")
    def _openings_reference_walls(self) -> "ReferenceRoom":
        ids = {w.id for w in self.walls}
        if len(ids) != len(self.walls):
            raise ValueError("wall ids must be unique")
        for op in self.openings:
            if op.wall not in ids:
                raise ValueError(f"opening {op.id} references unknown wall {op.wall}")
        return self
