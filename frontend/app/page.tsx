'use client'

import { ScenePanel } from '@/components/panels/ScenePanel'
import { ChatPanel } from '@/components/panels/ChatPanel'
import { EditorLayout } from '@/components/layout/EditorLayout'
import dynamic from 'next/dynamic'

const SceneViewer = dynamic(
  () => import('@/components/viewer/SceneViewer').then((mod) => mod.SceneViewer),
  { ssr: false }
)
import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'

export default function EditorPage() {
  const { setScene, scene, selectedObjectId, setSelectedObjectId, clearActiveModel } = useAppStore()

  useEffect(() => {
    // Start completely clean on reload - no lingering models or auto-loading
    clearActiveModel()

    // Load initial room layout scene graph
    api.getScene('mock-scene-1').then(data => {
      setScene(data as any)
    })
  }, [setScene, clearActiveModel])

  return (
    <EditorLayout>
      {/* Left Panel - 280px */}
      <div className="w-[280px] border-r border-border bg-surface flex flex-col shrink-0">
        <ScenePanel />
      </div>

      {/* Center - 3D Viewer */}
      <div className="flex-1 bg-background relative overflow-hidden">
        <SceneViewer 
          objects={scene?.objects || []} 
          selectedId={selectedObjectId} 
          onSelectObject={setSelectedObjectId} 
        />
      </div>

      {/* Right Panel - 380px */}
      <div className="w-[380px] border-l border-border bg-surface flex flex-col shrink-0">
        <ChatPanel />
      </div>
    </EditorLayout>
  )
}
