import { useScene, type AnyNode, type AnyNodeId } from '@pascal-app/core';
import type { MaskRegion } from '@/lib/contracts';
import type { Matrix4 } from '@/lib/contracts/primitives';

export type ScanNode = Extract<AnyNode, { type: 'scan' }>;
export type ItemNode = Extract<AnyNode, { type: 'item' }>;

/** Exclusion box stored on a scan node (SuperSplat-style point-in-box crop). */
export interface SplatExclusionBoxMetadata {
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  [key: string]: unknown;
}

/** SpaceGen's keys inside a Pascal scan node's free-form `metadata` record. */
export interface ScanMetadata {
  format?: string;
  scanToScene?: Matrix4;
  maskRegions?: MaskRegion[];
  exclusionBoxes?: SplatExclusionBoxMetadata[];
  meshUrl?: string;
  proxyMeshUrl?: string;
  [key: string]: unknown;
}

/** A node viewed as a plain record, for reading fields that only some node types carry. */
export type NodeFields = Record<string, unknown> & { id: string; type: string };

/** Partial node data as SpaceGen writes it; Pascal validates the shape per node type. */
export type NodeData = Record<string, unknown>;

export const asNodeId = (id: string) => id as AnyNodeId;
export const asNodeData = (data: NodeData) => data as Partial<AnyNode>;
export const asNode = (node: NodeData) => node as unknown as AnyNode;

export function nodeRecord(): Record<string, NodeFields | undefined> {
  return useScene.getState().nodes as unknown as Record<string, NodeFields | undefined>;
}

export function findScanNode(nodes: Record<string, AnyNode | undefined> = useScene.getState().nodes): ScanNode | undefined {
  return Object.values(nodes).find((node): node is ScanNode => node?.type === 'scan');
}

export function scanMetadata(node: { metadata?: unknown } | null | undefined): ScanMetadata {
  return (node?.metadata ?? {}) as ScanMetadata;
}

export function updateNodeData(id: string, data: NodeData): void {
  useScene.getState().updateNode(asNodeId(id), asNodeData(data));
}
