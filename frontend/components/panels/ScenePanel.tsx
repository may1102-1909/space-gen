'use client';

import React, { useRef, useState } from 'react';
import { useScene } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { useSpaceGenStore } from '@/lib/store';
import {
  Layers,
  Box,
  BoxSelect,
  Shapes,
  Eye,
  EyeOff,
  Trash2,
  ChevronRight,
  Maximize2,
  Sliders,
  Plus,
  Upload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import type { FurnitureItem } from '@/lib/types';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createItemNode, normalizeGlbBounds, fetchCatalogItems, type ItemNode } from '@/lib/pascal/itemEditing';
import { asNode, asNodeId, updateNodeData } from '@/lib/pascal/nodes';
import { isProposalGhost } from '@/lib/pascal/proposalPreview';
import { ERROR_TABLE, formatDimensions, scaleSourceOf } from '@/lib/measurement/accuracy';
import {
  replaceItemWithMask,
  toggleMaskGhostMode,
  updateMaskRegion,
  resizeMaskRegion,
  removeMaskRegion,
} from '@/lib/splat/splatMasking';
import type { AssetRef, MaskRegion } from '@/lib/contracts';
import { uploadProjectAsset, uploadedAssetRef } from '@/lib/projects/api';

/** The node fields this panel reads; Pascal nodes are a union, so all are optional here. */
interface PanelNode {
  id: string;
  type: string;
  name?: string;
  visible?: boolean;
  category?: string;
  position?: [number, number, number];
  dimensions?: [number, number, number];
  asset?: { dimensions?: [number, number, number] };
  height?: number;
  thickness?: number;
  opacity?: number;
  metadata?: { maskRegionId?: string; maskRegions?: MaskRegion[]; exclusionBoxes?: unknown[]; scaleSource?: unknown };
}

interface ScenePanelProps {
  /** Project that owns uploaded assets; uploads are disabled without one. */
  projectId?: string;
  onAssetUploaded?: (asset: AssetRef) => void;
}

