"""Portable inventories and dependency packages with content verification."""
from pathlib import Path
import hashlib
import json
import zipfile
from .core import confined


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024*1024), b""):
            h.update(block)
    return h.hexdigest()


def inspect_image(path):
    from PIL import Image
    p = Path(path)
    with Image.open(p) as im:
        result = {"format": im.format, "size": list(im.size), "mode": im.mode}
        im.verify()
    with Image.open(p) as im:
        im.load()
    suffixes = {"JPEG": [".jpg", ".jpeg"], "PNG": [".png"], "TIFF": [".tif", ".tiff", ".tx"], "WEBP": [".webp"]}
    result.update({"filename": p.name, "sha256": digest(p), "decodable": True,
                   "extension_matches": p.suffix.lower() in suffixes.get(result["format"], []),
                   "renderer_load_verified": False})
    return result


def manifest(root):
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError("Manifest source must be an existing directory")
    files = []
    seen = {}
    for p in sorted(root.rglob("*")):
        if p.is_symlink():
            raise ValueError(f"Symlink not allowed in package: {p.name}")
        if p.is_file():
            rel = p.relative_to(root).as_posix()
            key = rel.casefold()
            if key in seen:
                raise ValueError(f"Case-insensitive path collision: {rel}")
            seen[key] = rel
            files.append({"path": rel, "bytes": p.stat().st_size, "sha256": digest(p)})
    basenames = {}
    for f in files:
        basenames.setdefault(Path(f["path"]).name.casefold(), []).append(f["path"])
    return {"schema_version": "1.0", "files": files,
            "ambiguous_basenames": {k:v for k,v in basenames.items() if len(v)>1}}


def package(root, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    if output.is_relative_to(root):
        raise ValueError("Package output must be outside its source directory")
    m = manifest(root)
    if any(f["path"].casefold() == "scene-agent-manifest.json" for f in m["files"]):
        raise ValueError("Reserved manifest filename already exists")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as z:
        for f in m["files"]:
            p = confined(root, f["path"])
            raw = p.read_bytes()
            if hashlib.sha256(raw).hexdigest() != f["sha256"]:
                raise ValueError(f"File changed during packaging: {f['path']}")
            z.writestr(f["path"], raw)
        z.writestr("scene-agent-manifest.json", json.dumps(m, indent=2))
    return {"output": str(output), "file_count": len(m["files"]), "sha256": digest(output),
            "ambiguous_basenames": m["ambiguous_basenames"], "licenses_checked": False}
