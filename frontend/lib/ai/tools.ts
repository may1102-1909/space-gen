/**
 * Gemini Spatial Tool Declarations
 * Conforming to @pascal-app/mcp & PlayCanvas Scene Graph inspection patterns.
 */

export interface ToolCallPayload {
  name: string;
  args: Record<string, any>;
}

export const SPATIAL_TOOL_DECLARATIONS = [
  {
    name: 'find_nodes',
    description: 'Query 3D architectural and furniture nodes in the scene by type, category, or name search.',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: {
          type: 'STRING',
          description: 'Node type: wall, item, zone, scan, slab, level',
        },
        category: {
          type: 'STRING',
          description: 'Category for furniture items: chair, sofa, coffee_table, dining_table, bed, plant',
        },
        query: {
          type: 'STRING',
          description: 'Free-text search substring matching node name or ID',
        },
      },
    },
  },
  {
    name: 'update_node_transform',
    description: 'Move, rotate, or resize an architectural node or furniture item in 3D world coordinates.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nodeId: {
          type: 'STRING',
          description: 'The unique ID of the node to transform (e.g. item_sofa_1, wall_north)',
        },
        position: {
          type: 'ARRAY',
          items: { type: 'NUMBER' },
          description: '[x, y, z] position in meters. (y is up)',
        },
        rotation: {
          type: 'ARRAY',
          items: { type: 'NUMBER' },
          description: '[rx, ry, rz] Euler rotation in radians.',
        },
        dimensions: {
          type: 'ARRAY',
          items: { type: 'NUMBER' },
          description: '[width, height, depth] dimensions in meters.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'replace_item_asset',
    description: 'Replace an existing furniture item with a new 3D model asset (.glb) or updated style/material, while keeping orientation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nodeId: {
          type: 'STRING',
          description: 'ID of the item node to replace',
        },
        newModelUrl: {
          type: 'STRING',
          description: 'URL of the new 3D model (.glb)',
        },
        newName: {
          type: 'STRING',
          description: 'Display name of the replacement item',
        },
        dimensions: {
          type: 'ARRAY',
          items: { type: 'NUMBER' },
          description: '[width, height, depth] dimensions in meters',
        },
        materialStyle: {
          type: 'OBJECT',
          properties: {
            color: { type: 'STRING', description: 'Hex color or material tone (e.g. #8B5A2B)' },
            roughness: { type: 'NUMBER', description: 'PBR roughness 0.0 - 1.0' },
            metalness: { type: 'NUMBER', description: 'PBR metalness 0.0 - 1.0' },
          },
        },
      },
      required: ['nodeId', 'newModelUrl'],
    },
  },
  {
    name: 'spawn_items_smartly',
    description: 'Spawn one or more new 3D items into the room with realistic collision-free spatial coordinates.',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              category: { type: 'STRING', description: 'Item category (e.g. chair, lamp, table)' },
              name: { type: 'STRING', description: 'Readable label for the item' },
              modelUrl: { type: 'STRING', description: 'Model GLB URL' },
              position: {
                type: 'ARRAY',
                items: { type: 'NUMBER' },
                description: '[x, y, z] coordinate in meters',
              },
              rotation: {
                type: 'ARRAY',
                items: { type: 'NUMBER' },
                description: '[rx, ry, rz] Euler rotation in radians',
              },
              dimensions: {
                type: 'ARRAY',
                items: { type: 'NUMBER' },
                description: '[w, h, d] dimensions in meters',
              },
              targetZoneId: { type: 'STRING', description: 'Optional ID of zone to place within' },
            },
            required: ['category', 'name', 'modelUrl', 'position', 'dimensions'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'modify_architecture',
    description: 'Modify architectural walls or room boundaries (thickness, height, or surface finishes).',
    parameters: {
      type: 'OBJECT',
      properties: {
        wallId: {
          type: 'STRING',
          description: 'The wall node ID to modify',
        },
        action: {
          type: 'STRING',
          description: 'Action type: set_wall_thickness, set_wall_height, set_wall_finish',
        },
        thickness: { type: 'NUMBER', description: 'Wall thickness in meters (e.g. 0.15, 0.20)' },
        height: { type: 'NUMBER', description: 'Wall height in meters (e.g. 2.8, 3.2)' },
        finish: { type: 'STRING', description: 'Surface finish name or color hex (e.g. warm sage, #8FA89B)' },
      },
      required: ['wallId', 'action'],
    },
  },
];
