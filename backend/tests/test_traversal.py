from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_model_path_traversal_rejected():
    """Verify path traversal attempts in reconstruction model route are rejected."""
    # Encoded traversal directly targets the endpoint handler
    res_encoded = client.get("/api/reconstruction/jobs/test_job/model/..%2f..%2fetc%2fpasswd")
    assert res_encoded.status_code == 400
    assert "traversal" in res_encoded.json().get("detail", "").lower()

    # Raw traversal is rejected by either router (404) or security guard (400)
    res_raw = client.get("/api/reconstruction/jobs/test_job/model/../../etc/passwd")
    assert res_raw.status_code in (400, 404)


def test_job_id_traversal_rejected():
    """Verify path traversal inside job_id parameter is safely rejected."""
    res_relative = client.get("/api/reconstruction/jobs/..secret_dir/model")
    assert res_relative.status_code == 400
    assert "traversal" in res_relative.json().get("detail", "").lower()

    res_slashes = client.get("/api/reconstruction/jobs/..%2f..%2fsecret/model")
    assert res_slashes.status_code in (400, 404)


def test_mesh_file_path_traversal_rejected():
    """Verify path traversal in mesh file serving endpoint is rejected."""
    res_encoded = client.get("/api/reconstruction/jobs/test_job/mesh/..%2f..%2fconfig.py")
    assert res_encoded.status_code == 400
    assert "traversal" in res_encoded.json().get("detail", "").lower()

    res_raw = client.get("/api/reconstruction/jobs/test_job/mesh/../../config.py")
    assert res_raw.status_code in (400, 404)


def test_catalog_path_traversal_rejected():
    """Verify path traversal in furniture catalog endpoint is rejected."""
    res_encoded = client.get("/api/reconstruction/furniture-catalog/..%2f..%2fconfig.py")
    assert res_encoded.status_code == 400
    assert "traversal" in res_encoded.json().get("detail", "").lower()

    res_raw = client.get("/api/reconstruction/furniture-catalog/../../config.py")
    assert res_raw.status_code in (400, 404)


def test_legitimate_missing_file_returns_404_not_400():
    """Verify that safe non-existent requests return 404 (not rejected as traversal 400)."""
    res = client.get("/api/reconstruction/furniture-catalog/non_existent_item.glb")
    assert res.status_code == 404


def test_legitimate_catalog_list_returns_200():
    """Verify that legitimate catalog access returns 200."""
    res = client.get("/api/reconstruction/furniture-catalog")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
