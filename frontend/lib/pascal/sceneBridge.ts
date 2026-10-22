import { useScene, AnyNode, AnyNodeId } from '@pascal-app/core';
import { asNodeData, asNodeId, findScanNode, scanMetadata, type ItemNode, type NodeFields } from './nodes';
import { replaceItemAsset } from './itemEditing';
import { createMaskRegionForNode } from '../splat/splatMasking';
import type { EditRecord, MaskRegion } from '@/lib/contracts';

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
    polygon?: unknown;
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
    maskRegions: MaskRegion[];
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
      scale?: [number, number, number];
      dimensions?: [number, number, number];
    }
  | {
      action: 'replace_asset';
      nodeId: string;
      newModelUrl: string;
      newName?: string;
      dimensions?: [number, number, number];
      materialStyle?: Record<string, unknown>;
    }
  | {
      action: 'delete_node';
      nodeId: string;
    }
  | {
      action: 'add_splat_exclusion';
      scanNodeId?: string;
      box: SplatExclusionBox;
    }
  | {
      /** Adds (or replaces, by id) a MaskRegion on the scan node. */
      action: 'add_mask_region';
      mask: MaskRegion;
    }
  | {
      /** Appends to the edit history mirrored into the manifest on save. */
      action: 'append_edit_record';
      record: EditRecord;
    };

/**
 * The node whose metadata.editHistory holds the project's EditRecords: the scan node, else the
 * site or first level. Keeping them in the Pascal scene makes an accepted edit and its record one
 * undo step.
 */
export function editHistoryHost(nodes: Record<string, unknown> = useScene.getState().nodes): NodeFields | undefined {
  const list = Object.values(nodes) as Array<NodeFields | undefined>;
  return list.find((n) => n?.type === 'scan') ?? list.find((n) => n?.type === 'site') ?? list.find((n) => n?.type === 'level');
}

