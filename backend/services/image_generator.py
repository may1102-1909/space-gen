import asyncio
import base64

from config import settings
from services.gemini_agent import GeminiAgent


class ImageGenerator:
    def __init__(self):
        self.agent = GeminiAgent(api_key=settings.gemini_api_key, default_model=settings.gemini_fast_model)
        self.image_model = settings.gemini_image_model

    def _decode_base64(self, b64_str: str) -> bytes:
        if "," in b64_str:
            b64_str = b64_str.split(",")[1]
        return base64.b64decode(b64_str)

    def _encode_base64(self, image_bytes: bytes) -> str:
        b64_str = base64.b64encode(image_bytes).decode("utf-8")
        return f"data:image/jpeg;base64,{b64_str}"

    async def generate(self, base_image_b64: str, edit_instruction: str, scene_context: dict) -> str:
        try:
            image_bytes = self._decode_base64(base_image_b64)
            generated_bytes = await self.agent.generate_hero_image(
                base_image=image_bytes,
                edit_instruction=edit_instruction,
                scene_context=scene_context,
                image_model=self.image_model,
            )
            return self._encode_base64(generated_bytes)
        except Exception as e:
            raise Exception(f"Image generation failed: {e}")

    async def generate_variants(self, base_image_b64: str, styles: list[str], scene_context: dict) -> list[dict]:
        async def _gen_variant(style: str):
            try:
                instruction = f"Redesign the room in a {style} style."
                b64_res = await self.generate(base_image_b64, instruction, {**scene_context, "style": style})
                return {"style": style, "image": b64_res}
            except Exception as e:
                return {"style": style, "error": str(e)}

        tasks = [_gen_variant(style) for style in styles]
        results = await asyncio.gather(*tasks)
        return list(results)


image_generator = ImageGenerator()
