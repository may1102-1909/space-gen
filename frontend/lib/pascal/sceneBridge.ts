import { useScene, AnyNode, AnyNodeId } from '@pascal-app/core';
import { replaceItemAsset } from './itemEditing';

export interface SplatExclusionBox {
  id: string;
  center: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
}

export interface EditableSceneSummary {
  siteId: string | null;
  buildingId: string | null;
  activeLevelId: string | null;
  levels: Array<{
    id: string;
    name: string;
    elevation: number;
    height: number;
  }>;
  zones: Array<{
    id: string;
    name: string;
    category?: string;
    levelId: string | null;
    polygon?: any;
  }>;
  walls: Array<{
    id: string;
    name: string;
    start: [number, number];
    end: [number, number];
    height: number;
    thickness: number;
    levelId: string | null;
  }>;
  items: Array<{
    id: string;
    name: string;
    category?: string;
    position: [number, number, number];
    rotation?: [number, number, number];
    dimensions?: [number, number, number];
    modelUrl?: string;
    levelId: string | null;
  }>;
  scans: Array<{
    id: string;
    name: string;
    url?: string;
    visible: boolean;
    opacity: number;
    exclusionBoxes: SplatExclusionBox[];
  }>;
}

export type SceneAction =
  | {
      action: 'create_node';
      node: AnyNode;
      parentId?: string;
    }
  | {
      action: 'update_transform';
      nodeId: string;
      position?: [number, number, number];
      rotation?: [number, number, number];
      dimensions?: [number, number, number];
    }
  | {
      action: 'replace_asset';
      nodeId: string;
      newModelUrl: string;
      newName?: string;
      dimensions?: [number, number, number];
      materialStyle?: Record<string, any>;
    }
  | {
      action: 'delete_node';
      nodeId: string;
    }
  | {
      action: 'add_splat_exclusion';
      scanNodeId?: string;
      box: SplatExclusionBox;
    };

/**
 * Returns a compact, structured JSON snapshot of the scene graph
 * formatted specifically for AI spatial planning and prompt injection.
 */
export function getEditableSceneSummary(): EditableSceneSummary {
  const nodes = useScene.getState().nodes;
  let siteId: string | null = null;
  let buildingId: string | null = null;
  let activeLevelId: string | null = null;

  const levels: EditableSceneSummary['levels'] = [];
  const zones: EditableSceneSummary['zones'] = [];
  const walls: EditableSceneSummary['walls'] = [];
  const items: EditableSceneSummary['items'] = [];
  const scans: EditableSceneSummary['scans'] = [];

  for (const node of Object.values(nodes)) {
    if (!node) continue;

    switch (node.type) {
      case 'site':
        siteId = node.id;
        break;

      case 'building':
        buildingId = node.id;
        break;

      case 'level':
        levels.push({
          id: node.id,
          name: node.name || 'Level',
          elevation: (node as any).elevation ?? 0,
          height: (node as any).height ?? 3.0,
        });
        if (!activeLevelId) activeLevelId = node.id;
        break;

      case 'zone':
        zones.push({
          id: node.id,
          name: node.name || 'Zone',
          category: (node as any).category,
          levelId: (node as any).parentId || null,
          polygon: (node as any).polygon,
        });
        break;

      case 'wall':
        walls.push({
          id: node.id,
          name: node.name || 'Wall',
          start: (node as any).start || [0, 0],
          end: (node as any).end || [1, 0],
          height: (node as any).height ?? 3.0,
          thickness: (node as any).thickness ?? 0.2,
          levelId: (node as any).parentId || null,
        });
        break;

      case 'item': {
        const itemNode = node as any;
        const dims = itemNode.asset?.dimensions || itemNode.dimensions || [0.8, 0.8, 0.8];
        const src = itemNode.asset?.src || itemNode.modelUrl;
        items.push({
          id: node.id,
          name: node.name || 'Item',
          category: itemNode.category || itemNode.asset?.category,
          position: itemNode.position || [0, 0, 0],
          rotation: itemNode.rotation || [0, 0, 0],
          dimensions: dims,
          modelUrl: src,
          levelId: itemNode.parentId || null,
        });
        break;
      }

      case 'scan':
        scans.push({
          id: node.id,
          name: node.name || 'Scan',
          url: (node as any).url,
          visible: (node as any).visible ?? true,
          opacity: (node as any).opacity ?? 100,
          exclusionBoxes: (node as any).metadata?.exclusionBoxes || [],
        });
        break;
    }
  }

  return {
    siteId,
    buildingId,
    activeLevelId,
    levels,
    zones,
    walls,
    items,
    scans,
  };
}

