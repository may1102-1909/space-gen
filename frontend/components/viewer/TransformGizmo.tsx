'use client'

import React, { useEffect, useRef, useState } from 'react'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useSpaceGenStore } from '@/lib/store'
import { asNodeId, updateNodeData } from '@/lib/pascal/nodes'

type TransformControlsImpl = React.ComponentRef<typeof TransformControls>

export function TransformGizmo() {
  const transformRef = useRef<TransformControlsImpl>(null)
  // The registered Object3D for an item id; only used while that id is still selected.
  const [found, setFound] = useState<{ id: string; object: THREE.Object3D } | null>(null)
  const selectedObjectId = useSpaceGenStore((state) => state.selectedObjectId)
  const gizmoMode = useSpaceGenStore((state) => state.gizmoMode)
  const setGizmoMode = useSpaceGenStore((state) => state.setGizmoMode)
  const setSelectedObjectId = useSpaceGenStore((state) => state.setSelectedObjectId)
  const target = found && found.id === selectedObjectId ? found.object : null

  useEffect(() => {
    if (!selectedObjectId || useScene.getState().nodes[asNodeId(selectedObjectId)]?.type !== 'item') return
    let attempts = 0
    let frame = 0
    const findRegisteredItem = () => {
      const object = sceneRegistry.nodes.get(selectedObjectId)
      if (object) setFound({ id: selectedObjectId, object })
      else if (attempts++ < 30) frame = requestAnimationFrame(findRegisteredItem)
    }
    findRegisteredItem()
    return () => cancelAnimationFrame(frame)
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
        useScene.getState().deleteNode(asNodeId(selectedObjectId))
        setSelectedObjectId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedObjectId, setGizmoMode, setSelectedObjectId])

  useEffect(() => {
    // three-stdlib's TransformControls emits 'dragging-changed', which drei's ref type does not declare.
    const controls = transformRef.current as unknown as THREE.EventDispatcher<{ 'dragging-changed': { value: boolean } }> | null
    if (!controls || !target) return
    function handleDraggingChange(event: { value: boolean }) {
      if (event.value || !target || !selectedObjectId) return
      const object = target
      updateNodeData(selectedObjectId, {
        position: [object.position.x, Math.max(0, object.position.y), object.position.z],
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: [object.scale.x, object.scale.y, object.scale.z],
      })
    }
    controls.addEventListener('dragging-changed', handleDraggingChange)
    return () => controls.removeEventListener('dragging-changed', handleDraggingChange)
  }, [target, selectedObjectId])

  if (!selectedObjectId || !target) return null
  return <TransformControls ref={transformRef} object={target} mode={gizmoMode} size={0.85} space="local" />
}
