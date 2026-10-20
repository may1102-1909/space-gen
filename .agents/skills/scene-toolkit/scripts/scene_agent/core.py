"""Shared file and catalogue operations. No model or DCC calls on import."""
from pathlib import Path
import json
import math

DATA = Path(__file__).parent / "data"


def read_json(path):
    value = json.loads(Path(path).read_text(encoding="utf-8-sig"),
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError(f"Non-finite number: {x}")))
    def check(v):
        if isinstance(v,float) and not math.isfinite(v):
            raise ValueError("Non-finite number in JSON")
        if isinstance(v,dict):
            for x in v.values():check(x)
        elif isinstance(v,list):
            for x in v:check(x)
    check(value)
    return value


def write_json(path, value):
    write_new(path, json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def write_new(path, text):
    """Exclusive creation; never silently replace a deliverable."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(text)


def catalogue(name):
    return read_json(DATA / f"{name}.json")


def style(style_id):
    found = [s for s in catalogue("styles") if s["id"] == style_id]
    if not found:
        raise ValueError(f"Unknown style: {style_id}")
    return found[0]


def recipe(style_id, quality="high", deliverable="editable-3d"):
    if deliverable not in ("editable-3d", "image"):
        raise ValueError("deliverable must be editable-3d or image")
    q = catalogue("quality").get(quality)
    if q is None:
        raise ValueError(f"Unknown quality: {quality}")
    return {"schema_version": "1.0", "style": style(style_id), "quality": q,
            "deliverable": deliverable, "execution": "recipe-only",
            "geometry_locks": ["footprint", "openings", "storey heights", "camera landmarks"],
            "required_inputs": ["reference rights", "known dimension or explicit scale assumption",
                                "target image size", "available host and render engine"],
            "checkpoints": ["reference ledger", "camera blockout", "materials crop", "lighting preview",
                            "spatial audit", "final render", "portable package"]}


def confined(root, relative):
    """Resolve symlinks too; MCP only accesses its selected workspace."""
    root = Path(root).resolve()
    p = (root / relative).resolve()
    if not p.is_relative_to(root):
        raise ValueError("Path leaves the configured workspace")
    return p
