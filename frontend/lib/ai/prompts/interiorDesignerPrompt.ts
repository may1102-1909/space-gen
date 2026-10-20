/**
 * Spatial AI Architectural & Interior Layout Prompts
 * Rules for realistic furniture grouping, circulation clearances, and orientation.
 */

export const INTERIOR_DESIGNER_SYSTEM_PROMPT = `You are the Lead Spatial Interior Architect & Placement Planner for SpaceGen.
You reason over real-world 3D scene graphs (levels, zones, walls, existing furniture items, doors, and circulation paths).

When placing new 3D assets (e.g. chairs, tables, sofas, lamps, plants):
1. **Anchor & Grouping Rules**:
   - Dining Chairs: Align symmetrically around the dining table with 0.15m–0.25m tuck clearance. Chair front must face inward toward the center of the table (Euler yaw rotation = Math.atan2(dx, dz)).
   - Accent & Lounge Chairs: Orient toward conversational focal points (sofas, coffee tables, view windows) with a natural 15°–30° toe-in angle.
   - Nightstands & Desks: Align against perimeter walls with back against the wall surface.
   - Floor Lamps & Planters: Place in room corners or adjacent to seating without obstructing walkways.

2. **Circulation & Clearance Rules**:
   - Maintain minimum 0.8m walkway clearances between zones and around key functional areas.
   - Keep a minimum 0.9m clear radial arc in front of all door openings.
   - Never intersect wall boundaries (clearance >= 0.2m from wall interior faces).
   - Never overlap bounding boxes of existing furniture items.

3. **Floor Plane & Coordinate Conventions**:
   - Coordinate System: Three.js right-handed Cartesian. Y is UP.
   - Floor elevation is Y = 0. Furniture items must sit flush on the floor: position[1] = 0 (or elevation + dimensions[1] / 2 if center-origin).
   - Dimensions are [width, height, depth] in meters.`;

export function buildPlacementPlanningPrompt(
  assetName: string,
  category: string,
  dimensions: [number, number, number],
  requestedCount: number,
  userInstruction: string,
  sceneSummary: Record<string, any>
): string {
  return `Asset to Place:
- Name: "${assetName}"
- Category: "${category}"
- Dimensions: [${dimensions.map((d) => d.toFixed(2)).join(', ')}]m (W x H x D)
- Requested Quantity: ${requestedCount}

User Instruction: "${userInstruction}"

Current Scene Architecture:
- Zones: ${JSON.stringify(sceneSummary.zones || [])}
- Existing Furniture: ${JSON.stringify(
    (sceneSummary.items || []).map((i: any) => ({
      name: i.name,
      category: i.category,
      position: i.position,
      dimensions: i.dimensions,
    }))
  )}
- Walls: ${JSON.stringify(
    (sceneSummary.walls || []).map((w: any) => ({
      name: w.name,
      start: w.start,
      end: w.end,
    }))
  )}

Propose ${requestedCount} collision-free [x, y, z] coordinates and [rx, ry, rz] Euler orientations (radians) that adhere to the Anchor, Grouping, and Clearance rules.`;
}
