from fastapi import APIRouter, File, HTTPException, UploadFile

from models.scene import ImageGenerationRequest, VariantRequest
from services.image_generator import image_generator
from services.reference_analyzer import reference_analyzer
from services.scene_analyzer import scene_analyzer

router = APIRouter()


@router.post("/api/generate-image")
async def generate_image(request: ImageGenerationRequest) -> dict:
    if not request.base_image:
        raise HTTPException(status_code=400, detail="base_image is required")

    try:
        scene = scene_analyzer.get_demo_scene()
        scene_context = {"room_type": scene.room_type, "style": request.style or scene.style}

        image_b64 = await image_generator.generate(
            base_image_b64=request.base_image, edit_instruction=request.edit_instruction, scene_context=scene_context
        )

        return {"image": image_b64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/analyze-reference")
async def analyze_reference(file: UploadFile = File(...)) -> dict:
    try:
        contents = await file.read()
        analysis = await reference_analyzer.analyze(contents)
        return analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/generate-variants")
async def generate_variants(request: VariantRequest) -> dict:
    if not request.base_image:
        raise HTTPException(status_code=400, detail="base_image is required")

    try:
        scene = scene_analyzer.get_demo_scene()
        scene_context = {"room_type": scene.room_type}

        variants = await image_generator.generate_variants(
            base_image_b64=request.base_image, styles=request.styles, scene_context=scene_context
        )

        return {"variants": variants}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
