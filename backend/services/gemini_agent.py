import json
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

from models.scene import ChatResponse, SceneGraph, SceneObject
from prompts.image_generation import IMAGE_GENERATION_PROMPT
from prompts.intent_parsing import INTENT_PARSING_PROMPT
from prompts.reference_analysis import REFERENCE_ANALYSIS_PROMPT
from prompts.scene_analysis import SCENE_ANALYSIS_PROMPT


class ChatActionPlan(BaseModel):
    message: str
    actions: Optional[List[Dict[str, Any]]] = None
    updated_objects: Optional[List[Dict[str, Any]]] = None
    generate_image: bool = False
    edit_instructions: Optional[str] = None


class GeminiAgent:
    def __init__(self, api_key: str, default_model: str):
        self.api_key = api_key
        self.model = default_model
        self.client = None
        if api_key and api_key not in ("your_key_here", "None", ""):
            try:
                self.client = genai.Client(api_key=api_key)
            except Exception as e:
                print(f"[WARN] Gemini Client initialization failed: {e}")

    async def chat(
        self, message: str, scene_graph: SceneGraph, history: list = [], reference_image: bytes | None = None
    ) -> ChatResponse:
        """Process a user message with scene context and return design response."""
        prompt = INTENT_PARSING_PROMPT.format(scene_graph=scene_graph.model_dump_json(), user_message=message)

        contents = [prompt]
        if reference_image:
            contents.append(types.Part.from_bytes(data=reference_image, mime_type="image/jpeg"))
        if not self.client:
            return ChatResponse(
                message=f"I have reviewed your space and noted: '{message}'. To enable active AI spatial modifications and rendering, please set your GEMINI_API_KEY in backend/.env.",
                actions=[],
            )

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=ChatActionPlan
                ),
            )

            result = ChatActionPlan.model_validate_json(response.text)

            # Map updated objects if any
            updated_objs = None
            if result.updated_objects:
                # Basic mapping, in a real app would merge with current state
                updated_objs = [SceneObject.model_validate(obj) for obj in result.updated_objects]

            return ChatResponse(
                message=result.message,
                actions=result.actions,
                hero_image=None,  # To be generated separately if generate_image is true
                updated_objects=updated_objs,
            )
        except Exception as e:
            return ChatResponse(message=f"I'm sorry, I encountered an error: {str(e)}")

    async def analyze_scene(self, image_bytes: bytes) -> SceneGraph:
        """Analyze a room image and return a scene graph."""
        if not self.client:
            raise ValueError("GEMINI_API_KEY is required to analyze scene captures.")
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=[types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"), SCENE_ANALYSIS_PROMPT],
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=SceneGraph),
            )
            return SceneGraph.model_validate_json(response.text)
        except Exception as e:
            raise Exception(f"Failed to analyze scene: {str(e)}")

    async def generate_hero_image(
        self, base_image: bytes, edit_instruction: str, scene_context: dict, image_model: str
    ) -> bytes:
        """Generate an edited room image preserving architecture."""
        if not self.client:
            raise ValueError("GEMINI_API_KEY is required to generate hero renders.")
        prompt = IMAGE_GENERATION_PROMPT.format(
            room_type=scene_context.get("room_type", "room"),
            target_style=scene_context.get("style", "modern"),
            edit_instructions=edit_instruction,
            style=scene_context.get("style", "photorealistic"),
        )

        try:
            response = self.client.models.generate_content(
                model=image_model,
                contents=[types.Part.from_bytes(data=base_image, mime_type="image/jpeg"), prompt],
                config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
            )

            # Extract image from response
            for part in response.candidates[0].content.parts:
                if part.inline_data:
                    return part.inline_data.data

            raise Exception("No image returned from model.")
        except Exception as e:
            raise Exception(f"Failed to generate image: {str(e)}")

    async def analyze_reference(self, image_bytes: bytes) -> dict:
        """Analyze a reference furniture image."""
        if not self.client:
            raise ValueError("GEMINI_API_KEY is required to analyze reference furniture.")
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=[types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"), REFERENCE_ANALYSIS_PROMPT],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            return json.loads(response.text)
        except Exception as e:
            raise Exception(f"Failed to analyze reference: {str(e)}")