export function ScenePanel({ projectId, onAssetUploaded }: ScenePanelProps = {}) {
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, PanelNode | undefined>;
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const setSelection = useViewer((state) => state.setSelection);
  const selectedObjectId = useSpaceGenStore((state) => state.selectedObjectId);
  const setSelectedObjectId = useSpaceGenStore((state) => state.setSelectedObjectId);
  const [catalog, setCatalog] = useState<FurnitureItem[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const activeId = selectedIds[0] || selectedObjectId || null;
  const selectedNode = activeId ? nodes[activeId] ?? null : null;
  const scanNode = Object.values(nodes).find((n) => n?.type === 'scan');
  const maskRegions: MaskRegion[] = scanNode?.metadata?.maskRegions || [];
  const scaleSource = scaleSourceOf(scanNode);
  const estimateTitle = `Estimated from the ${ERROR_TABLE.basis} accuracy benchmark for scale source "${scaleSource}"`;
  const linkedMask = maskRegions.find(
    (m) => m.itemId === activeId || m.id === selectedNode?.metadata?.maskRegionId
  );
  const [positionDraft, setPositionDraft] = useState<[string, string, string]>(['0', '0', '0']);

  // Re-seed the inputs when the selection or its stored position changes (state adjusted during
  // render, per React's guidance, rather than in an effect).
  const selectedPosition = selectedNode?.type === 'item' ? selectedNode.position || [0, 0, 0] : null;
  const positionKey = selectedPosition ? `${activeId}:${selectedPosition.join(',')}` : null;
  const [draftKey, setDraftKey] = useState<string | null>(null);
  if (positionKey !== draftKey) {
    setDraftKey(positionKey);
    if (selectedPosition) setPositionDraft(selectedPosition.map((value) => String(value)) as [string, string, string]);
  }

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['items', 'walls', 'scans', 'zones'])
  );

  const toggleSection = (sec: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec);
      else next.add(sec);
      return next;
    });
  };

  const handleSelectNode = (id: string) => {
    setSelection({ selectedIds: [asNodeId(id)] });
    setSelectedObjectId(id);
  };

  const handleUpdateNodeProp = (key: string, value: unknown) => {
    if (!activeId) return;
    updateNodeData(activeId, { [key]: value });
  };

  const handleDeleteNode = () => {
    if (!activeId) return;
    useScene.getState().deleteNode(asNodeId(activeId));
    setSelection({ selectedIds: [] });
    setSelectedObjectId(null);
  };

  const commitAsset = (asset: { id?: string; name: string; category: string; src: string; dimensions: [number, number, number]; source?: 'library' | 'mine' }) => {
    const scene = useScene.getState();
    const resolvedSrc = (typeof window !== 'undefined' && asset.src.startsWith('/'))
      ? `${window.location.origin}${asset.src}`
      : asset.src;
    const assetPayload = { ...asset, src: resolvedSrc };

    const currentActiveId = activeId || useViewer.getState().selection.selectedIds[0] || useSpaceGenStore.getState().selectedObjectId;
    const currentSelectedNode = currentActiveId ? scene.nodes[asNodeId(currentActiveId)] : undefined;

    if (currentSelectedNode?.type === 'item') {
      replaceItemWithMask(currentSelectedNode as ItemNode, assetPayload);
    } else {
      const levelId = Object.values(scene.nodes).find((node) => node?.type === 'level')?.id;
      const node = { ...createItemNode(assetPayload), parentId: levelId || null };
      scene.applyNodeChanges({ create: [{ node: asNode({ ...node }), parentId: levelId }] });
      setSelectedObjectId(node.id);
      setSelection({ selectedIds: [node.id] });
    }
    setCatalogOpen(false);
  };

  const openCatalog = async () => {
    setAssetError(null);
    try {
      const items = catalog.length ? catalog : await fetchCatalogItems();
      setCatalog(items);
      setCatalogOpen(true);
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Catalog could not be loaded');
    }
  };

  const uploadGlb = async (file?: File) => {
    if (!file) return;
    setAssetError(null);
    if (!projectId) {
      setAssetError('Open a saved project to upload GLB assets.');
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      const gltf = await new GLTFLoader().loadAsync(url);
      const bounds = new (await import('three')).Box3().setFromObject(gltf.scene);
      const min = bounds.min.toArray() as [number, number, number];
      const max = bounds.max.toArray() as [number, number, number];
      const measured = normalizeGlbBounds(min, max);
      gltf.scene.scale.set(measured.unitScale, measured.unitScale, measured.unitScale);
      gltf.scene.position.set(
        measured.offset[0] * measured.unitScale,
        measured.offset[1] * measured.unitScale,
        measured.offset[2] * measured.unitScale
      );
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const normalizedBlob = await new Promise<Blob>((resolve, reject) => new GLTFExporter().parse(gltf.scene, (result) => {
        if (result instanceof ArrayBuffer) resolve(new Blob([result], { type: 'model/gltf-binary' }));
        else reject(new Error('GLB normalization did not produce a binary GLB'));
      }, reject, { binary: true }));
      URL.revokeObjectURL(url);
      const name = file.name.replace(/\.glb$/i, '');
      // Persist the normalized GLB server-side; a blob: URL would not survive a reload.
      const uploaded = await uploadProjectAsset(projectId, normalizedBlob, `${name}.glb`);
      const assetRef = uploadedAssetRef(uploaded, name, measured.dimensions);
      onAssetUploaded?.(assetRef);
      commitAsset({ id: assetRef.id, name, category: 'custom', src: uploaded.url, dimensions: measured.dimensions, source: 'mine' });
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'GLB could not be measured');
    }
  };

  // Group nodes by category
  const walls: PanelNode[] = [];
  const items: PanelNode[] = [];
  const scans: PanelNode[] = [];
  const zones: PanelNode[] = [];
  const slabs: PanelNode[] = [];

  for (const node of Object.values(nodes)) {
    if (!node) continue;
    switch (node.type) {
      case 'wall':
        walls.push(node);
        break;
      case 'item':
        // Proposal ghosts are previews; the chat card owns them.
        if (!isProposalGhost(node)) items.push(node);
        break;
      case 'scan':
        scans.push(node);
        break;
      case 'zone':
        zones.push(node);
        break;
      case 'slab':
        slabs.push(node);
        break;
    }
  }

  const totalCount = Object.keys(nodes).length;

  return (
    <div className="flex flex-col h-full overflow-hidden text-text-primary bg-surface select-none">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-surface-elevated flex items-center justify-center border border-border">
            <Layers size={13} className="text-text-secondary" />
          </div>
          <div>
            <h2 className="font-semibold text-xs leading-tight">Scene Hierarchy</h2>
            <p className="text-[10px] text-text-muted leading-tight font-mono">
              {totalCount} Pascal nodes registered
            </p>
          </div>
        </div>
      </div>

      <div className="p-2 border-b border-border/60 space-y-2">
        <div className="flex gap-1.5">
          <button onClick={openCatalog} className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-accent/15 px-2 py-1.5 text-[11px] text-accent-light hover:bg-accent/25">
            <Plus size={12} /> {selectedNode?.type === 'item' ? 'Replace / Add Catalog Item' : 'Add Catalog Item'}
          </button>
          <button onClick={() => uploadRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] hover:bg-surface-elevated">
            <Upload size={12} /> GLB
          </button>
          <input ref={uploadRef} type="file" accept=".glb,model/gltf-binary" className="hidden" aria-label="Upload GLB" onChange={(event) => { void uploadGlb(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        {assetError && <p role="alert" className="text-[10px] text-red-400">{assetError}</p>}
        {catalogOpen && <div className="max-h-32 overflow-y-auto rounded border border-border">
          {catalog.map((item) => <button key={item.id} onClick={() => commitAsset({ id: item.id, name: item.name, category: item.category, src: api.normalizeModelUrl(item.url) || item.url, dimensions: [item.dimensions.width_m, item.dimensions.height_m, item.dimensions.depth_m || item.dimensions.width_m] })} className="block w-full px-2 py-1.5 text-left text-[11px] hover:bg-surface-elevated">{item.name} · {item.dimensions.width_m} × {item.dimensions.height_m} × {item.dimensions.depth_m || item.dimensions.width_m} m</button>)}
        </div>}
      </div>

      {/* Hierarchical Node Tree */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-border/20 text-xs">
        {/* 1. Furniture Items Section */}
        {items.length > 0 && (
          <div className="pt-1.5 first:pt-0">
            <button
              onClick={() => toggleSection('items')}
              className="w-full flex items-center gap-2 px-2 py-1 font-semibold text-[11px] text-text-muted uppercase tracking-wider hover:text-text-secondary rounded-md hover:bg-surface-elevated/40"
            >
              <ChevronRight
                size={12}
                className={`transition-transform duration-200 ${
                  expandedSections.has('items') ? 'rotate-90' : ''
                }`}
              />
              <BoxSelect size={13} className="text-amber-400" />
              <span>Furniture ({items.length})</span>
            </button>

            <AnimatePresence>
              {expandedSections.has('items') && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="ml-3 mt-1 space-y-0.5 overflow-hidden"
                >
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelectNode(item.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all ${
                        activeId === item.id
                          ? 'bg-accent/20 text-accent-light border border-accent/30 font-medium'
                          : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <span className="truncate">{item.name || item.id}</span>
                      <span className="text-[9px] font-mono text-text-muted uppercase px-1 rounded bg-surface-elevated">
                        {item.category || 'prop'}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 2. Perimeter Walls Section */}
        {walls.length > 0 && (
          <div className="pt-1.5">
            <button
              onClick={() => toggleSection('walls')}
              className="w-full flex items-center gap-2 px-2 py-1 font-semibold text-[11px] text-text-muted uppercase tracking-wider hover:text-text-secondary rounded-md hover:bg-surface-elevated/40"
            >
              <ChevronRight
                size={12}
                className={`transition-transform duration-200 ${
                  expandedSections.has('walls') ? 'rotate-90' : ''
                }`}
              />
              <Box size={13} className="text-blue-400" />
              <span>Walls ({walls.length})</span>
            </button>

            <AnimatePresence>
              {expandedSections.has('walls') && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="ml-3 mt-1 space-y-0.5 overflow-hidden"
                >
                  {walls.map((wall) => (
                    <button
                      key={wall.id}
                      onClick={() => handleSelectNode(wall.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all ${
                        activeId === wall.id
                          ? 'bg-accent/20 text-accent-light border border-accent/30 font-medium'
                          : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <span className="truncate">{wall.name || wall.id}</span>
                      <span className="text-[9px] font-mono text-text-muted">
                        h: {wall.height || 3}m
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 3. Scan Overlays Section */}
        {scans.length > 0 && (
          <div className="pt-1.5">
            <button
              onClick={() => toggleSection('scans')}
              className="w-full flex items-center gap-2 px-2 py-1 font-semibold text-[11px] text-text-muted uppercase tracking-wider hover:text-text-secondary rounded-md hover:bg-surface-elevated/40"
            >
              <ChevronRight
                size={12}
                className={`transition-transform duration-200 ${
                  expandedSections.has('scans') ? 'rotate-90' : ''
                }`}
              />
              <Eye size={13} className="text-emerald-400" />
              <span>Scans ({scans.length})</span>
            </button>

            <AnimatePresence>
              {expandedSections.has('scans') && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="ml-3 mt-1 space-y-0.5 overflow-hidden"
                >
                  {scans.map((scan) => (
                    <div
                      key={scan.id}
                      onClick={() => handleSelectNode(scan.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-all ${
                        activeId === scan.id
                          ? 'bg-accent/20 text-accent-light border border-accent/30 font-medium'
                          : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <span className="truncate">{scan.name || scan.id}</span>
                      <button
                        title="Toggle visibility"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateNodeData(scan.id, { visible: !scan.visible });
                        }}
                        className="p-1 hover:text-text-primary"
                      >
                        {scan.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-text-muted" />}
                      </button>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 4. Functional Zones & Slabs */}
        {(zones.length > 0 || slabs.length > 0) && (
          <div className="pt-1.5">
            <button
              onClick={() => toggleSection('zones')}
              className="w-full flex items-center gap-2 px-2 py-1 font-semibold text-[11px] text-text-muted uppercase tracking-wider hover:text-text-secondary rounded-md hover:bg-surface-elevated/40"
            >
              <ChevronRight
                size={12}
                className={`transition-transform duration-200 ${
                  expandedSections.has('zones') ? 'rotate-90' : ''
                }`}
              />
              <Shapes size={13} className="text-purple-400" />
              <span>Floors & Zones ({zones.length + slabs.length})</span>
            </button>

            <AnimatePresence>
              {expandedSections.has('zones') && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="ml-3 mt-1 space-y-0.5 overflow-hidden"
                >
                  {slabs.map((slab) => (
                    <button
                      key={slab.id}
                      onClick={() => handleSelectNode(slab.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all ${
                        activeId === slab.id
                          ? 'bg-accent/20 text-accent-light border border-accent/30 font-medium'
                          : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <span className="truncate">{slab.name || slab.id}</span>
                      <span className="text-[9px] font-mono text-text-muted">slab</span>
                    </button>
                  ))}
                  {zones.map((zone) => (
                    <button
                      key={zone.id}
                      onClick={() => handleSelectNode(zone.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all ${
                        activeId === zone.id
                          ? 'bg-accent/20 text-accent-light border border-accent/30 font-medium'
                          : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <span className="truncate">{zone.name || zone.id}</span>
                      <span className="text-[9px] font-mono text-purple-300">
                        {zone.category || 'zone'}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Live Node Inspector Drawer */}
      {selectedNode && (
        <div className="border-t border-border bg-surface-elevated/40 p-3 shrink-0 flex flex-col gap-2.5 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-text-primary truncate">
              <Sliders size={13} className="text-accent" />
              <span className="truncate">{selectedNode.name || selectedNode.id}</span>
            </div>
            <button
              title="Delete node"
              onClick={handleDeleteNode}
              className="text-text-muted hover:text-red-400 p-1 rounded hover:bg-surface-elevated transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Node Specific Controls */}
          {selectedNode.type === 'item' && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <label className="text-[10px] text-text-muted block">Pos X (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Pos X (m)"
                    value={positionDraft[0]}
                    onChange={(e) => setPositionDraft([e.target.value, positionDraft[1], positionDraft[2]])}
                    onBlur={() => handleUpdateNodeProp('position', [parseFloat(positionDraft[0]) || 0, selectedNode.position?.[1] ?? 0, selectedNode.position?.[2] ?? 0])}
                    className="w-full bg-surface border border-border rounded px-1.5 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted block">Pos Y (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Pos Y (m)"
                    value={positionDraft[1]}
                    onChange={(e) => setPositionDraft([positionDraft[0], e.target.value, positionDraft[2]])}
                    onBlur={() => handleUpdateNodeProp('position', [selectedNode.position?.[0] ?? 0, Math.max(0, parseFloat(positionDraft[1]) || 0), selectedNode.position?.[2] ?? 0])}
                    className="w-full bg-surface border border-border rounded px-1.5 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted block">Pos Z (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Pos Z (m)"
                    value={positionDraft[2]}
                    onChange={(e) => setPositionDraft([positionDraft[0], positionDraft[1], e.target.value])}
                    onBlur={() => handleUpdateNodeProp('position', [selectedNode.position?.[0] ?? 0, selectedNode.position?.[1] ?? 0, parseFloat(positionDraft[2]) || 0])}
                    className="w-full bg-surface border border-border rounded px-1.5 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              {(selectedNode.asset?.dimensions || selectedNode.dimensions) && (
                <div className="flex items-center gap-2 text-[10px] text-text-muted font-mono bg-surface p-1.5 rounded border border-border/50">
                  <Maximize2 size={11} className="text-text-secondary" />
                  {selectedNode.asset?.dimensions ? (
                    // Catalog/asset dimensions are product specs, not scan measurements.
                    <span>
                      Size: {selectedNode.asset.dimensions[0]}m × {selectedNode.asset.dimensions[1]}m × {selectedNode.asset.dimensions[2]}m
                    </span>
                  ) : selectedNode.dimensions && (
                    <span title={estimateTitle}>Size: {formatDimensions(selectedNode.dimensions, scaleSource)}</span>
                  )}
                </div>
              )}

              {/* Linked Splat Mask Controls */}
              {linkedMask && scanNode && (
                <div className="mt-2 pt-2 border-t border-border/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-accent-light flex items-center gap-1.5">
                      <BoxSelect size={12} /> Splat Mask
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${linkedMask.ghost ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {linkedMask.ghost ? 'Ghost (25%)' : 'Masked (0%)'}
                    </span>
                  </div>

                  {/* Toggle Ghost Mode */}
                  <button
                    type="button"
                    aria-label="Toggle Ghost Mode"
                    onClick={() => toggleMaskGhostMode(scanNode.id, linkedMask.id)}
                    className={`w-full py-1.5 px-2 rounded text-[11px] font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                      linkedMask.ghost
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                        : 'bg-surface-elevated border-border text-text-secondary hover:text-text-primary hover:border-accent'
                    }`}
                  >
                    <Eye size={12} />
                    <span>{linkedMask.ghost ? 'Show Original: On (Ghost Mode)' : 'Show Original (Ghost Mode)'}</span>
                  </button>

                  {/* Mask Resize Controls */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-text-muted block">Mask Size (m)</label>
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <span className="text-[9px] text-text-muted block">W</span>
                        <input
                          type="number"
                          step="0.05"
                          aria-label="Mask Width (m)"
                          value={linkedMask.obb.size[0]}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.1;
                            resizeMaskRegion(scanNode.id, linkedMask.id, [val, linkedMask.obb.size[1], linkedMask.obb.size[2]]);
                          }}
                          className="w-full bg-surface border border-border rounded px-1 py-0.5 text-[11px] font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-text-muted block">H</span>
                        <input
                          type="number"
                          step="0.05"
                          aria-label="Mask Height (m)"
                          value={linkedMask.obb.size[1]}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.1;
                            resizeMaskRegion(scanNode.id, linkedMask.id, [linkedMask.obb.size[0], val, linkedMask.obb.size[2]]);
                          }}
                          className="w-full bg-surface border border-border rounded px-1 py-0.5 text-[11px] font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-text-muted block">D</span>
                        <input
                          type="number"
                          step="0.05"
                          aria-label="Mask Depth (m)"
                          value={linkedMask.obb.size[2]}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.1;
                            resizeMaskRegion(scanNode.id, linkedMask.id, [linkedMask.obb.size[0], linkedMask.obb.size[1], val]);
                          }}
                          className="w-full bg-surface border border-border rounded px-1 py-0.5 text-[11px] font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Mask Feather Falloff Control */}
                  <div className="flex items-center justify-between text-[10px] text-text-muted">
                    <span>Feather Falloff:</span>
                    <input
                      type="range"
                      min="0"
                      max="0.2"
                      step="0.01"
                      aria-label="Mask Feather (m)"
                      value={linkedMask.feather ?? 0.05}
                      onChange={(e) => {
                        updateMaskRegion(scanNode.id, linkedMask.id, { feather: parseFloat(e.target.value) || 0 });
                      }}
                      className="w-20 h-1.5 bg-surface rounded accent-accent"
                    />
                    <span className="font-mono text-text-primary text-[10px]">{(linkedMask.feather ?? 0.05).toFixed(2)}m</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedNode.type === 'wall' && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-text-muted text-[11px]">
                <span>Thickness:</span>
                <span className="font-mono text-text-primary">{selectedNode.thickness || 0.2}m</span>
              </div>
              <div className="flex justify-between items-center text-text-muted text-[11px]">
                <span>Height:</span>
                <span className="font-mono text-text-primary">{selectedNode.height || 3.0}m</span>
              </div>
            </div>
          )}

          {selectedNode.type === 'scan' && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-text-muted text-[11px]">
                <span>Opacity:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={selectedNode.opacity ?? 100}
                  onChange={(e) => handleUpdateNodeProp('opacity', parseInt(e.target.value, 10))}
                  className="w-24 h-1.5 bg-surface rounded accent-accent"
                />
              </div>
              <div className="flex justify-between items-center text-text-muted text-[11px]">
                <span>Exclusion Boxes:</span>
                <span className="font-mono text-text-primary">
                  {selectedNode.metadata?.exclusionBoxes?.length || 0}
                </span>
              </div>

              {/* Mask Regions List */}
              <div className="pt-2 border-t border-border/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-secondary">
                    Mask Regions ({selectedNode.metadata?.maskRegions?.length || 0})
                  </span>
                </div>
                {((selectedNode.metadata?.maskRegions || []) as MaskRegion[]).map((mask) => (
                  <div key={mask.id} className="p-2 rounded-lg bg-surface border border-border/60 text-[10px] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-text-primary truncate">{mask.id}</span>
                      <button
                        type="button"
                        aria-label={`Toggle Ghost ${mask.id}`}
                        onClick={() => toggleMaskGhostMode(selectedNode.id, mask.id)}
                        className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                          mask.ghost
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-surface-elevated text-text-muted border-border hover:text-text-primary'
                        }`}
                      >
                        {mask.ghost ? 'Ghost (25%)' : 'Masked (0%)'}
                      </button>
                    </div>
                    <div className="text-[9px] text-text-muted font-mono flex items-center justify-between">
                      <span title={estimateTitle}>Size: {formatDimensions(mask.obb.size, scaleSource)}</span>
                      <button
                        type="button"
                        title="Delete mask"
                        onClick={() => removeMaskRegion(selectedNode.id, mask.id)}
                        className="text-text-muted hover:text-red-400 p-0.5 rounded"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ScenePanel;
