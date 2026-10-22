'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { KeyboardControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import {
  BVHEcctrl,
  CROUCH_CAPSULE,
  CROUCH_EYE_OFFSET,
  CROUCH_FLOAT_HEIGHT,
  CROUCH_RUN_SPEED,
  CROUCH_WALK_SPEED,
  EYE_LERP_SPEED,
  STAND_CAPSULE,
  STAND_CLEARANCE,
  STAND_FLOAT_HEIGHT,
  WALKTHROUGH_FOV,
  useViewer,
  type BVHEcctrlApi,
} from '@pascal-app/viewer';
import { buildFirstPersonColliderWorldFromRegistry } from '@/lib/pascal/pascalCollider';
import { clampToPolygon } from '@/lib/navigation/polygon';
import { computeSpawn, planCollider, type Vec3 } from '@/lib/navigation/room';
import { useRoomNavigation } from '@/lib/navigation/useRoom';
import { useNavigation, type ViewMode } from '@/lib/navigation/navigationStore';
import { useScene } from '@pascal-app/core';

/** Camera clip distance while walking, small enough to stand right at a wall. */
export const WALK_NEAR = 0.05;
const CAMERA_EYE_OFFSET = 0.45;
const CENTER_FROM_EYE = 0.85;
const LOOK_SENSITIVITY = 0.002;
/** Keep the capsule's head (centre + 0.65 m) below the ceiling when jumping. */
const HEAD_ROOM = 0.7;
const FLOOR_SLAB_HALF = 1000;
const OUTLINE_MARGIN = 0.1;

// Pascal's controller keys, plus C for crouch (the Ctrl key is handled below as in Pascal).
// While the pointer is locked the mouse cannot reach the view-mode buttons, so 1 / 2 / 3 switch Splat / Mesh / Both.
const VIEW_KEYS: Record<string, ViewMode> = { Digit1: 'splat', Digit2: 'mesh', Digit3: 'both' };

const KEYBOARD_MAP = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
  { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
];

interface Collider {
  mesh: THREE.Mesh;
  minY: number;
  source: 'scene' | 'floor-only';
  dispose: () => void;
}

const COLLIDER_USERDATA = { type: 'STATIC', friction: 0.8, restitution: 0.05, excludeFloatHit: false, excludeCollisionCheck: false };

