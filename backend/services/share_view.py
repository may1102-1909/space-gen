"""Read-only, sanitized projection of a project for share-link viewers."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from services.project_repository import ProjectDocument

_OWN_ASSET = r"(?:https?://[^/\s\"']+)?/api/projects/{pid}/assets/([0-9a-f]{{64}}(?:\.[a-z]+)?)"
_ANY_PROJECT_URL = re.compile(r"/api/projects/")


def _web_url(value: str | None) -> str | None:
    """Only plain http(s) links survive: no javascript:, data: or file: URLs reach a client."""
    if not value:
        return None
    parsed = urlparse(value)
    return value if parsed.scheme in ("http", "https") and parsed.netloc else None


def _rewrite(value: Any, own: re.Pattern[str], asset_base: str) -> Any:
    if isinstance(value, str):
        value = own.sub(lambda m: f"{asset_base}/{m.group(1)}", value)
        # URLs into any other project's store must not leak through a share.
        return "" if _ANY_PROJECT_URL.search(value) else value
    if isinstance(value, list):
        return [_rewrite(item, own, asset_base) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite(item, own, asset_base) for key, item in value.items()}
    return value


def _strip_history(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Edit history is designer-internal; shares only see the resulting scene."""
    for node in (snapshot.get("nodes") or {}).values():
        meta = node.get("metadata") if isinstance(node, dict) else None
        if isinstance(meta, dict):
            meta.pop("editHistory", None)
    return snapshot


def build_shared_project(document: ProjectDocument, token: str, base_url: str) -> dict[str, Any]:
    manifest = document.manifest
    asset_base = f"{base_url.rstrip('/')}/api/share/{token}/assets"
    own = re.compile(_OWN_ASSET.format(pid=re.escape(manifest.id)))

    def clean(value: Any) -> Any:
        return _rewrite(value, own, asset_base)

    dump = manifest.model_dump(mode="json")
    return {
        "name": manifest.name,
        "updatedAt": document.updated_at,
        "scan": clean(dump["scan"]),
        "sceneSnapshot": _strip_history(clean(dump["sceneSnapshot"])),
        "activeVariantId": manifest.activeVariantId,
        "variants": [
            {
                "id": v["id"],
                "name": v["name"],
                "description": v["description"],
                "sceneSnapshot": _strip_history(clean(v["sceneSnapshot"])),
            }
            for v in dump["variants"]
        ],
        "viewpoints": dump["viewpoints"],
        "heroImages": [h for h in dump["heroImages"] if _web_url(h["url"])],
        "sceneKind": dump.get("sceneKind"),
        "assets": [
            {
                "id": a["id"],
                "name": a["name"],
                "url": clean(a["url"]),
                "dimensions": a["dimensions"],
                "categories": a["categories"],
                "productUrl": _web_url(a["productUrl"]),
            }
            for a in dump["assets"]
        ],
    }
