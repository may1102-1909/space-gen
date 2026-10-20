"""Generate inspectable MAXScript; execution is a separate, explicit host action."""
import math
from pathlib import Path
from .core import write_new
from .plan import require_plan


def ms_string(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n','\\n').replace('\r','\\r').replace('\t','\\t') + '"'


def toolkit():
    return (Path(__file__).parent / "templates" / "corona_tools.ms").read_text(encoding="utf-8")


def generate_preset(output, quality="preview"):
    if quality not in ("preview", "review", "final"):
        raise ValueError("quality must be preview, review or final")
    write_new(output, toolkit() + f'\nsaQuality #{quality}\n')
    return {"output": str(output), "executes_on_load": "sets quality on an existing Corona renderer", "render_started": False}


def wall_cells(w):
    """Grid-decompose walls around openings: closed boxes, no boolean tolerance debt."""
    length = math.dist(w["start"], w["end"])
    xs, zs = {0., length}, {0., w["height"]}
    for o in w.get("openings", []):
        xs.update([o["offset"], o["offset"]+o["width"]])
        zs.update([o["sill"], o["sill"]+o["height"]])
    xs, zs = sorted(xs), sorted(zs)
    for a,b in zip(xs,xs[1:]):
        for c,d in zip(zs,zs[1:]):
            x,z = (a+b)/2,(c+d)/2
            inside = any(o["offset"] < x < o["offset"]+o["width"] and o["sill"] < z < o["sill"]+o["height"] for o in w.get("openings", []))
            if not inside and b-a>1e-8 and d-c>1e-8:
                yield a,b,c,d


def generate_plan(plan, output):
    require_plan(plan)
    lines = [toolkit(), '\n(\nlocal metre=units.decodeValue "1m"',
             'local layerName="SA | Plan | " + (timestamp() as string)',
             'local layer=LayerManager.newLayerFromName layerName',
             'local m=saPhysical "SA | Plan clay" (color 175 173 166) roughness:0.7',
             'local n']
    def box(name, x,y,z, width,depth,height, angle=0):
        lines.append(f'n=box name:{ms_string(name)} width:({width:.9f}*metre) length:({depth:.9f}*metre) height:({height:.9f}*metre) mapCoords:true')
        lines.append(f'n.rotation=eulerAngles 0 0 {math.degrees(angle):.9f}')
        lines.append(f'n.pos=[{x:.9f}*metre,{y:.9f}*metre,{z:.9f}*metre]; n.material=m; layer.addNode n')
    for s in plan["storeys"]:
        for w in s["walls"]:
            angle=math.atan2(w["end"][1]-w["start"][1],w["end"][0]-w["start"][0])
            for index,(a,b,c,d) in enumerate(wall_cells(w)):
                x=w["start"][0]+math.cos(angle)*(a+b)/2-math.sin(angle)*w["thickness"]/2
                y=w["start"][1]+math.sin(angle)*(a+b)/2+math.cos(angle)*w["thickness"]/2
                box(f"SA | {w['id']} | cell {index}",x,y,s["elevation"]+c,b-a,w["thickness"],d-c,angle)
        for slab in s.get("slabs",[]):
            box(f"SA | {slab['id']}", slab["origin"][0]+slab["size"][0]/2,slab["origin"][1]+slab["size"][1]/2,
                s["elevation"]-slab["thickness"], *slab["size"],slab["thickness"])
    lines += [')', '-- Additive blockout only. Opening infills and production details are not generated here.']
    write_new(output, "\n".join(lines)+"\n")
    return {"output": str(output), "scope": "additive wall cells and slabs; no reset, no render, no infills"}


def generate_camera(solution, output):
    if not solution.get("converged") or not solution.get("all_points_in_front"):
        raise ValueError("Refusing to transfer an unconverged or behind-camera solution")
    r=solution["world_to_camera_rotation"]
    # Max camera uses local -Z forward and +Y up, unlike the fitting convention.
    rows=[r[0], [-v for v in r[1]], [-v for v in r[2]]]
    def p(v):
        return '['+','.join(f'{float(x):.12f}' for x in v)+']'
    pos=solution["position_m"]
    nums=[*pos,*sum(rows,[]),solution["horizontal_fov_degrees"],*solution["image_size"]]
    if not all(math.isfinite(float(x)) for x in nums):
        raise ValueError("Camera contains non-finite values")
    script='\n'.join(['(', 'local metre=units.decodeValue "1m"',
                     'local c=CoronaCam name:"SA | Matched camera"',
                     'c.targeted=false; c.fovSource=0; c.enableDof=false',
                     f'c.transform=matrix3 {p(rows[0])} {p(rows[1])} {p(rows[2])} ({p(pos)}*metre)',
                     f'c.fov={solution["horizontal_fov_degrees"]:.12f}',
                     'c.autoVerticalTilt=false; c.verticalShift=0',
                     f'renderWidth={int(solution["image_size"][0])}; renderHeight={int(solution["image_size"][1])}; renderPixelAspect=1.0',
                     'viewport.setCamera c', ')'])
    write_new(output,script+'\n')
    return {"output": str(output), "scope": "creates camera, sets output size and active viewport"}
