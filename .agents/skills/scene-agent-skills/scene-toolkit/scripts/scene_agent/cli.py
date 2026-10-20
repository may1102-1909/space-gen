"""Small, composable commands. Every output path is new-file-only."""
import argparse
import json
import sys
from .core import read_json, write_json, catalogue, style, recipe


def main(argv=None):
    p=argparse.ArgumentParser(prog="scene-agent")
    sub=p.add_subparsers(dest="cmd",required=True)
    sub.add_parser("styles",help="List the 16 style recipes")
    s=sub.add_parser("style");s.add_argument("id")
    r=sub.add_parser("recipe");r.add_argument("style");r.add_argument("--quality",choices=["low","high","very-high"],default="high");r.add_argument("--deliverable",choices=["image","editable-3d"],default="editable-3d");r.add_argument("--out",required=True)
    for cmd in ["plan-check","image-check","manifest"]:
        c=sub.add_parser(cmd);c.add_argument("input")
    c=sub.add_parser("scale");c.add_argument("--a",nargs=2,type=float,required=True);c.add_argument("--b",nargs=2,type=float,required=True);c.add_argument("--metres",type=float,required=True)
    for cmd in ["ifc","max-plan","camera-fit","max-camera"]:
        c=sub.add_parser(cmd);c.add_argument("input");c.add_argument("--out",required=True)
    c=sub.add_parser("corona");c.add_argument("--quality",choices=["preview","review","final"],default="preview");c.add_argument("--out",required=True)
    c=sub.add_parser("package");c.add_argument("input");c.add_argument("--out",required=True)
    a=p.parse_args(argv)
    try:
        code=0
        if a.cmd=="styles": result=[{"id":s["id"],"name":s["name"],"kind":s["kind"]} for s in catalogue("styles")]
        elif a.cmd=="style":result=style(a.id)
        elif a.cmd=="recipe":result=recipe(a.style,a.quality,a.deliverable);write_json(a.out,result)
        elif a.cmd=="plan-check":
            from .plan import validate_plan
            result=validate_plan(read_json(a.input));code=0 if result["valid"] else 2
        elif a.cmd=="scale":
            from .plan import calibrate
            result=calibrate(a.a,a.b,a.metres)
        elif a.cmd=="ifc":
            from .ifc_export import export_ifc
            result=export_ifc(read_json(a.input),a.out)
        elif a.cmd=="max-plan":
            from .maxscript import generate_plan
            result=generate_plan(read_json(a.input),a.out)
        elif a.cmd=="corona":
            from .maxscript import generate_preset
            result=generate_preset(a.out,a.quality)
        elif a.cmd=="camera-fit":
            from .camera import fit_camera
            result=fit_camera(read_json(a.input));write_json(a.out,result);code=0 if result["converged"] else 2
        elif a.cmd=="max-camera":
            from .maxscript import generate_camera
            result=generate_camera(read_json(a.input),a.out)
        elif a.cmd=="image-check":
            from .assets import inspect_image
            result=inspect_image(a.input)
        elif a.cmd=="manifest":
            from .assets import manifest
            result=manifest(a.input)
        elif a.cmd=="package":
            from .assets import package
            result=package(a.input,a.out)
        print(json.dumps(result,indent=2,ensure_ascii=True,allow_nan=False))
        return code
    except (ValueError,OSError,ImportError,KeyError,TypeError) as exc:
        print(json.dumps({"error":str(exc),"command":a.cmd}),file=sys.stderr)
        return 2


if __name__=="__main__":
    sys.exit(main())