/** A single large floor whose top face is y = 0: the whole collider when no walls exist. */
function buildFloorOnlyCollider(): Collider {
  const geometry = new THREE.BoxGeometry(FLOOR_SLAB_HALF * 2, 0.1, FLOOR_SLAB_HALF * 2).toNonIndexed();
  const position = new THREE.BufferGeometry();
  position.setAttribute('position', geometry.getAttribute('position').clone());
  position.translate(0, -0.05, 0);
  geometry.dispose();
  const bvh = position as THREE.BufferGeometry & { computeBoundsTree: typeof computeBoundsTree; disposeBoundsTree: typeof disposeBoundsTree };
  bvh.computeBoundsTree = computeBoundsTree;
  bvh.disposeBoundsTree = disposeBoundsTree;
  bvh.computeBoundsTree({ maxLeafSize: 12 });
  const mesh = new THREE.Mesh(position, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.raycast = acceleratedRaycast;
  mesh.userData = { ...COLLIDER_USERDATA };
  mesh.updateMatrixWorld(true);
  return { mesh, minY: -0.1, source: 'floor-only', dispose: () => { bvh.disposeBoundsTree(); position.dispose(); } };
}

/** Collider from the parametric Pascal scene (walls, slabs, doors, items); floor-only without walls. */
function buildCollider(): Collider {
  const plan = planCollider(useScene.getState().nodes as unknown as Parameters<typeof planCollider>[0]);
  if (plan.source === 'scene') {
    const world = buildFirstPersonColliderWorldFromRegistry();
    if (world) return { mesh: world.mesh, minY: world.bounds?.min.y ?? 0, source: 'scene', dispose: world.dispose };
  }
  return buildFloorOnlyCollider();
}

export interface WalkState {
  active: boolean;
  /** Eye position, scene frame. */
  eye: Vec3;
  yaw: number;
  pitch: number;
  fov: number;
  near: number;
  collider: 'scene' | 'floor-only';
}

declare global {
  interface Window {
    /** E2E only (NEXT_PUBLIC_E2E=1): read the walk state and drive mouse look, which needs pointer lock. */
    __spacegenWalk?: { state(): WalkState; setLook(yaw: number, pitch?: number): void };
  }
}

interface OrbitControlsLike {
  target: THREE.Vector3;
  update(): void;
}

/**
 * First-person walk for the editable scene: Pascal's BVHEcctrl capsule controller (gravity, jump, sprint,
 * crouch, mesh collision) fed a collider built from the parametric scene, so walls collide even when
 * they are invisible in Splat view. Restores the orbit camera on exit.
 */
export function WalkthroughController() {
  // Interior room confines the walker even through open doorways; null (exterior) walks freely.
  const { confinement: room } = useRoomNavigation();
  const { camera, gl } = useThree();
  const getState = useThree((state) => state.get);
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;
  const setNavMode = useNavigation((state) => state.setNavMode);

  const controllerRef = useRef<BVHEcctrlApi | null>(null);
  const colliderRef = useRef<Collider | null>(null);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const crouchKeyRef = useRef(false);
  const eyeOffsetRef = useRef(CAMERA_EYE_OFFSET);
  const roomRef = useRef(room);
  const [crouched, setCrouched] = useState(false);
  const [start, setStart] = useState<Vec3 | null>(null);
  const [collider, setCollider] = useState<Collider | null>(null);
  const saved = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion; target: THREE.Vector3; fov: number; near: number; far: number; mode: string } | null>(null);
  useEffect(() => {
    roomRef.current = room;
  });

  // Enter: remember the orbit camera, go first-person (perspective, 60 deg, near 5 cm), restore on exit.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const viewer = useViewer.getState();
    const target = controls?.target.clone() ?? new THREE.Vector3(0, 1, 0);
    saved.current = {
      position: cam.position.clone(), quaternion: cam.quaternion.clone(), target,
      fov: cam.fov, near: cam.near, far: cam.far, mode: viewer.cameraMode,
    };
    if (viewer.cameraMode === 'orthographic') viewer.setCameraMode('perspective');
    viewer.setWalkthroughMode(true);
    const spawn = computeSpawn(roomRef.current, [target.x, target.y, target.z], [cam.position.x, cam.position.y, cam.position.z]);
    yawRef.current = spawn.yaw;
    pitchRef.current = 0;
    setStart([spawn.position[0], spawn.position[1] - CENTER_FROM_EYE, spawn.position[2]]);
    return () => {
      const s = saved.current;
      useViewer.getState().setWalkthroughMode(false);
      useViewer.getState().setWalkthroughSuspended(false);
      if (!s) return;
      if (s.mode === 'orthographic') useViewer.getState().setCameraMode('orthographic');
      const current = getState().camera as THREE.PerspectiveCamera | undefined;
      const restore = (current?.isPerspectiveCamera ? current : cam);
      restore.position.copy(s.position);
      restore.quaternion.copy(s.quaternion);
      restore.fov = s.fov;
      restore.near = s.near;
      restore.far = s.far;
      restore.updateProjectionMatrix();
      controls?.target.copy(s.target);
      controls?.update();
    };
    // Mount-only: the orbit pose is captured once per walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cam = getState().camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    cam.fov = WALKTHROUGH_FOV;
    cam.near = Math.min(cam.near, WALK_NEAR);
    cam.updateProjectionMatrix();
  }, [camera, getState]);

  // Build the collider on the first frame, once Pascal has mounted the scene meshes.
  const built = useRef(false);
  useFrame(() => {
    if (built.current) return;
    built.current = true;
    const world = buildCollider();
    colliderRef.current = world;
    setCollider(world);
  }, 6);
  useEffect(() => () => {
    colliderRef.current?.dispose();
    colliderRef.current = null;
  }, []);

  // Pointer-lock look, click-to-lock, Esc / lock release to leave, hold C or Ctrl to crouch.
  useEffect(() => {
    const canvas = gl.domElement as HTMLCanvasElement;
    let wasLocked = false;
    const exit = () => setNavMode('orbit');
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yawRef.current -= event.movementX * LOOK_SENSITIVITY;
      pitchRef.current = Math.max(-(Math.PI / 2 - 0.05), Math.min(Math.PI / 2 - 0.05, pitchRef.current - event.movementY * LOOK_SENSITIVITY));
    };
    const onClick = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    };
    const isCrouchKey = (e: KeyboardEvent) => e.code === 'KeyC' || e.code === 'ControlLeft' || e.code === 'ControlRight';
    const onKeyDown = (event: KeyboardEvent) => {
      // Real browsers swallow Esc while locked and report it as a lock release below; synthetic events arrive here.
      if (event.code === 'Escape') exit();
      if (isCrouchKey(event)) crouchKeyRef.current = true;
      if (VIEW_KEYS[event.code]) useNavigation.getState().setViewMode(VIEW_KEYS[event.code]);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isCrouchKey(event)) crouchKeyRef.current = false;
    };
    const onBlur = () => { crouchKeyRef.current = false; };
    const onLockChange = () => {
      if (document.pointerLockElement === canvas) wasLocked = true;
      else if (wasLocked) exit();
    };
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }, [gl, setNavMode]);

  // Request the lock as soon as the walker exists; the mode toggle is the user gesture, and a click covers a rejection.
  useEffect(() => {
    if (!(collider && start)) return;
    const canvas = gl.domElement as HTMLCanvasElement;
    if (document.pointerLockElement === canvas) return;
    const result = canvas.requestPointerLock?.() as Promise<void> | undefined;
    result?.catch?.(() => {});
  }, [gl, collider, start]);

  const setApi = useCallback((api: BVHEcctrlApi | null) => { controllerRef.current = api; }, []);
  const standClearance = useRef(new THREE.Raycaster());
  const hasHeadroom = useCallback((p: THREE.Vector3) => {
    const mesh = colliderRef.current?.mesh;
    if (!mesh) return true;
    standClearance.current.set(p, new THREE.Vector3(0, 1, 0));
    standClearance.current.far = STAND_CLEARANCE;
    return standClearance.current.intersectObject(mesh, false).length === 0;
  }, []);

  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  // After BVHEcctrl's step: confine to the room, cap jump height, then drive the camera from the capsule.
  useFrame((_, delta) => {
    const api = controllerRef.current;
    const group = api?.group;
    if (!api || !group) return;
    const world = colliderRef.current;
    if (start && world && group.position.y < world.minY - 12) {
      group.position.set(start[0], start[1], start[2]);
      api.resetLinVel();
    }
    const r = roomRef.current;
    if (r) {
      // Doorways are openings in the walls, but the outline is still a boundary: never walk out through one.
      const [x, z] = clampToPolygon([group.position.x, group.position.z], r.outline, OUTLINE_MARGIN);
      const maxY = r.ceilingHeight - HEAD_ROOM;
      const hitCeiling = group.position.y > maxY;
      if (x !== group.position.x || z !== group.position.z || hitCeiling) {
        group.position.set(x, Math.min(group.position.y, maxY), z);
        api.resetLinVel();
      }
    }
    if (crouchKeyRef.current !== crouched) {
      if (crouchKeyRef.current) setCrouched(true);
      else if (hasHeadroom(group.position)) setCrouched(false);
    }
    const targetOffset = crouched ? CROUCH_EYE_OFFSET : CAMERA_EYE_OFFSET;
    eyeOffsetRef.current += (targetOffset - eyeOffsetRef.current) * Math.min(1, delta * EYE_LERP_SPEED);
    group.rotation.set(0, 0, 0);
    camera.position.set(group.position.x, group.position.y + eyeOffsetRef.current, group.position.z);
    euler.current.set(pitchRef.current, yawRef.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler.current);
    camera.updateMatrixWorld(true);
  }, 2.5);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E !== '1') return;
    window.__spacegenWalk = {
      state: () => {
        const cam = camera as THREE.PerspectiveCamera;
        return {
          active: true,
          eye: [cam.position.x, cam.position.y, cam.position.z],
          yaw: yawRef.current,
          pitch: pitchRef.current,
          fov: cam.fov,
          near: cam.near,
          collider: colliderRef.current?.source ?? 'floor-only',
        };
      },
      setLook: (yaw, pitch = 0) => { yawRef.current = yaw; pitchRef.current = pitch; },
    };
    return () => { delete window.__spacegenWalk; };
  }, [camera]);

  if (!(collider && start)) return null;
  return (
    <KeyboardControls map={KEYBOARD_MAP}>
      <BVHEcctrl
        acceleration={26}
        airDragFactor={0.3}
        colliderCapsuleArgs={crouched ? CROUCH_CAPSULE : STAND_CAPSULE}
        colliderMeshes={[collider.mesh]}
        collisionCheckIteration={3}
        collisionPushBackDamping={0.1}
        collisionPushBackThreshold={0.001}
        deceleration={30}
        delay={0}
        fallGravityFactor={4}
        floatCheckType="BOTH"
        floatDampingC={36}
        floatHeight={crouched ? CROUCH_FLOAT_HEIGHT : STAND_FLOAT_HEIGHT}
        floatPullBackHeight={0.35}
        floatSensorRadius={0.15}
        floatSpringK={1200}
        gravity={9.81}
        jumpVel={5}
        maxRunSpeed={crouched ? CROUCH_RUN_SPEED : 5}
        maxSlope={1.2}
        maxWalkSpeed={crouched ? CROUCH_WALK_SPEED : 2}
        position={start}
        ref={setApi}
      />
    </KeyboardControls>
  );
}
