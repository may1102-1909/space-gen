'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, PointerLockControls } from '@react-three/drei'
import * as THREE from 'three'

export type CameraMode = 'orbit' | 'walk' | 'fly'

/**
 * Switchable camera controller with three modes:
 * - orbit: Standard orbit controls (default)
 * - walk: First-person WASD + mouse look, locked to eye height
 * - fly: Free 6DOF movement
 */
export function CameraController({
  mode,
  onModeChange,
  floorHeight = -1,
  eyeHeight = 1.6,
  moveSpeed = 3,
  lookSpeed = 0.8,
  isDraggingGizmo = false,
  resetTrigger,
}: {
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
  floorHeight?: number
  eyeHeight?: number
  moveSpeed?: number
  lookSpeed?: number
  isDraggingGizmo?: boolean
  resetTrigger?: number
}) {
  const { camera, gl } = useThree()
  const orbitRef = useRef<any>(null)
  const pointerLockRef = useRef<any>(null)
  const velocityRef = useRef(new THREE.Vector3())
  const keysRef = useRef<Set<string>>(new Set())
  const speedMultiplierRef = useRef(1)
  const directionRef = useRef(new THREE.Vector3())

  // Handle external camera reset trigger
  useEffect(() => {
    if (resetTrigger) {
      if (orbitRef.current) {
        orbitRef.current.reset()
      } else {
        camera.position.set(0, 1.8, 4.5)
        camera.lookAt(0, 0, 0)
      }
    }
  }, [resetTrigger, camera])

  // Handle keyboard input for walk/fly modes
  useEffect(() => {
    if (mode === 'orbit') return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      keysRef.current.add(e.code)
      
      // Escape exits to orbit
      if (e.code === 'Escape') {
        onModeChange('orbit')
        document.exitPointerLock?.()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code)
    }

    const onWheel = (e: WheelEvent) => {
      // Adjust speed with scroll in walk/fly mode
      speedMultiplierRef.current = Math.max(0.2, Math.min(5, 
        speedMultiplierRef.current * (e.deltaY > 0 ? 0.9 : 1.1)
      ))
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    gl.domElement.addEventListener('wheel', onWheel, { passive: true })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      gl.domElement.removeEventListener('wheel', onWheel)
      keysRef.current.clear()
    }
  }, [mode, onModeChange, gl])

  // Lock pointer when entering walk/fly mode
  useEffect(() => {
    if (mode === 'walk' || mode === 'fly') {
      gl.domElement.requestPointerLock?.()
    } else {
      document.exitPointerLock?.()
      speedMultiplierRef.current = 1
    }
  }, [mode, gl])

  // Handle pointer lock change — if user presses Escape the browser unlocks
  useEffect(() => {
    const onLockChange = () => {
      if (!document.pointerLockElement && mode !== 'orbit') {
        onModeChange('orbit')
      }
    }
    document.addEventListener('pointerlockchange', onLockChange)
    return () => document.removeEventListener('pointerlockchange', onLockChange)
  }, [mode, onModeChange])

  // Frame update for walk/fly movement
  useFrame((_, delta) => {
    if (mode === 'orbit') return

    const keys = keysRef.current
    const speed = moveSpeed * speedMultiplierRef.current * delta
    const direction = directionRef.current.set(0, 0, 0)

    // WASD movement
    if (keys.has('KeyW') || keys.has('ArrowUp')) direction.z -= 1
    if (keys.has('KeyS') || keys.has('ArrowDown')) direction.z += 1
    if (keys.has('KeyA') || keys.has('ArrowLeft')) direction.x -= 1
    if (keys.has('KeyD') || keys.has('ArrowRight')) direction.x += 1

    // Vertical movement
    if (keys.has('Space')) direction.y += 1
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) direction.y -= 1

    if (direction.lengthSq() > 0) {
      direction.normalize()

      // Get camera's forward and right vectors (ignoring pitch for walk mode)
      const forward = new THREE.Vector3()
      camera.getWorldDirection(forward)
      
      if (mode === 'walk') {
        // In walk mode, movement is on the XZ plane only
        forward.y = 0
        forward.normalize()
      }
      
      const right = new THREE.Vector3()
      right.crossVectors(forward, camera.up).normalize()

      const up = new THREE.Vector3(0, 1, 0)

      // Apply movement
      camera.position.addScaledVector(forward, -direction.z * speed)
      camera.position.addScaledVector(right, direction.x * speed)
      camera.position.addScaledVector(up, direction.y * speed)

      // In walk mode, lock Y to eye height above floor
      if (mode === 'walk') {
        camera.position.y = floorHeight + eyeHeight
      }
    }
  })

  return (
    <>
      {/* Orbit controls — only active in orbit mode */}
      {mode === 'orbit' && (
        <OrbitControls
          ref={orbitRef}
          makeDefault
          enabled={!isDraggingGizmo}
          enableDamping
          dampingFactor={0.05}
          rotateSpeed={lookSpeed}
          zoomSpeed={1.2}
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI / 2 + 0.3}
          minDistance={0.5}
          maxDistance={50}
        />
      )}

      {/* Pointer lock controls — active in walk/fly mode */}
      {(mode === 'walk' || mode === 'fly') && (
        <PointerLockControls
          ref={pointerLockRef}
          makeDefault
        />
      )}
    </>
  )
}
