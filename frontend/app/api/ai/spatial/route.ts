import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, type FunctionDeclaration, type Part } from '@google/genai';
import { SPATIAL_TOOL_DECLARATIONS, ToolCallPayload } from '@/lib/ai/tools';
import { EditableSceneSummary } from '@/lib/pascal/sceneBridge';

interface SpatialRequestPayload {
  prompt: string;
  sceneSummary: EditableSceneSummary;
  selectedIds?: string[];
  attachment?: {
    type: 'image' | 'glb';
    dataUrl?: string;
    name?: string;
  };
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function POST(req: NextRequest) {
  try {
    const body: SpatialRequestPayload = await req.json();
    const { prompt, sceneSummary, selectedIds = [], attachment } = body;

    const apiKey = process.env.GEMINI_API_KEY;

    // 1. If Gemini API Key is available, use official @google/genai SDK
    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `You are the AI Spatial Architecture & Interior Co-Pilot for SpaceGen.
You interact directly with a 3D architectural scene graph via function calling.
The current scene contains:
- Levels: ${JSON.stringify(sceneSummary.levels)}
- Zones: ${JSON.stringify(sceneSummary.zones)}
- Walls: ${JSON.stringify(sceneSummary.walls)}
- Furniture Items: ${JSON.stringify(sceneSummary.items)}
- Currently Selected Node IDs: ${JSON.stringify(selectedIds)}

Coordinate convention:
- Y is UP. The floor slab is at Y = 0.
- X is left/right, Z is forward/back.
- When moving furniture, keep Y at floor contact (Y = 0 or item elevation).
- When asked to move, replace, restyle, or spawn items, emit tool calls:
  - update_node_transform(nodeId, position, rotation, dimensions)
  - replace_item_asset(nodeId, newModelUrl, newName, dimensions, materialStyle)
  - spawn_items_smartly(items)
  - modify_architecture(wallId, action, thickness, height, finish)
Always provide a concise, friendly explanation in text alongside any tool calls.`;

        const contents: Part[] = [{ text: prompt }];

        if (attachment?.type === 'image' && attachment.dataUrl) {
          const match = attachment.dataUrl.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
          if (match) {
            contents.unshift({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents,
          config: {
            systemInstruction,
            // Function declarations for spatial tools
            tools: [{ functionDeclarations: SPATIAL_TOOL_DECLARATIONS as unknown as FunctionDeclaration[] }],
          },
        });

        const toolCalls: ToolCallPayload[] = [];
        const functionCalls = response.functionCalls;
        if (functionCalls && Array.isArray(functionCalls)) {
          for (const fc of functionCalls) {
            toolCalls.push({
              name: fc.name ?? '',
              args: fc.args || {},
            });
          }
        }

        const responseText =
          response.text ||
          (toolCalls.length > 0
            ? `I have updated the 3D scene: executed ${toolCalls.length} spatial action(s).`
            : "I've analyzed your scene. How would you like to arrange or style it?");

        return NextResponse.json({
          text: responseText,
          toolCalls,
        });
      } catch (geminiError) {
        console.warn(
          '[Spatial API] Gemini call failed or hit rate-limit; falling back to local heuristic reasoning:',
          (geminiError as Error)?.message
        );
      }
    }

    // 2. Intelligent Deterministic Local Fallback (zero external API required)
    const localResult = solveLocally(prompt, sceneSummary, selectedIds, attachment);
    return NextResponse.json(localResult);
  } catch (err) {
    console.error('[Spatial API] Error processing request:', err);
    return NextResponse.json(
      { error: (err as Error)?.message || 'Internal spatial processing error' },
      { status: 500 }
    );
  }
}

/**
 * Deterministic spatial reasoning engine for offline/demo/instant responses
 */
function solveLocally(
  prompt: string,
  scene: EditableSceneSummary,
  selectedIds: string[],
  attachment?: { type: 'image' | 'glb'; dataUrl?: string; name?: string }
): { text: string; toolCalls: ToolCallPayload[] } {
  const p = prompt.toLowerCase();
  const toolCalls: ToolCallPayload[] = [];
  let reply = '';

  // 1. Move sofa closer to coffee table / move items
  if (p.includes('sofa') && p.includes('closer') && p.includes('table')) {
    const sofa = scene.items.find((i) => i.category === 'sofa' || i.name.toLowerCase().includes('sofa'));
    const table = scene.items.find((i) => i.category === 'coffee_table' || i.name.toLowerCase().includes('table'));

    if (sofa && table) {
      // Vector from sofa to table
      const dx = table.position[0] - sofa.position[0];
      const dz = table.position[2] - sofa.position[2];
      const dist = Math.hypot(dx, dz) || 1;
      const step = 0.5; // 0.5 meters closer
      const ratio = Math.min(step / dist, 0.4);

      const newPos: [number, number, number] = [
        Number((sofa.position[0] + dx * ratio).toFixed(2)),
        sofa.position[1],
        Number((sofa.position[2] + dz * ratio).toFixed(2)),
      ];

      toolCalls.push({
        name: 'update_node_transform',
        args: {
          nodeId: sofa.id,
          position: newPos,
          rotation: sofa.rotation,
          dimensions: sofa.dimensions,
        },
      });

      reply = `Moved "${sofa.name}" 0.5m closer to "${table.name}" (new position: [${newPos.join(', ')}]).`;
    } else {
      reply = `Could not locate both sofa and coffee table in the scene graph.`;
    }
  }

  // 2. Paint / Finish North wall (e.g. "paint the north wall warm sage")
  if (p.includes('wall') && (p.includes('sage') || p.includes('paint') || p.includes('finish') || p.includes('color'))) {
    const northWall = scene.walls.find((w) => w.name.toLowerCase().includes('north') || w.id.includes('north')) || scene.walls[0];
    const finish = p.includes('sage') ? 'Warm Sage (#8FA89B)' : p.includes('blue') ? 'Nordic Blue (#4B6B94)' : 'Studio White';

    if (northWall) {
      toolCalls.push({
        name: 'modify_architecture',
        args: {
          wallId: northWall.id,
          action: 'set_wall_finish',
          finish,
        },
      });

      reply += (reply ? '\n' : '') + `Updated "${northWall.name}" finish to ${finish}.`;
    }
  }

  // 3. Replace chair / sofa (or selected object)
  if (p.includes('replace') || (attachment && attachment.type === 'image' && p.includes('photo'))) {
    const targetId = selectedIds[0] || scene.items.find((i) => i.category === 'chair' || i.category === 'sofa')?.id;
    const targetItem = scene.items.find((i) => i.id === targetId);

    if (targetItem) {
      const isChair = targetItem.category === 'chair' || targetItem.name.toLowerCase().includes('chair');
      const newModelUrl = isChair ? '/samples/models/chair.glb' : '/samples/models/sofa.glb';
      const newName = isChair ? 'Nordic Walnut Dining Chair' : 'Contemporary Minimalist Sofa';

      toolCalls.push({
        name: 'replace_item_asset',
        args: {
          nodeId: targetItem.id,
          newModelUrl,
          newName,
          dimensions: targetItem.dimensions || [0.6, 0.85, 0.6],
          materialStyle: {
            color: '#8B5A2B',
            roughness: 0.45,
            metalness: 0.1,
          },
        },
      });

      reply += (reply ? '\n' : '') + `Replaced "${targetItem.name}" with "${newName}", masked underlying scan points, and updated materials.`;
    }
  }

  // 4. Scandinavian / Style preset
  if (p.includes('scandinavian') || p.includes('luxurious') || p.includes('minimalist')) {
    const chairs = scene.items.filter((i) => i.category === 'chair');
    for (const ch of chairs) {
      toolCalls.push({
        name: 'replace_item_asset',
        args: {
          nodeId: ch.id,
          newModelUrl: '/samples/models/chair.glb',
          newName: `Scandinavian Ash Chair (${ch.name})`,
          materialStyle: { color: '#E8D8C8', roughness: 0.6, metalness: 0.05 },
        },
      });
    }

    reply += (reply ? '\n' : '') + `Applied Scandinavian design theme: updated furniture to light natural ash wood and matte warm textures.`;
  }

  // 5. Smart placement (e.g. "place chairs", "place 4 chairs")
  if (p.includes('place') && (p.includes('chair') || p.includes('furniture'))) {
    const diningTable = scene.items.find((i) => i.category === 'dining_table' || i.name.toLowerCase().includes('dining'));
    const tPos = diningTable?.position || [0, 0, 0];

    const newChairs = [
      {
        category: 'chair',
        name: 'Dining Chair North',
        modelUrl: '/samples/models/chair.glb',
        position: [tPos[0], 0, tPos[2] - 0.75] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        dimensions: [0.55, 0.85, 0.55] as [number, number, number],
      },
      {
        category: 'chair',
        name: 'Dining Chair South',
        modelUrl: '/samples/models/chair.glb',
        position: [tPos[0], 0, tPos[2] + 0.75] as [number, number, number],
        rotation: [0, Math.PI, 0] as [number, number, number],
        dimensions: [0.55, 0.85, 0.55] as [number, number, number],
      },
    ];

    toolCalls.push({
      name: 'spawn_items_smartly',
      args: { items: newChairs },
    });

    reply += (reply ? '\n' : '') + `Spawned 2 dining chairs symmetrically aligned with "${diningTable?.name || 'the dining table'}" with proper tuck clearance.`;
  }

  // Default fallback if no specific rule matched
  if (!reply) {
    reply = `I have analyzed your spatial request: "${prompt}". You can ask me to move items, replace furniture with reference photos, restyle walls, or auto-place items around your room!`;
  }

  return { text: reply, toolCalls };
}
