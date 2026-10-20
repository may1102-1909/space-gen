from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class Material(BaseModel):
    type: str  # fabric, wood, metal, glass, marble, etc.
    color: str
    finish: str = "matte"
    texture: Optional[str] = None


class Position(BaseModel):
    x: float
    y: float
    z: float


class Dimensions(BaseModel):
    width_m: float
    depth_m: Optional[float] = None
    height_m: Optional[float] = None


class SceneObject(BaseModel):
    entity_id: str  # e.g., "sofa_01"
    type: str  # architecture, furniture, lighting, decor
    category: str  # wall, sofa, lamp, plant
    subcategory: Optional[str] = None
    name: Optional[str] = None
    position: Optional[Position] = None
    dimensions: Optional[Dimensions] = None
    material: Optional[Material] = None
    style: Optional[str] = None
    confidence: float = 0.9
    editable: bool = True
    is_visible: bool = True
    replaced_by: Optional[str] = None


class SpatialRelationship(BaseModel):
    subject: str
    relation: str  # facing, next_to, on_top_of, against
    object: str


class SceneGraph(BaseModel):
    scene_id: str
    room_type: str
    style: str
    dimensions: Optional[Dimensions] = None
    lighting: Optional[Dict[str, Any]] = None
    objects: List[SceneObject]
    relationships: List[SpatialRelationship] = Field(default_factory=list)
    demo: bool = False


class ChatMessage(BaseModel):
    role: str  # user, assistant
    content: str
    images: Optional[List[str]] = None  # base64 images


class ChatRequest(BaseModel):
    message: str
    scene_id: str
    history: List[ChatMessage] = Field(default_factory=list)
    reference_image: Optional[str] = None  # base64


class ChatResponse(BaseModel):
    message: str
    actions: Optional[List[Dict[str, Any]]] = None
    hero_image: Optional[str] = None  # base64
    updated_objects: Optional[List[SceneObject]] = None


class ImageGenerationRequest(BaseModel):
    scene_id: str
    edit_instruction: str
    base_image: Optional[str] = None  # base64
    reference_image: Optional[str] = None  # base64
    style: Optional[str] = None


class VariantRequest(BaseModel):
    scene_id: str
    styles: List[str]  # e.g., ["scandinavian", "modern_luxury", "japandi"]
    base_image: Optional[str] = None  # base64
    preserve: List[str] = Field(default_factory=lambda: ["architecture", "floor", "windows"])