/** EditRecords stored in the scene, or null when the scene has no node to hold them. */
export function readEditHistory(nodes: Record<string, unknown> = useScene.getState().nodes): EditRecord[] | null {
  const host = editHistoryHost(nodes);
  if (!host) return null;
  const history = (host.metadata as { editHistory?: EditRecord[] } | undefined)?.editHistory;
  return Array.isArray(history) ? history : [];
}

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
    // Read type-specific fields from a plain-record view; Pascal's union types vary by node type.
    const f = node as unknown as NodeFields;
    const parentId = (f.parentId as string | null | undefined) || null;

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
          elevation: (f.elevation as number | undefined) ?? 0,
          height: (f.height as number | undefined) ?? 3.0,
        });
        if (!activeLevelId) activeLevelId = node.id;
        break;

      case 'zone':
        zones.push({
          id: node.id,
          name: node.name || 'Zone',
          category: f.category as string | undefined,
          levelId: parentId,
          polygon: f.polygon,
        });
        break;

      case 'wall':
        walls.push({
          id: node.id,
          name: node.name || 'Wall',
          start: (f.start as [number, number] | undefined) || [0, 0],
          end: (f.end as [number, number] | undefined) || [1, 0],
          height: (f.height as number | undefined) ?? 3.0,
          thickness: (f.thickness as number | undefined) ?? 0.2,
          levelId: parentId,
        });
        break;

      case 'item': {
        const dims = node.asset?.dimensions || (f.dimensions as [number, number, number] | undefined) || [0.8, 0.8, 0.8];
        const src = node.asset?.src || (f.modelUrl as string | undefined);
        items.push({
          id: node.id,
          name: node.name || 'Item',
          category: (f.category as string | undefined) || node.asset?.category,
          position: node.position || [0, 0, 0],
          rotation: node.rotation || [0, 0, 0],
          dimensions: dims,
          modelUrl: src,
          levelId: parentId,
        });
        break;
      }

      case 'scan': {
        const metadata = scanMetadata(node);
        scans.push({
          id: node.id,
          name: node.name || 'Scan',
          url: f.url as string | undefined,
          visible: (f.visible as boolean | undefined) ?? true,
          opacity: (f.opacity as number | undefined) ?? 100,
          exclusionBoxes: (metadata.exclusionBoxes as unknown as SplatExclusionBox[] | undefined) || [],
          maskRegions: metadata.maskRegions || [],
        });
        break;
      }
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
  const deletes: AnyNodeId[] = [];
  // Several actions may patch one node (e.g. two masks on the scan node): merge them so each
  // action sees the earlier ones and the last patch does not drop the others.
  const patches = new Map<string, Record<string, unknown>>();
  const patch = (id: string, data: Record<string, unknown>) => patches.set(id, { ...patches.get(id), ...data });
  const current = <T extends AnyNode>(node: T): T => ({ ...node, ...patches.get(node.id) }) as T;
  const scanNode = (id?: string) => {
    const found = id ? scene.nodes[asNodeId(id)] : findScanNode(scene.nodes);
    return found?.type === 'scan' ? current(found) : undefined;
  };

  for (const act of actions) {
    switch (act.action) {
      case 'create_node':
        creates.push({
          node: act.node,
          parentId: act.parentId as AnyNodeId | undefined,
        });
        break;

      case 'update_transform': {
        const data: Record<string, unknown> = {};
        if (act.position) data.position = act.position;
        if (act.rotation) data.rotation = act.rotation;
        if (act.scale) data.scale = act.scale;
        if (act.dimensions) data.dimensions = act.dimensions;
        patch(act.nodeId, data);
        break;
      }

      case 'replace_asset': {
        const found = scene.nodes[asNodeId(act.nodeId)];
        if (!found || found.type !== 'item') break;
        const existingNode: ItemNode = current(found);
        const legacyCategory = (existingNode as unknown as NodeFields).category as string | undefined;
        const dims = act.dimensions || existingNode.asset?.dimensions || [1, 1, 1];
        const mask = createMaskRegionForNode(existingNode);
        const replaced = replaceItemAsset(existingNode, {
          id: existingNode.asset?.id,
          name: act.newName || existingNode.asset?.name || existingNode.name || 'Item',
          category: existingNode.asset?.category || legacyCategory || 'item',
          src: act.newModelUrl,
          dimensions: dims,
        });
        patch(act.nodeId, {
          ...replaced,
          metadata: {
            ...(existingNode.metadata || {}),
            maskRegionId: mask.id,
          },
        });
        const targetScan = scanNode();
        if (targetScan) {
          const metadata = scanMetadata(targetScan);
          const currentMasks: MaskRegion[] = metadata.maskRegions || [];
          patch(targetScan.id, {
            metadata: {
              ...metadata,
              maskRegions: [...currentMasks.filter((m) => m.itemId !== existingNode.id), mask],
            },
          });
        }
        break;
      }

      case 'delete_node':
        deletes.push(act.nodeId as AnyNodeId);
        break;

      case 'add_splat_exclusion': {
        // Find target scan node (default to first scan if not specified)
        const target = scanNode(act.scanNodeId);
        if (target) {
          const metadata = scanMetadata(target);
          const currentBoxes = (metadata.exclusionBoxes as unknown as SplatExclusionBox[] | undefined) || [];
          patch(target.id, {
            metadata: {
              ...metadata,
              exclusionBoxes: [...currentBoxes, act.box],
            },
          });
        }
        break;
      }

      case 'add_mask_region': {
        const target = scanNode();
        if (!target) break;
        const metadata = scanMetadata(target);
        patch(target.id, {
          metadata: { ...metadata, maskRegions: [...(metadata.maskRegions || []).filter((m) => m.id !== act.mask.id), act.mask] },
        });
        break;
      }

      case 'append_edit_record': {
        const host = editHistoryHost(scene.nodes);
        if (!host) break;
        const metadata = { ...(host.metadata as Record<string, unknown> | undefined), ...(patches.get(host.id)?.metadata as Record<string, unknown> | undefined) };
        const history = Array.isArray(metadata.editHistory) ? (metadata.editHistory as EditRecord[]) : [];
        patch(host.id, { metadata: { ...metadata, editHistory: [...history, act.record] } });
        break;
      }
    }
  }

  const updates = [...patches].map(([id, data]) => ({ id: asNodeId(id), data: asNodeData(data) }));
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
  useScene.temporal.getState().undo();
}

/**
 * Triggers a 1-step redo via Zundo temporal store.
 */
export function redoSceneAction(): void {
  useScene.temporal.getState().redo();
}
