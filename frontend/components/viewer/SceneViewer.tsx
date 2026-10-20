'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Viewer,
  SceneEnvironment,
  WallSystem,
  ItemSystem,
  ScanSystem,
  ZoneSystem,
  CeilingSystem,
  DoorSystem,
  WindowSystem,
  LevelSystem,
  useViewer,
} from '@pascal-app/viewer';
import { useScene } from '@pascal-app/core';
import { ensurePascalInitialized } from '@/lib/pascal/initPascal';
import { seedScannedRoom } from '@/lib/pascal/seedScannedRoom';
import { EditorToolbar, ActiveTool } from '@/components/layout/EditorToolbar';
import { ScanSegmentationOverlay } from './ScanSegmentationOverlay';
import { ScanToEditableModal } from '../capture/ScanToEditableModal';
import { AIPlacementPreview } from './AIPlacementPreview';
import { useSpaceGenStore } from '@/lib/store';
import { Loader2 } from 'lucide-react';

interface SceneViewerProps {
  objects?: any[];
  selectedId?: string | null;
  onSelectObject?: (id: string | null) => void;
}

export function SceneViewer({ selectedId, onSelectObject }: SceneViewerProps) {
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);

  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const setSelection = useViewer((state) => state.setSelection);
  const setSelectedObjectId = useSpaceGenStore((state) => state.setSelectedObjectId);

  // 1. Client-side bootstrap of Pascal nodes and default mock scanned room
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await ensurePascalInitialized();
        seedScannedRoom();
        if (mounted) {
          setIsReady(true);
        }
      } catch (err: any) {
        console.error('[SceneViewer] Failed to initialize Pascal workspace:', err);
        if (mounted) {
          setInitError(err?.message || 'Failed to initialize 3D editor');
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  // 2. Synchronize Pascal selection with SpaceGen store
  useEffect(() => {
    const currentId = selectedIds[0] || null;
    if (currentId !== selectedId) {
      if (onSelectObject) onSelectObject(currentId);
      setSelectedObjectId(currentId);
    }
  }, [selectedIds, selectedId, onSelectObject, setSelectedObjectId]);

  if (initError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-background text-text-muted p-6">
        <p className="text-red-400 font-medium mb-2">Error initializing 3D Workspace</p>
        <p className="text-xs text-text-muted max-w-md text-center">{initError}</p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-background text-text-muted gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="text-xs font-mono">Mounting Pascal 3D Architectural Systems...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-background">
      {/* Floating Mode Switcher & CAD Toolbars */}
      <EditorToolbar
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        onOpenConvertModal={() => setIsConvertModalOpen(true)}
      />

      {/* SuperSplat Overlay for Segmented Objects */}
      <ScanSegmentationOverlay />

      {/* Modal to Convert Scan to Parametric Walls + 3D Meshes */}
      <ScanToEditableModal
        isOpen={isConvertModalOpen}
        onClose={() => setIsConvertModalOpen(false)}
      />

      {/* AI Smart Placement Interactive Proposal HUD */}
      <AIPlacementPreview />

      {/* Pascal Full 3D Viewport with Boolean CSG & Scan Overlays */}
      <Viewer perf={false} useBvh={true}>
        <SceneEnvironment />
        <WallSystem />
        <ItemSystem />
        <ScanSystem />
        <ZoneSystem />
        <CeilingSystem />
        <DoorSystem />
        <WindowSystem />
        <LevelSystem />
      </Viewer>
    </div>
  );
}

export default SceneViewer;
