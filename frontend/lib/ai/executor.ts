import { useScene, AnyNodeId } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { applySceneActions, SceneAction, SplatExclusionBox } from '@/lib/pascal/sceneBridge';
import { addExclusionVolumeToScan } from '@/lib/splat/splatCropManager';
import { ToolCallPayload } from './tools';

export interface ExecutionResult {
  success: boolean;
  toolName: string;
  modifiedNodeIds: string[];
  message: string;
}

/**
 * Executes a batch of Gemini spatial tool calls against the live Pascal scene graph
 * and records atomic Zundo history so changes can be reverted in 1 click.
 */
export function executeSpatialToolCalls(
  toolCalls: ToolCallPayload[]
): ExecutionResult[] {
  const scene = useScene.getState();
  const allModifiedIds: string[] = [];
  const results: ExecutionResult[] = [];
  const actions: SceneAction[] = [];

  // Identify active level and active scan node
  const activeLevelId =
    Object.values(scene.nodes).find((n) => n?.type === 'level')?.id || 'level_main';
  const scanNode = Object.values(scene.nodes).find((n) => n?.type === 'scan');

  for (const call of toolCalls) {
    const { name, args } = call;

    switch (name) {
      case 'find_nodes': {
        const { type, category, query } = args;
        const matches = Object.values(scene.nodes).filter((node) => {
          if (!node) return false;
          if (type && node.type !== type) return false;
          if (category && (node as any).category !== category) return false;
          if (query) {
            const q = query.toLowerCase();
            const nodeName = (node.name || '').toLowerCase();
            const nodeId = node.id.toLowerCase();
            if (!nodeName.includes(q) && !nodeId.includes(q)) return false;
          }
          return true;
        });

        results.push({
          success: true,
          toolName: name,
          modifiedNodeIds: [],
          message: `Found ${matches.length} matching nodes: ${matches.map((m) => m.name || m.id).join(', ')}`,
        });
        break;
      }

      case 'update_node_transform': {
        const { nodeId, position, rotation, dimensions } = args;
        const targetNode = scene.nodes[nodeId as AnyNodeId];

        if (!targetNode) {
          results.push({
            success: false,
            toolName: name,
            modifiedNodeIds: [],
            message: `Node "${nodeId}" not found in scene.`,
          });
          continue;
        }

        // If moving an item that has an underlying scan, mask the old bounding box
        if (targetNode.type === 'item' && scanNode && (targetNode as any).position) {
          const oldPos = (targetNode as any).position as [number, number, number];
          const oldDims = (targetNode as any).dimensions || [1, 1, 1];
          addExclusionVolumeToScan(scanNode.id, {
            id: `box_moved_${nodeId}_${Date.now()}`,
            type: 'box',
            center: oldPos,
            size: [oldDims[0] * 1.05, oldDims[1] * 1.05, oldDims[2] * 1.05],
            rotation: (targetNode as any).rotation,
            mode: 'exclude',
            label: `Mask old footprint of ${targetNode.name || nodeId}`,
          });
        }

        actions.push({
          action: 'update_transform',
          nodeId,
          position,
          rotation,
          dimensions,
        });

        allModifiedIds.push(nodeId);
        results.push({
          success: true,
          toolName: name,
          modifiedNodeIds: [nodeId],
          message: `Updated transform for "${targetNode.name || nodeId}".`,
        });
        break;
      }

      case 'replace_item_asset': {
        const { nodeId, newModelUrl, newName, dimensions, materialStyle } = args;
        const targetNode = scene.nodes[nodeId as AnyNodeId];

        if (!targetNode) {
          results.push({
            success: false,
            toolName: name,
            modifiedNodeIds: [],
            message: `Target item "${nodeId}" not found in scene.`,
          });
          continue;
        }

        // Add SuperSplat exclusion box over the item's current footprint so raw splats vanish
        if (scanNode && (targetNode as any).position) {
          const pos = (targetNode as any).position as [number, number, number];
          const dims = (targetNode as any).dimensions || [1, 1, 1];
          addExclusionVolumeToScan(scanNode.id, {
            id: `box_replace_${nodeId}_${Date.now()}`,
            type: 'box',
            center: pos,
            size: [dims[0] * 1.05, dims[1] * 1.05, dims[2] * 1.05],
            rotation: (targetNode as any).rotation,
            mode: 'exclude',
            label: `Replaced ${targetNode.name || nodeId}`,
          });
        }

        actions.push({
          action: 'replace_asset',
          nodeId,
          newModelUrl,
          newName,
          dimensions,
          materialStyle,
        });

        allModifiedIds.push(nodeId);
        results.push({
          success: true,
          toolName: name,
          modifiedNodeIds: [nodeId],
          message: `Replaced asset on "${targetNode.name || nodeId}" with ${newName || newModelUrl}.`,
        });
        break;
      }

      case 'spawn_items_smartly': {
        const { items } = args;
        if (!Array.isArray(items)) continue;

        const spawnedIds: string[] = [];
        items.forEach((item, index) => {
          const itemId = `item_${item.category || 'furniture'}_${Date.now()}_${index}`;
          actions.push({
            action: 'create_node',
            node: {
              type: 'item',
              id: itemId,
              name: item.name || `${item.category} ${index + 1}`,
              category: item.category,
              position: item.position || [0, 0, 0],
              rotation: item.rotation || [0, 0, 0],
              dimensions: item.dimensions || [0.8, 0.8, 0.8],
              scale: [1, 1, 1],
              modelUrl: item.modelUrl || '/samples/models/chair.glb',
              asset: {
                id: `asset_${itemId}`,
                category: item.category || 'furniture',
                name: item.name || `${item.category} ${index + 1}`,
                thumbnail: '',
                source: 'library',
                src: item.modelUrl || '/samples/models/chair.glb',
                dimensions: item.dimensions || [0.8, 0.8, 0.8],
                offset: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
              },
            } as any,
            parentId: activeLevelId,
          });
          spawnedIds.push(itemId);
          allModifiedIds.push(itemId);
        });

        results.push({
          success: true,
          toolName: name,
          modifiedNodeIds: spawnedIds,
          message: `Spawned ${spawnedIds.length} new items: ${spawnedIds.join(', ')}`,
        });
        break;
      }

      case 'modify_architecture': {
        const { wallId, action, thickness, height, finish } = args;
        const targetWall = scene.nodes[wallId as AnyNodeId];

        if (!targetWall) {
          results.push({
            success: false,
            toolName: name,
            modifiedNodeIds: [],
            message: `Wall "${wallId}" not found.`,
          });
          continue;
        }

        const wallPatch: Record<string, any> = {};
        if (thickness !== undefined) wallPatch.thickness = thickness;
        if (height !== undefined) wallPatch.height = height;
        if (finish !== undefined) wallPatch.finish = finish;

        // Custom action for wall modification
        actions.push({
          action: 'update_transform',
          nodeId: wallId,
          dimensions: undefined,
        });

        // Apply direct update for wall properties
        scene.applyNodeChanges({
          update: [{ id: wallId as AnyNodeId, data: wallPatch as any }],
        });

        allModifiedIds.push(wallId);
        results.push({
          success: true,
          toolName: name,
          modifiedNodeIds: [wallId],
          message: `Modified wall "${targetWall.name || wallId}" (${action}${finish ? ` with finish: ${finish}` : ''}).`,
        });
        break;
      }
    }
  }

  // Commit all queued actions
  if (actions.length > 0) {
    applySceneActions(actions);
  }

  // Highlight all modified items in the 3D viewport
  if (allModifiedIds.length > 0) {
    useViewer.getState().setSelection({ selectedIds: allModifiedIds as any });
  }

  return results;
}
