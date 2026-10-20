'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ScenePanel } from '@/components/panels/ScenePanel';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { EditorLayout } from '@/components/layout/EditorLayout';
import { useSpaceGenStore } from '@/lib/store';

const SceneViewer = dynamic(
  () => import('@/components/viewer/SceneViewer'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-background text-text-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Loading Pascal 3D workspace...</span>
        </div>
      </div>
    ),
  }
);

export default function EditorPage() {
  const { selectedObjectId, setSelectedObjectId, clearActiveModel } = useSpaceGenStore();

  useEffect(() => {
    // Start clean on page reload
    clearActiveModel();
  }, [clearActiveModel]);

  return (
    <EditorLayout>
      {/* Left Rail - 280px: Pascal Hierarchical Node Outliner & Live Inspector */}
      <div className="w-[280px] border-r border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden">
        <ScenePanel />
      </div>

      {/* Center 3D Viewport - Pascal <Viewer> + EditorToolbar */}
      <div className="flex-1 bg-background relative overflow-hidden h-full">
        <SceneViewer
          selectedId={selectedObjectId}
          onSelectObject={setSelectedObjectId}
        />
      </div>

      {/* Right Rail - 380px: AI Spatial Workspace Panel */}
      <div className="w-[380px] border-l border-border bg-surface flex flex-col shrink-0 h-full overflow-hidden">
        <ChatPanel />
      </div>
    </EditorLayout>
  );
}
