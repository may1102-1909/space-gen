"""A deliberately small, explicit plan contract; raster tracing is upstream."""
import math
from .core import DATA, read_json
from jsonschema import Draft202012Validator


def validate_plan(plan):
    def finite(v):
        if isinstance(v,float):return math.isfinite(v)
        if isinstance(v,list):return all(finite(x) for x in v)
        if isinstance(v,dict):return all(finite(x) for x in v.values())
        return True
    if not finite(plan):
        return {"valid":False,"errors":["Plan contains non-finite numbers"],"warnings":[]}
    errors = [f"{'/'.join(map(str, e.absolute_path)) or '$'}: {e.message}"
              for e in Draft202012Validator(read_json(DATA / "plan.schema.json")).iter_errors(plan)]
    if errors:
        return {"valid": False, "errors": errors, "warnings": []}
    ids = set()
    warnings = []
    for storey in plan["storeys"]:
        elements = [storey] + storey["walls"] + storey.get("slabs", [])
        for wall in storey["walls"]:
            elements += wall.get("openings", [])
            length = math.dist(wall["start"], wall["end"])
            if length < 0.05:
                errors.append(f"{wall['id']}: wall shorter than 0.05 m")
            openings = wall.get("openings", [])
            for o in openings:
                if o["offset"] < 0 or o["offset"] + o["width"] > length + 1e-8:
                    errors.append(f"{o['id']}: opening exceeds wall length")
                if o["sill"] + o["height"] > wall["height"] + 1e-8:
                    errors.append(f"{o['id']}: opening exceeds wall height")
            for i, a in enumerate(openings):
                for b in openings[i + 1:]:
                    if (min(a["offset"]+a["width"], b["offset"]+b["width"]) > max(a["offset"], b["offset"])+1e-8
                        and min(a["sill"]+a["height"], b["sill"]+b["height"]) > max(a["sill"], b["sill"])+1e-8):
                        errors.append(f"{a['id']}, {b['id']}: overlapping openings")
        for e in elements:
            if e["id"] in ids:
                errors.append(f"Duplicate id: {e['id']}")
            ids.add(e["id"])
        if not storey.get("slabs"):
            warnings.append(f"{storey['id']}: no slabs provided")
    if plan["scale"]["status"] == "assumed":
        warnings.append("Scale is assumed; do not label dimensions as surveyed")
    return {"valid": not errors, "errors": errors, "warnings": warnings,
            "units": "m", "element_ids": len(ids), "scope": "schema and local wall/opening bounds; not structural certification"}


def require_plan(plan):
    report = validate_plan(plan)
    if not report["valid"]:
        raise ValueError("; ".join(report["errors"]))
    return report


def calibrate(pixel_a, pixel_b, known_m):
    if len(pixel_a) != 2 or len(pixel_b) != 2:
        raise ValueError("Two 2D points are required")
    vals = [*pixel_a, *pixel_b, known_m]
    if not all(math.isfinite(x) for x in vals) or known_m <= 0:
        raise ValueError("Coordinates must be finite and known length positive")
    d = math.dist(pixel_a, pixel_b)
    if d < 1:
        raise ValueError("Scale baseline must span at least one pixel")
    return {"metres_per_pixel": known_m / d, "baseline_pixels": d,
            "known_length_m": known_m, "warning": "Valid for an orthographic, rectified plan only"}
