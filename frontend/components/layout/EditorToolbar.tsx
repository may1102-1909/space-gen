'use client';

import React, { useEffect } from 'react';
import { useViewer, type WallMode } from '@pascal-app/viewer';
import { useScene } from '@pascal-app/core';
import { useSpaceGenStore } from '@/lib/store';
import { undoSceneAction, redoSceneAction } from '@/lib/pascal/sceneBridge';
import { useEditor } from '@/lib/pascal/pascalEditor';
import { armArchitecturalTool, type ArchitecturalTool } from '@/components/viewer/ArchitecturalTools';
import {
  MousePointer,
  Square,
  Grid3X3,
  Shapes,
  Armchair,
  Crop,
  Eraser,
  Eye,
  EyeOff,
  Layers,
  Scissors,
  Undo2,
  Redo2,
  Sparkles,
  Crosshair,
  DoorOpen,
  AppWindow,
  Ruler,
} from 'lucide-react';

const PASCAL_TOOLS: Array<{ tool: ArchitecturalTool; label: string; title: string; Icon: typeof Square }> = [
  { tool: 'wall', label: 'Wall', title: 'Draw a wall, snapped to scan corners and wall faces', Icon: Square },
  { tool: 'slab', label: 'Slab', title: 'Draw a floor slab', Icon: Grid3X3 },
  { tool: 'door', label: 'Door', title: 'Place a door on a wall', Icon: DoorOpen },
  { tool: 'window', label: 'Window', title: 'Place a window on a wall', Icon: AppWindow },
  { tool: 'measurement', label: 'Measure', title: 'Measure a distance (scan estimate)', Icon: Ruler },
];

export type ActiveTool =
  | 'select'
  | 'wall'
  | 'slab'
  | 'zone'
  | 'item'
  | 'splat-crop'
  | 'splat-eraser';

interface EditorToolbarProps {
  activeTool: ActiveTool;
  onSelectTool: (tool: ActiveTool) => void;
  onOpenConvertModal?: () => void;
  isAligningScan?: boolean;
  onToggleScanAlignment?: () => void;
}

