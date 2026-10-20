import pytest
from fastapi.testclient import TestClient

from main import app
from services.scene_analyzer import scene_analyzer

client = TestClient(app)


def test_get_scene_returns_explicit_demo_flag():
    """Verify demo scene endpoint returns explicit demo: True flag."""
    response = client.get("/api/scenes/demo_living_room")
    assert response.status_code == 200
    data = response.json()
    assert "demo" in data
    assert data["demo"] is True
    assert data["scene_id"] == "demo_living_room"
    assert len(data.get("objects", [])) > 0


def test_scene_analyzer_demo_scene_flag():
    """Verify get_demo_scene() produces a SceneGraph with demo=True."""
    scene = scene_analyzer.get_demo_scene()
    assert scene.demo is True
    assert scene.scene_id == "demo_living_room"


@pytest.mark.asyncio
async def test_scene_analyzer_fallback_marks_demo_true(monkeypatch):
    """Verify that when AI agent analysis fails, fallback returns demo: True explicitly."""

    async def mock_fail_analyze(_bytes):
        raise RuntimeError("Simulated Gemini API failure")

    monkeypatch.setattr(scene_analyzer.agent, "analyze_scene", mock_fail_analyze)

    result = await scene_analyzer.analyze(b"fake_image_bytes")
    assert result.demo is True
