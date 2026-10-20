from fastapi import APIRouter, File, HTTPException, UploadFile

from models.scene import SceneGraph, SceneObject
from services.scene_analyzer import scene_analyzer

router = APIRouter()


@router.get("/api/scenes/{scene_id}", response_model=SceneGraph)
async def get_scene(scene_id: str):
    """Retrieve scene graph by ID. Returns explicit demo scene when mock scene requested."""
    try:
        scene = scene_analyzer.get_demo_scene()
        scene.demo = True
        return scene
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/analyze", response_model=SceneGraph)
async def analyze_scene(file: UploadFile = File(...)):
    """Analyze image and return scene graph (or explicit demo fallback if model unavailable)."""
    try:
        contents = await file.read()
        return await scene_analyzer.analyze(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/scenes/{scene_id}/objects", response_model=list[SceneObject])
async def get_objects(scene_id: str):
    """List semantic objects in scene."""
    try:
        scene = scene_analyzer.get_demo_scene()
        return scene.objects
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
