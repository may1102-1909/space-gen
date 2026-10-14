'use client'

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useAppStore } from '@/lib/store'
import { SceneObject } from '@/lib/types'
import { TransformGizmo } from './TransformGizmo'

interface SolidMeshViewerProps {
  meshUrl?: string
  objects: SceneObject[]
  onSelectObject: (id: string | null) => void
  onDragChange?: (dragging: boolean) => void
}

/**
 * Individual Interactive Mesh Node for furniture (e.g. bed, sofa).
 * Supports 6-DOF translation/rotation/scaling, selection, hover, and replacement models.
 */
function InteractiveObjectNode({
  object,
  isSelected,
  onClick,
  onDragChange,
}: {
  object: SceneObject
  isSelected: boolean
  onClick: () => void
  onDragChange?: (dragging: boolean) => void
}) {
  const groupRef = useRef<THREE.Group>(null!)
  const [hovered, setHovered] = useState(false)
  const { objectTransforms, objectReplacements } = useAppStore()

  const replacement = objectReplacements[object.entity_id]
  const transform = objectTransforms[object.entity_id]

  const defaultPos = object.position || { x: 0, y: 0, z: 0 }
  const dim = object.dimensions || { width_m: 1.8, height_m: 0.9, depth_m: 2.0 }

  // Effective position from transform store or default
  const posX = transform?.position ? transform.position[0] : defaultPos.x
  const posY = transform?.position ? transform.position[1] : defaultPos.y
  const posZ = transform?.position ? transform.position[2] : defaultPos.z

  const rotX = transform?.rotation ? transform.rotation[0] : 0
  const rotY = transform?.rotation ? transform.rotation[1] : 0
  const rotZ = transform?.rotation ? transform.rotation[2] : 0

  const scaleX = transform?.scale ? transform.scale[0] : 1
  const scaleY = transform?.scale ? transform.scale[1] : 1
  const scaleZ = transform?.scale ? transform.scale[2] : 1

  return (
    <>
      <group
        ref={groupRef}
        position={[posX, posY, posZ]}
        rotation={[rotX, rotY, rotZ]}
        scale={[scaleX, scaleY, scaleZ]}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        {replacement ? (
          /* Render Replaced 3D GLB Model */
          <ReplacementModelNode url={replacement.modelUrl} />
        ) : (
          /* Render Procedural PBR Solid Mesh Box */
          <mesh castShadow receiveShadow>
            <boxGeometry args={[dim.width_m, dim.height_m, dim.depth_m || dim.width_m]} />
            <meshStandardMaterial
              color={isSelected ? '#6366f1' : hovered ? '#818cf8' : object.material?.color || '#a5b4fc'}
              roughness={0.35}
              metalness={0.15}
              transparent
              opacity={isSelected ? 0.9 : 0.75}
            />
          </mesh>
        )}

        {/* Selection / Hover Accent Wireframe */}
        {(isSelected || hovered) && (
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(dim.width_m * 1.02, dim.height_m * 1.02, (dim.depth_m || dim.width_m) * 1.02)]} />
            <lineBasicMaterial color={isSelected ? '#4f46e5' : '#818cf8'} linewidth={2} />
          </lineSegments>
        )}
      </group>

      {/* 6-DOF Transform Gizmo attached to active object */}
      {isSelected && (
        <TransformGizmo targetRef={groupRef} onDragChange={onDragChange} />
      )}
    </>
  )
}

function ReplacementModelNode({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const clone = React.useMemo(() => scene.clone(), [scene])

  useEffect(() => {
    clone.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m: any) => { m.side = THREE.DoubleSide })
          else child.material.side = THREE.DoubleSide
        }
      }
    })
  }, [clone])

  return <primitive object={clone} />
}

/**
 * SolidMeshViewer loads the converted room polygon mesh and hosts all interactive object nodes.
 */
export function SolidMeshViewer({
  meshUrl,
  objects,
  onSelectObject,
  onDragChange,
}: SolidMeshViewerProps) {
  const { scene: threeScene } = useThree()
  const meshGroupRef = useRef<THREE.Group>(null)
  const { selectedObjectId, objectTransforms } = useAppStore()

  // Load master room mesh if available
  useEffect(() => {
    if (!meshUrl) {
      if (meshGroupRef.current) {
        meshGroupRef.current.clear()
      }
      return
    }
    let cancelled = false

    async function loadMesh() {
      try {
        let model: THREE.Group | THREE.Object3D

        if (meshUrl!.toLowerCase().includes('.obj')) {
          const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
          const loader = new OBJLoader()
          model = await loader.loadAsync(meshUrl!)
        } else {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
          const loader = new GLTFLoader()
          const gltf = await loader.loadAsync(meshUrl!)
          model = gltf.scene
        }

        if (cancelled || !meshGroupRef.current) return

        let totalVertices = 0
        let totalTriangles = 0

        model.traverse((child: any) => {
          if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m: any) => { m.side = THREE.DoubleSide })
              else child.material.side = THREE.DoubleSide
            }
            if (child.geometry) {
              if (child.geometry.attributes?.position) {
                totalVertices += child.geometry.attributes.position.count
              }
              if (child.geometry.index) {
                totalTriangles += Math.round(child.geometry.index.count / 3)
              } else if (child.geometry.attributes?.position) {
                totalTriangles += Math.round(child.geometry.attributes.position.count / 3)
              }
            }
          }
        })

        meshGroupRef.current.clear()
        meshGroupRef.current.add(model)

        useAppStore.getState().setModelStats({
          count: totalVertices,
          triangles: totalTriangles,
          type: 'vertices',
        })
      } catch (err) {
        console.warn('SolidMeshViewer: master room mesh load error (fallback to objects view):', err)
      }
    }

    loadMesh()
    return () => {
      cancelled = true
    }
  }, [meshUrl])

  return (
    <group>
      {/* Master Room Mesh Geometry */}
      <group ref={meshGroupRef} />

      {/* Interactive Semantic Objects (Bed, Sofa, Table, etc.) */}
      {objects.filter(obj => obj.is_visible !== false).map((obj) => (
        <InteractiveObjectNode
          key={obj.entity_id}
          object={obj}
          isSelected={obj.entity_id === selectedObjectId}
          onClick={() => onSelectObject(obj.entity_id)}
          onDragChange={onDragChange}
        />
      ))}

      {/* Planar Floor Infill (Seals floor area when objects move) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[25, 25]} />
        <meshStandardMaterial color="#1e1e24" roughness={0.8} metalness={0.1} />
      </mesh>
    </group>
  )
}
