import json
import logging
from pathlib import Path

from config import settings
from models.scene import SceneGraph
from services.gemini_agent import GeminiAgent

logger = logging.getLogger(__name__)


class SceneAnalyzer:
    def __init__(self):
        self.agent = GeminiAgent(
            api_key=settings.gemini_api_key,
            default_model=settings.gemini_reasoning_model,
        )

    async def analyze(self, image_bytes: bytes) -> SceneGraph:
        try:
            scene = await self.agent.analyze_scene(image_bytes)
            scene.demo = False
            return scene
        except Exception as e:
            logger.warning("Analysis failed, falling back to explicit demo scene: %s", e)
            demo_scene = self.get_demo_scene()
            demo_scene.demo = True
            return demo_scene

    def get_demo_scene(self) -> SceneGraph:
        demo_path = settings.data_dir / "demo_scene.json"
        if not demo_path.exists():
            demo_path = Path(__file__).resolve().parent.parent / "data" / "demo_scene.json"

        try:
            with open(demo_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                data["demo"] = True
                return SceneGraph.model_validate(data)
        except Exception as e:
            logger.error("Failed to load demo scene: %s", e)
            return SceneGraph(
                scene_id="fallback",
                room_type="unknown",
                style="unknown",
                objects=[],
                demo=True,
            )


scene_analyzer = SceneAnalyzer()
