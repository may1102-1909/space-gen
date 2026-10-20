"""Optional local stdio MCP adapter. It prepares files; it does not drive a DCC."""
import os
from pathlib import Path
from mcp.server.fastmcp import FastMCP
from .core import confined, style, catalogue, recipe, read_json
from .plan import validate_plan

mcp=FastMCP("Scene Agent Skills")


def workspace():
    return Path(os.environ.get("SCENE_AGENT_WORKSPACE", ".")).resolve()


@mcp.tool()
def list_styles() -> list[dict]:
    """Return available render styles; no files or model calls."""
    return [{"id":s["id"],"name":s["name"]} for s in catalogue("styles")]


@mcp.tool()
def get_scene_recipe(style_id: str, quality: str = "high") -> dict:
    """Return a structured planning recipe. Does not generate images or geometry."""
    return recipe(style_id,quality)


@mcp.tool()
def check_plan(relative_path: str) -> dict:
    """Validate a plan JSON inside SCENE_AGENT_WORKSPACE."""
    return validate_plan(read_json(confined(workspace(),relative_path)))


@mcp.tool()
def export_plan_ifc(relative_plan: str, relative_output: str) -> dict:
    """Create a new IFC4 file inside the workspace; existing files are never replaced."""
    from .ifc_export import export_ifc
    return export_ifc(read_json(confined(workspace(),relative_plan)),confined(workspace(),relative_output))


@mcp.tool()
def prepare_corona_script(relative_output: str, quality: str = "preview") -> dict:
    """Write a new MAXScript preset file. The user/host runs it separately in 3ds Max."""
    from .maxscript import generate_preset
    return generate_preset(confined(workspace(),relative_output),quality)


@mcp.tool()
def inspect_reference(relative_path: str) -> dict:
    """Check actual image encoding and dimensions locally. No image upload."""
    from .assets import inspect_image
    return inspect_image(confined(workspace(),relative_path))


def main():
    mcp.run(transport="stdio")


if __name__=="__main__":
    main()
