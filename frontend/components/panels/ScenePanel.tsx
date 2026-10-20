'use client';

import React, { useState } from 'react';
import { useScene } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { useSpaceGenStore } from '@/lib/store';
import {
  Layers,
  Box,
  BoxSelect,
  Grid3X3,
  Shapes,
  Eye,
  EyeOff,
  Trash2,
  ChevronRight,
  Maximize2,
  Sliders,
  DoorOpen,
  Frame,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function ScenePanel() {
  const nodes = useScene((state) => state.nodes);
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const setSelection = useViewer((state) => state.setSelection);
  const selectedObjectId = useSpaceGenStore((state) => state.selectedObjectId);
  const setSelectedObjectId = useSpaceGenStore((state) => state.setSelectedObjectId);

  const activeId = selectedIds[0] || selectedObjectId || null;
  const selectedNode = activeId ? (nodes as Record<string, any>)[activeId] : null;

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
    setSelection({ selectedIds: [id as any] });
    setSelectedObjectId(id);
  };

  const handleUpdateNodeProp = (key: string, value: any) => {
    if (!activeId) return;
    (useScene.getState().updateNode as any)(activeId, {
      [key]: value,
    });
  };

  const handleDeleteNode = () => {
    if (!activeId) return;
    (useScene.getState().deleteNode as any)(activeId);
    setSelection({ selectedIds: [] });
    setSelectedObjectId(null);
  };

  // Group nodes by category
  const walls: any[] = [];
  const items: any[] = [];
  const scans: any[] = [];
  const zones: any[] = [];
  const slabs: any[] = [];

  for (const node of Object.values(nodes)) {
    if (!node) continue;
    switch (node.type) {
      case 'wall':
        walls.push(node);
        break;
      case 'item':
        items.push(node);
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
                          (useScene.getState().updateNode as any)(scan.id, {
                            visible: !scan.visible,
                          });
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
                    value={selectedNode.position?.[0] ?? 0}
                    onChange={(e) =>
                      handleUpdateNodeProp('position', [
                        parseFloat(e.target.value) || 0,
                        selectedNode.position?.[1] ?? 0,
                        selectedNode.position?.[2] ?? 0,
                      ])
                    }
                    className="w-full bg-surface border border-border rounded px-1.5 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted block">Pos Y (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.position?.[1] ?? 0}
                    onChange={(e) =>
                      handleUpdateNodeProp('position', [
                        selectedNode.position?.[0] ?? 0,
                        parseFloat(e.target.value) || 0,
                        selectedNode.position?.[2] ?? 0,
                      ])
                    }
                    className="w-full bg-surface border border-border rounded px-1.5 py-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted block">Pos Z (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.position?.[2] ?? 0}
                    onChange={(e) =>
                      handleUpdateNodeProp('position', [
                        selectedNode.position?.[0] ?? 0,
                        selectedNode.position?.[1] ?? 0,
                        parseFloat(e.target.value) || 0,
                      ])
                    }
                    className="w-full bg-surface border border-border rounded px-1.5 py-1 text-xs font-mono"
                  />
                </div>
              </div>

              {selectedNode.dimensions && (
                <div className="flex items-center gap-2 text-[10px] text-text-muted font-mono bg-surface p-1.5 rounded border border-border/50">
                  <Maximize2 size={11} className="text-text-secondary" />
                  <span>
                    Size: {selectedNode.dimensions[0]}m × {selectedNode.dimensions[1]}m × {selectedNode.dimensions[2]}m
                  </span>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ScenePanel;
