from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_check():
    """Verify backend health endpoint is online and returns expected payload."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "ok"
    assert data.get("service") == "spacegen-ai"
