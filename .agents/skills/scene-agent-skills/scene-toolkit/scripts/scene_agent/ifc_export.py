"""IFC4 wall/opening/slab export, with semantic containment and stable IDs."""
from pathlib import Path
import math
import uuid
from .plan import require_plan


def export_ifc(plan, output):
    report = require_plan(plan)
    output = Path(output)
    if output.exists():
        raise FileExistsError(output)
    import numpy as np
    import ifcopenshell
    import ifcopenshell.api as api
    import ifcopenshell.guid
    f = ifcopenshell.file(schema="IFC4")
    def run(action, **kw):
        return api.run(action, f, **kw)
    def entity(cls, ident, name=None):
        e = run("root.create_entity", ifc_class=cls, name=name or ident)
        e.GlobalId = ifcopenshell.guid.compress(uuid.uuid5(uuid.NAMESPACE_URL, plan["project_id"] + "/" + cls + "/" + ident).hex)
        return e
    project = entity("IfcProject", "project", plan.get("name", plan["project_id"]))
    run("unit.assign_unit", units=[run("unit.add_si_unit", unit_type="LENGTHUNIT"),
                                  run("unit.add_si_unit", unit_type="AREAUNIT"),
                                  run("unit.add_si_unit", unit_type="VOLUMEUNIT")])
    model = run("context.add_context", context_type="Model")
    body = run("context.add_context", context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=model)
    site = entity("IfcSite", "site")
    building = entity("IfcBuilding", "building")
    run("aggregate.assign_object", products=[site], relating_object=project)
    run("aggregate.assign_object", products=[building], relating_object=site)
    def place(e, x=0, y=0, z=0, angle=0):
        c, s = math.cos(angle), math.sin(angle)
        matrix = np.array([[c,-s,0,x],[s,c,0,y],[0,0,1,z],[0,0,0,1]], dtype=float)
        run("geometry.edit_object_placement", product=e, matrix=matrix, is_si=True)
    def prism(e, length, thickness, height):
        rep = run("geometry.add_wall_representation", context=body, length=length, thickness=thickness, height=height)
        run("geometry.assign_representation", product=e, representation=rep)
    def provenance(e, ident):
        pset = run("pset.add_pset", product=e, name="SceneAgent_Provenance")
        run("pset.edit_pset", pset=pset, properties={"SourceId": ident, "ScaleStatus": plan["scale"]["status"],
                                                    "ScaleEvidence": plan["scale"]["evidence"], "GeometryStatus": "Reconstructed"})
    for s in plan["storeys"]:
        level = entity("IfcBuildingStorey", s["id"])
        level.Elevation = s["elevation"]
        run("aggregate.assign_object", products=[level], relating_object=building)
        place(level, z=s["elevation"])
        for w in s["walls"]:
            e = entity("IfcWall", w["id"])
            run("spatial.assign_container", products=[e], relating_structure=level)
            x, y = w["start"]
            a = math.atan2(w["end"][1]-y, w["end"][0]-x)
            prism(e, math.dist(w["start"], w["end"]), w["thickness"], w["height"])
            place(e, x, y, s["elevation"], a)
            provenance(e, w["id"])
            for o in w.get("openings", []):
                opening = entity("IfcOpeningElement", o["id"] + "-void")
                opening.PredefinedType = "OPENING"
                prism(opening, o["width"], w["thickness"] + .02, o["height"])
                run("feature.add_feature", feature=opening, element=e)
                px = x + math.cos(a)*o["offset"]
                py = y + math.sin(a)*o["offset"]
                place(opening, px + math.sin(a)*.01, py - math.cos(a)*.01, s["elevation"]+o["sill"], a)
                fill = entity("IfcDoor" if o["kind"] == "door" else "IfcWindow", o["id"])
                fill.OverallHeight = o["height"]
                fill.OverallWidth = o["width"]
                fill.PredefinedType = "DOOR" if o["kind"] == "door" else "WINDOW"
                run("spatial.assign_container", products=[fill], relating_structure=level)
                # A semantic, simplified infill; detailed jambs/glazing are a later DCC step.
                prism(fill, o["width"], .04, o["height"])
                place(fill, px-math.sin(a)*(w["thickness"]-.04)/2,
                      py+math.cos(a)*(w["thickness"]-.04)/2, s["elevation"]+o["sill"], a)
                run("feature.add_filling", opening=opening, element=fill)
                provenance(fill, o["id"])
        for slab in s.get("slabs", []):
            e = entity("IfcSlab", slab["id"])
            e.PredefinedType = "FLOOR"
            run("spatial.assign_container", products=[e], relating_structure=level)
            prism(e, slab["size"][0], slab["size"][1], slab["thickness"])
            place(e, *slab["origin"], s["elevation"]-slab["thickness"])
            provenance(e, slab["id"])
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation also protects against another process publishing the same name.
    with output.open("x", encoding="utf-8") as stream:
        stream.write(f.to_string())
    return {"output": str(output), "schema": f.schema, "walls": len(f.by_type("IfcWall")),
            "openings": len(f.by_type("IfcOpeningElement")), "doors": len(f.by_type("IfcDoor")),
            "windows": len(f.by_type("IfcWindow")), "slabs": len(f.by_type("IfcSlab")),
            "warnings": report["warnings"], "archicad_import_verified": False}
