import base64

from fastapi import APIRouter, HTTPException

from config import settings
from models.scene import ChatRequest, ChatResponse
from services.gemini_agent import GeminiAgent
from services.scene_analyzer import scene_analyzer

router = APIRouter()


@router.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        # Get the current scene context
        scene_graph = scene_analyzer.get_demo_scene()

        agent = GeminiAgent(api_key=settings.gemini_api_key, default_model=settings.gemini_reasoning_model)

        ref_bytes = None
        if request.reference_image:
            b64_str = request.reference_image
            if "," in b64_str:
                b64_str = b64_str.split(",")[1]
            ref_bytes = base64.b64decode(b64_str)

        response = await agent.chat(
            message=request.message, scene_graph=scene_graph, history=request.history, reference_image=ref_bytes
        )

        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
