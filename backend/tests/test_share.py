from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from main import app
from routes.projects import get_project_repository
from services.project_repository import FilesystemProjectRepository, hash_share_token


@pytest.fixture
def repo(tmp_path):
    return FilesystemProjectRepository(tmp_path / "projects")


@pytest.fixture
def client(repo):
    app.dependency_overrides[get_project_repository] = lambda: repo
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _upload(client, pid, content=b"glb-bytes"):
    response = client.post(f"/api/projects/{pid}/assets", files={"file": ("a.glb", content, "model/gltf-binary")})
    assert response.status_code == 201
    return response.json()["filename"]


def _project_with_asset(client, name="Room"):
    pid = client.post("/api/projects", json={"name": name}).json()["manifest"]["id"]
    return pid, _upload(client, pid)


def _save(client, pid, **changes):
    doc = client.get(f"/api/projects/{pid}").json()
    manifest = {**doc["manifest"], **changes}
    saved = client.put(f"/api/projects/{pid}", json=manifest, headers={"If-Match": f'"{doc["revision"]}"'})
    assert saved.status_code == 200, saved.text


def test_create_returns_token_once_and_stores_only_its_hash(client, repo):
    pid, _ = _project_with_asset(client)
    created = client.post(f"/api/projects/{pid}/shares", json={"label": "Client A"})
    assert created.status_code == 201
    token = created.json()["token"]
    assert len(token) >= 43

    listing = client.get(f"/api/projects/{pid}/shares").json()
    assert [s["label"] for s in listing] == ["Client A"]
    assert "token" not in listing[0] and "tokenHash" not in listing[0]

    raw = (repo.root / pid / "shares.json").read_text(encoding="utf-8")
    assert token not in raw
    assert json.loads(raw)["shares"][0]["tokenHash"] == hash_share_token(token)


def test_tokens_are_unique(client):
    pid, _ = _project_with_asset(client)
    tokens = {client.post(f"/api/projects/{pid}/shares", json={}).json()["token"] for _ in range(5)}
    assert len(tokens) == 5


def test_shared_view_is_sanitized_and_assets_rewritten(client):
    pid, filename = _project_with_asset(client)
    snapshot = {
        "nodes": {
            "item_a": {
                "id": "item_a",
                "type": "item",
                "metadata": {"editHistory": [{"secret": "prompt text"}], "keep": 1},
                "asset": {"src": f"http://127.0.0.1:8765/api/projects/{pid}/assets/{filename}"},
            },
            "item_b": {"id": "item_b", "type": "item", "asset": {"src": "/api/projects/otherproj/assets/" + "0" * 64}},
        },
        "rootNodeIds": ["item_a", "item_b"],
    }
    _save(
        client,
        pid,
        sceneSnapshot=snapshot,
        viewpoints=[{"id": "v1", "name": "Entry", "position": [0, 1.6, 4], "target": [0, 1, 0]}],
        heroImages=[
            {"id": "h1", "url": "https://example.com/r.png"},
            {"id": "h2", "url": "javascript:alert(1)"},
        ],
        assets=[
            {
                "id": "a1",
                "name": "Chair",
                "source": "upload",
                "url": f"/api/projects/{pid}/assets/{filename}",
                "format": "glb",
                "dimensions": {"width": 1, "height": 1, "depth": 1},
                "categories": [],
                "productUrl": "javascript:alert(1)",
            }
        ],
    )
    token = client.post(f"/api/projects/{pid}/shares", json={}).json()["token"]
    response = client.get(f"/api/share/{token}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    nodes = body["sceneSnapshot"]["nodes"]
    assert "editHistory" not in nodes["item_a"]["metadata"] and nodes["item_a"]["metadata"]["keep"] == 1
    assert nodes["item_a"]["asset"]["src"] == f"http://testserver/api/share/{token}/assets/{filename}"
    assert nodes["item_b"]["asset"]["src"] == ""
    assert body["viewpoints"][0]["name"] == "Entry"
    assert [h["id"] for h in body["heroImages"]] == ["h1"]
    assert body["assets"][0]["productUrl"] is None
    for forbidden in ("history", "interpretation", "id", "maskRegions"):
        assert forbidden not in body
    assert pid not in json.dumps(body)

    asset = client.get(f"/api/share/{token}/assets/{filename}")
    assert asset.status_code == 200 and asset.content == b"glb-bytes"


def test_share_token_is_read_only(client):
    pid, filename = _project_with_asset(client)
    token = client.post(f"/api/projects/{pid}/shares", json={}).json()["token"]
    for method in ("put", "post", "delete", "patch"):
        assert getattr(client, method)(f"/api/share/{token}").status_code in (404, 405)
        assert getattr(client, method)(f"/api/share/{token}/assets/{filename}").status_code in (404, 405)
    # A token is not a project id: it grants nothing on the designer API paths.
    assert client.get(f"/api/projects/{token}").status_code in (400, 404)


def test_revoked_and_unknown_tokens_404(client):
    pid, filename = _project_with_asset(client)
    created = client.post(f"/api/projects/{pid}/shares", json={}).json()
    token = created["token"]
    assert client.get(f"/api/share/{token}").status_code == 200
    assert client.delete(f"/api/projects/{pid}/shares/{created['id']}").status_code == 204
    assert client.get(f"/api/share/{token}").status_code == 404
    assert client.get(f"/api/share/{token}/assets/{filename}").status_code == 404
    assert client.get("/api/share/" + "x" * 43).status_code == 404
    assert client.get("/api/share/short").status_code == 404
    assert client.delete(f"/api/projects/{pid}/shares/{'0' * 16}").status_code == 404
    assert client.get(f"/api/projects/{pid}/shares").json()[0]["revokedAt"]


def test_deleting_project_invalidates_its_shares(client):
    pid, _ = _project_with_asset(client)
    token = client.post(f"/api/projects/{pid}/shares", json={}).json()["token"]
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/share/{token}").status_code == 404


def test_asset_access_is_confined_to_the_shared_project(client):
    pid, filename = _project_with_asset(client, "A")
    other, _ = _project_with_asset(client, "B")
    other_file = _upload(client, other, b"secret-b")
    token = client.post(f"/api/projects/{pid}/shares", json={}).json()["token"]
    assert client.get(f"/api/share/{token}/assets/{other_file}").status_code == 404
    for bad in ("..%2F..%2Fproject.json", "%2e%2e%2fproject.json", "project.json", filename + "%00"):
        assert client.get(f"/api/share/{token}/assets/{bad}").status_code in (404, 422)


def test_shares_api_validates_project(client):
    assert client.post("/api/projects/nope/shares", json={}).status_code == 404
    assert client.post("/api/projects/..%2Fx/shares", json={}).status_code in (400, 404)
    assert client.get("/api/projects/nope/shares").status_code == 404
