'use client'

import { useAppStore } from '@/lib/store'
import { Undo, Redo, Share2, Download, Play, Video, Zap, ChevronDown, Box } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { VideoCaptureModal } from '@/components/capture/VideoCaptureModal'
import { motion } from 'framer-motion'
import { useScene } from '@pascal-app/core'
import { undoSceneAction, redoSceneAction } from '@/lib/pascal/sceneBridge'

export function EditorLayout({ children }: { children: React.ReactNode }) {
  const { scene } = useAppStore()
  useScene((state) => state.nodes);
  const temporal = (useScene as any).temporal?.getState?.();
  const canUndo = (temporal?.pastStates?.length || 0) > 0;
  const canRedo = (temporal?.futureStates?.length || 0) > 0;
  const [captureOpen, setCaptureOpen] = useState(false)

  // Global keyboard shortcuts for Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          redoSceneAction()
        } else {
          undoSceneAction()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redoSceneAction()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* Top Header */}
      <header className="h-14 border-b border-border bg-surface/90 backdrop-blur-xl px-4 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-brand flex items-center justify-center shadow-glow">
              <Zap size={14} className="text-white" />
            </div>
            <span className="font-bold text-base tracking-tight text-text-primary">
              Space<span className="text-gradient">Gen</span>
            </span>
          </div>

          <div className="h-5 w-px bg-border" />
          
          {/* Project name */}
          <button className="flex items-center gap-1.5 text-sm font-medium text-text-primary hover:text-accent transition-colors">
            {scene?.room_type || 'Untitled Project'}
            <ChevronDown size={14} className="text-text-muted" />
          </button>

          {/* Import / Scenes button */}
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setCaptureOpen(true)} 
            className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-all hover:bg-accent/20 hover:border-accent/50"
          >
            <Box size={13} />
            Import / Scenes
          </motion.button>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Undo/Redo */}
          <div className="flex items-center gap-0.5 border-r border-border pr-2 mr-1">
            <button onClick={undoSceneAction} disabled={!canUndo} className="p-2 hover:bg-surface-elevated rounded-lg text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none" title="Undo (Ctrl+Z)">
              <Undo size={16} />
            </button>
            <button onClick={redoSceneAction} disabled={!canRedo} className="p-2 hover:bg-surface-elevated rounded-lg text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none" title="Redo (Ctrl+Y)">
              <Redo size={16} />
            </button>
          </div>

          {/* Actions */}
          <Link href="/present">
            <button className="btn-ghost text-xs py-1.5">
              <Play size={14} />
              Present
            </button>
          </Link>
          
          <button className="btn-ghost text-xs py-1.5">
            <Share2 size={14} />
            Share
          </button>
          
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="btn-primary text-xs py-1.5 px-4"
          >
            <Download size={14} />
            Export
          </motion.button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden">
        {children}
      </main>

      {/* Bottom Status Bar */}
      <footer className="h-7 border-t border-border bg-surface/60 backdrop-blur-sm px-4 flex items-center justify-between shrink-0 text-[11px] text-text-muted">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
            Connected
          </span>
          <span>Objects: <b className="text-text-secondary">{scene?.objects?.length || 0}</b></span>
          {scene?.style && <span>Style: <b className="text-text-secondary">{scene.style}</b></span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px]">SpaceGen AI v1.0</span>
        </div>
      </footer>

      {captureOpen && <VideoCaptureModal onClose={() => setCaptureOpen(false)} />}
    </div>
  )
}