export function EditorToolbar({ activeTool, onSelectTool, onOpenConvertModal, isAligningScan, onToggleScanAlignment }: EditorToolbarProps) {
  const levelMode = useViewer((state) => state.levelMode);
  const setLevelMode = useViewer((state) => state.setLevelMode);
  const wallMode = useViewer((state) => state.wallMode);
  const setWallMode = useViewer((state) => state.setWallMode);
  const showScans = useViewer((state) => state.showScans);
  const setShowScans = useViewer((state) => state.setShowScans);

  const pascalMode = useEditor((state) => state.mode);
  const pascalTool = useEditor((state) => state.tool);
  const activePascalTool = pascalMode === 'build' ? pascalTool : null;
  const selectTool = (tool: ActiveTool) => {
    armArchitecturalTool(null);
    onSelectTool(tool);
  };

  const canUndo = (useScene as any).temporal?.getState?.()?.pastStates?.length > 0;
  const canRedo = (useScene as any).temporal?.getState?.()?.futureStates?.length > 0;

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName || '')) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoSceneAction();
        else undoSceneAction();
      } else if (key === 'y') {
        event.preventDefault();
        redoSceneAction();
      }
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, []);

  const cycleLevelMode = () => {
    if (levelMode === 'stacked') setLevelMode('exploded');
    else if (levelMode === 'exploded') setLevelMode('solo');
    else setLevelMode('stacked');
  };

  const toggleWallCutaway = () => {
    setWallMode(wallMode === 'cutaway' ? 'up' : 'cutaway');
  };

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-wrap justify-center w-max max-w-[calc(100%-1rem)] items-center gap-1.5 p-1.5 rounded-2xl bg-surface/90 border border-border backdrop-blur-xl shadow-2xl text-text-primary">
      {/* 1. Architectural CAD Tools */}
      <div className="flex items-center gap-1 bg-surface-elevated/40 p-1 rounded-xl border border-border/50">
        <button
          title="Select & Transform Tool (V)"
          onClick={() => selectTool('select')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTool === 'select' && !activePascalTool
              ? 'bg-accent text-white shadow-md shadow-accent/25'
              : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          <MousePointer size={14} />
          <span>Select</span>
        </button>

        {PASCAL_TOOLS.map(({ tool, label, title, Icon }) => (
          <button
            key={tool}
            title={title}
            aria-label={label}
            aria-pressed={activePascalTool === tool}
            onClick={() => armArchitecturalTool(activePascalTool === tool ? null : tool)}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activePascalTool === tool
                ? 'bg-accent text-white shadow-md shadow-accent/25'
                : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon size={14} />
          </button>
        ))}

        <button
          title="Zone Definition Tool (Z)"
          onClick={() => selectTool('zone')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTool === 'zone'
              ? 'bg-accent text-white shadow-md shadow-accent/25'
              : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          <Shapes size={14} />
          <span>Zone</span>
        </button>

        <button
          title="Furniture & Door/Window Placement (I)"
          onClick={() => selectTool('item')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTool === 'item'
              ? 'bg-accent text-white shadow-md shadow-accent/25'
              : 'hover:bg-surface-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          <Armchair size={14} />
          <span>Item</span>
        </button>
      </div>

      <div className="w-[1px] h-6 bg-border mx-1" />

      {/* 2. SuperSplat-Style Splat Cleanup Tools */}
      <div className="flex items-center gap-1 bg-surface-elevated/40 p-1 rounded-xl border border-border/50">
        <button
          title="Splat Bounding-Box Erasure Crop Tool (SuperSplat)"
          onClick={() => selectTool('splat-crop')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTool === 'splat-crop'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/25'
              : 'hover:bg-surface-elevated text-text-secondary hover:text-amber-400'
          }`}
        >
          <Crop size={14} />
          <span>Crop Box</span>
        </button>

        <button
          title="Splat Eraser Brush (SuperSplat)"
          onClick={() => selectTool('splat-eraser')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeTool === 'splat-eraser'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/25'
              : 'hover:bg-surface-elevated text-text-secondary hover:text-amber-400'
          }`}
        >
          <Eraser size={14} />
          <span>Eraser</span>
        </button>
      </div>

      <div className="w-[1px] h-6 bg-border mx-1" />

      {/* 3. View Modes & Scan Toggles */}
      <div className="flex items-center gap-1">
        {onOpenConvertModal && (
          <button
            title="Convert Scan to Editable Space (Extract Walls & Furniture)"
            onClick={onOpenConvertModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-accent/20 hover:bg-accent text-accent-light hover:text-white transition-all border border-accent/40 shadow-sm"
          >
            <Sparkles size={13} className="text-accent-light" />
            <span>Convert Scan</span>
          </button>
        )}

        {onToggleScanAlignment && (
          <button
            title="Align scan to the floor, real-world scale, and room axes"
            onClick={onToggleScanAlignment}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              isAligningScan
                ? 'bg-accent text-white border-accent'
                : 'bg-surface-elevated/60 hover:bg-surface-elevated text-text-secondary border-border'
            }`}
          >
            <Crosshair size={14} />
            <span>Align Scan</span>
          </button>
        )}

        <button
          title={`Scan Overlay: ${showScans ? 'Visible (Click to hide)' : 'Hidden (Click to show)'}`}
          onClick={() => setShowScans(!showScans)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            showScans
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-surface-elevated/60 text-text-muted border-border hover:text-text-primary'
          }`}
        >
          {showScans ? <Eye size={14} /> : <EyeOff size={14} />}
          <span>Scan</span>
        </button>

        <button
          title={`Level Mode: ${levelMode} (Click to cycle)`}
          onClick={cycleLevelMode}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-elevated/60 hover:bg-surface-elevated text-text-secondary hover:text-text-primary transition-all border border-border"
        >
          <Layers size={14} />
          <span className="capitalize">{levelMode}</span>
        </button>

        <button
          title={`Wall Cutaway / X-Ray: ${wallMode === 'cutaway' ? 'Active' : 'Off'}`}
          onClick={toggleWallCutaway}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            wallMode === 'cutaway'
              ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
              : 'bg-surface-elevated/60 text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          <Scissors size={14} />
          <span>Cutaway</span>
        </button>
      </div>

      <div className="w-[1px] h-6 bg-border mx-1" />

      {/* 4. History Undo / Redo */}
      <div className="flex items-center gap-0.5">
        <button
          title="Undo (Ctrl+Z)"
          onClick={() => undoSceneAction()}
          disabled={!canUndo}
          className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-elevated disabled:opacity-30 disabled:pointer-events-none transition-all"
        >
          <Undo2 size={15} />
        </button>

        <button
          title="Redo (Ctrl+Y)"
          onClick={() => redoSceneAction()}
          disabled={!canRedo}
          className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-elevated disabled:opacity-30 disabled:pointer-events-none transition-all"
        >
          <Redo2 size={15} />
        </button>
      </div>
    </div>
  );
}
