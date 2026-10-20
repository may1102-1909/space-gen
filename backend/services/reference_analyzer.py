import base64

from config import settings
from services.gemini_agent import GeminiAgent


class ReferenceAnalyzer:
    def __init__(self):
        self.agent = GeminiAgent(api_key=settings.gemini_api_key, default_model=settings.gemini_fast_model)

    async def analyze(self, image_bytes: bytes) -> dict:
        try:
            return await self.agent.analyze_reference(image_bytes)
        except Exception as e:
            raise Exception(f"Reference analysis failed: {e}")

    async def analyze_base64(self, b64_str: str) -> dict:
        if "," in b64_str:
            b64_str = b64_str.split(",")[1]
        image_bytes = base64.b64decode(b64_str)
        return await self.analyze(image_bytes)


reference_analyzer = ReferenceAnalyzer()
