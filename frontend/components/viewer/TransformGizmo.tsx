'use client'

import React, { useEffect, useRef, useState } from 'react'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useSpaceGenStore } from '@/lib/store'

export function TransformGizmo() {
  const transformRef = useRef<any>(null)
  const [target, setTarget] = useState<THREE.Object3D | null>(null)
  const selectedObjectId = useSpaceGenStore((state) => state.selectedObjectId)
  const gizmoMode = useSpaceGenStore((state) => state.gizmoMode)
  const setGizmoMode = useSpaceGenStore((state) => state.setGizmoMode)
  const setSelectedObjectId = useSpaceGenStore((state) => state.setSelectedObjectId)

  useEffect(() => {
    setTarget(null)
    if (!selectedObjectId || (useScene.getState().nodes as Record<string, any>)[selectedObjectId]?.type !== 'item') return
    let attempts = 0
    const findRegisteredItem = () => {
      const object = sceneRegistry.nodes.get(selectedObjectId)
      if (object) setTarget(object)
      else if (attempts++ < 30) requestAnimationFrame(findRegisteredItem)
    }
    findRegisteredItem()
  }, [selectedObjectId])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!selectedObjectId) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const key = e.key.toLowerCase()
      if (key === 'w') { e.preventDefault(); setGizmoMode('translate') }
      else if (key === 'e') { e.preventDefault(); setGizmoMode('rotate') }
      else if (key === 'r') { e.preventDefault(); setGizmoMode('scale') }
      else if (key === 'escape') { e.preventDefault(); setSelectedObjectId(null) }
      else if (key === 'delete' || key === 'backspace') {
        e.preventDefault()
        useScene.getState().deleteNode(selectedObjectId as any)
        setSelectedObjectId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedObjectId, setGizmoMode, setSelectedObjectId])

  useEffect(() => {
    if (!transformRef.current || !target) return
    const controls = transformRef.current
    function handleDraggingChange(event: any) {
      if (event.value || !target || !selectedObjectId) return
      const object = target
      useScene.getState().updateNode(selectedObjectId as any, {
        position: [object.position.x, Math.max(0, object.position.y), object.position.z],
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: [object.scale.x, object.scale.y, object.scale.z],
      } as any)
    }
    controls.addEventListener('dragging-changed', handleDraggingChange)
    return () => controls.removeEventListener('dragging-changed', handleDraggingChange)
  }, [target, selectedObjectId])

  if (!selectedObjectId || !target) return null
  return <TransformControls ref={transformRef} object={target} mode={gizmoMode} size={0.85} space="local" />
}
