'use client';

import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SplatCameraState } from './SplatBackgroundCanvas';

interface PascalForegroundOverlayProps {
  onCameraSync: (state: SplatCameraState) => void;
  itemDepthMode: 'front' | 'behind';
  showOcclusionProxy: boolean;
  itemType: 'chair' | 'sofa' | 'coffee_table';
}

function CameraSyncBridge({ onSync }: { onSync: (state: SplatCameraState) => void }) {
  const { camera, size } = useThree();

  useFrame(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      onSync({
        position: [camera.position.x, camera.position.y, camera.position.z],
        quaternion: [
          camera.quaternion.x,
          camera.quaternion.y,
          camera.quaternion.z,
          camera.quaternion.w,
        ],
        fov: camera.fov,
        aspect: size.width / size.height,
        near: camera.near,
        far: camera.far,
      });
    }
  });

  return null;
}

function GlbItem({
  type,
  depthMode,
}: {
  type: 'chair' | 'sofa' | 'coffee_table';
  depthMode: 'front' | 'behind';
}) {
  const glbUrl = `/samples/models/${type}.glb`;
  const { scene } = useGLTF(glbUrl);

  // In 'front' mode, position the item inside the room foreground (e.g., z = 0.5)
  // In 'behind' mode, position the item behind the splat back wall (e.g., z = -2.5)
  const zPos = depthMode === 'front' ? 0.2 : -2.5;

  return (
    <group position={[0, -0.6, zPos]}>
      <primitive object={scene.clone()} scale={[1.2, 1.2, 1.2]} />
      {/* Visual Bounding Indicator */}
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[1.2, 1.0, 1.2]} />
        <meshBasicMaterial
          color={depthMode === 'front' ? '#10b981' : '#f59e0b'}
          wireframe
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}

function OcclusionWallProxy({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  return (
    <group position={[0, 0, -1.2]}>
      {/* Invisible Depth-Writing Wall Proxy: colorWrite=false, depthWrite=true */}
      <mesh>
        <planeGeometry args={[4.0, 3.0]} />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite={true}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Faint wireframe indicator to show where the wall proxy is */}
      <mesh>
        <planeGeometry args={[4.0, 3.0]} />
        <meshBasicMaterial
          color="#3b82f6"
          wireframe
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export const PascalForegroundOverlay: React.FC<PascalForegroundOverlayProps> = ({
  onCameraSync,
  itemDepthMode,
  showOcclusionProxy,
  itemType,
}) => {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-auto">
      <Canvas
        camera={{ position: [0, 1.2, 3.0], fov: 50 }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        }}
        className="w-full h-full"
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[5, 8, 5]} intensity={2.0} castShadow />
        <directionalLight position={[-5, 4, -2]} intensity={0.8} />

        <CameraSyncBridge onSync={onCameraSync} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={0.5}
          maxDistance={15}
        />

        {/* Dynamic Interactive Test Item */}
        <React.Suspense fallback={null}>
          <GlbItem type={itemType} depthMode={itemDepthMode} />
        </React.Suspense>

        {/* Depth Occlusion Proxy for Scan Wall */}
        <OcclusionWallProxy enabled={showOcclusionProxy} />
      </Canvas>
    </div>
  );
};