/**
 * Executes a batch of scene actions in a single atomic Zundo undo/redo transaction.
 */
export function applySceneActions(actions: SceneAction[]): void {
  const scene = useScene.getState();
  const creates: Array<{ node: AnyNode; parentId?: AnyNodeId }> = [];
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = [];
  const deletes: AnyNodeId[] = [];

  for (const act of actions) {
    switch (act.action) {
      case 'create_node':
        creates.push({
          node: act.node,
          parentId: act.parentId as AnyNodeId | undefined,
        });
        break;

      case 'update_transform': {
        const patch: Record<string, any> = {};
        if (act.position) patch.position = act.position;
        if (act.rotation) patch.rotation = act.rotation;
        if (act.dimensions) patch.dimensions = act.dimensions;
        updates.push({
          id: act.nodeId as AnyNodeId,
          data: patch as any,
        });
        break;
      }

      case 'replace_asset': {
        const existingNode = (scene.nodes as Record<string, any>)[act.nodeId];
        if (!existingNode || existingNode.type !== 'item') break;
        const dims = act.dimensions || existingNode.asset?.dimensions || [1, 1, 1];
        const replaced = replaceItemAsset(existingNode, {
          id: existingNode.asset?.id,
          name: act.newName || existingNode.asset?.name || existingNode.name || 'Item',
          category: existingNode.asset?.category || existingNode.category || 'item',
          src: act.newModelUrl,
          dimensions: dims,
        });
        updates.push({
          id: act.nodeId as AnyNodeId,
          data: replaced as any,
        });
        break;
      }

      case 'delete_node':
        deletes.push(act.nodeId as AnyNodeId);
        break;

      case 'add_splat_exclusion': {
        // Find target scan node (default to first scan if not specified)
        const targetScanId =
          act.scanNodeId ||
          Object.values(scene.nodes).find((n) => n?.type === 'scan')?.id;

        if (targetScanId && (scene.nodes as Record<string, any>)[targetScanId]) {
          const scanNode = (scene.nodes as Record<string, any>)[targetScanId];
          const currentBoxes: SplatExclusionBox[] =
            scanNode.metadata?.exclusionBoxes || [];
          updates.push({
            id: targetScanId as AnyNodeId,
            data: {
              metadata: {
                ...scanNode.metadata,
                exclusionBoxes: [...currentBoxes, act.box],
              },
            } as any,
          });
        }
        break;
      }
    }
  }

  // Commit all changes in a single operation
  scene.applyNodeChanges({
    create: creates.length > 0 ? creates : undefined,
    update: updates.length > 0 ? updates : undefined,
    delete: deletes.length > 0 ? deletes : undefined,
  });
}

/**
 * Triggers a 1-step undo via Zundo temporal store.
 */
export function undoSceneAction(): void {
  const temporal = (useScene as any).temporal;
  if (temporal && typeof temporal.getState === 'function') {
    temporal.getState().undo();
  }
}

/**
 * Triggers a 1-step redo via Zundo temporal store.
 */
export function redoSceneAction(): void {
  const temporal = (useScene as any).temporal;
  if (temporal && typeof temporal.getState === 'function') {
    temporal.getState().redo();
  }
}
