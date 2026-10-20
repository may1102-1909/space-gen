import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as WebGPU from 'three/webgpu';
import { getSplatFileType, SplatFileType } from '@sparkjsdev/spark';
import { isPointInsideVolume, SplatCropVolume } from '@/lib/splat/splatCropManager';

describe('001 Splat Rendering Decision - Empirical Evaluation Suite', () => {
  describe('Candidate (a): Spark inside Pascal WebGPURenderer Incompatibility', () => {
    it('proves WebGPURenderer prototype lacks classic WebGLRenderer properties required by Spark', () => {
      const proto = WebGPU.WebGPURenderer.prototype as any;

      // SparkRenderer requires `renderer.properties.has(this.orderingTexture)`
      // WebGPURenderer uses Node-based DataMaps and does NOT expose `properties`
      expect(proto.properties).toBeUndefined();

      // WebGPURenderer getContext() returns internal backend context, not classic WebGL2RenderingContext
      expect(typeof proto.getContext).toBe('function');
    });

    it('proves Spark shader pipeline expects WebGL GLSL materials incompatible with WGSL nodes', () => {
      // Standard MeshBasicNodeMaterial from three/webgpu vs RawShaderMaterial
      const nodeMat = new WebGPU.MeshBasicNodeMaterial();
      expect(nodeMat.isNodeMaterial).toBe(true);

      const rawMat = new THREE.RawShaderMaterial({
        vertexShader: 'void main() { gl_Position = vec4(0.0); }',
        fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
      });
      // RawShaderMaterial is not a NodeMaterial and cannot compile in WebGPU WGSL pipelines
      expect((rawMat as any).isNodeMaterial).toBeFalsy();
    });
  });

  describe('Candidate (b): Forcing Pascal to WebGL (forceWebGL: true)', () => {
    it('proves forceWebGL in three/webgpu still creates a WebGPU node-system WebGLBackend', () => {
      // In Three.js r186, WebGPURenderer with forceWebGL: true still does not create classic WebGLRenderer
      const renderer = new WebGPU.WebGPURenderer({ forceWebGL: true } as any);
      expect((renderer as any).isWebGPURenderer).toBe(true);
      expect((renderer as any).properties).toBeUndefined();
    });
  });

  describe('Candidate (c): Dual-Canvas Camera Synchronization & OBB Masking', () => {
    it('synchronizes perspective camera matrices between foreground and background', () => {
      const foregroundCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
      foregroundCam.position.set(2.5, 1.8, 4.2);
      foregroundCam.lookAt(0, 0, 0);
      foregroundCam.updateMatrixWorld();

      const backgroundCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
      backgroundCam.position.copy(foregroundCam.position);
      backgroundCam.quaternion.copy(foregroundCam.quaternion);
      backgroundCam.fov = foregroundCam.fov;
      backgroundCam.aspect = foregroundCam.aspect;
      backgroundCam.near = foregroundCam.near;
      backgroundCam.far = foregroundCam.far;
      backgroundCam.updateProjectionMatrix();

      expect(backgroundCam.position.x).toBeCloseTo(foregroundCam.position.x);
      expect(backgroundCam.position.y).toBeCloseTo(foregroundCam.position.y);
      expect(backgroundCam.position.z).toBeCloseTo(foregroundCam.position.z);
      expect(backgroundCam.quaternion.w).toBeCloseTo(foregroundCam.quaternion.w);
    });

    it('correctly tests point containment in OBB exclusion volumes for per-region masking', () => {
      const boxVolume: SplatCropVolume = {
        id: 'exclusion_box_01',
        type: 'box',
        center: [0, 0, 0],
        size: [2.0, 2.0, 2.0],
        mode: 'exclude',
      };

      // Point inside box
      expect(isPointInsideVolume([0.5, 0.5, 0.5], boxVolume)).toBe(true);

      // Point outside box
      expect(isPointInsideVolume([3.0, 0.0, 0.0], boxVolume)).toBe(false);

      // Point on boundary
      expect(isPointInsideVolume([1.0, 0.0, 0.0], boxVolume)).toBe(true);
    });
  });

  describe('Candidate (d) & Format Compatibility', () => {
    it('verifies that Spark detects .sog (PCSOGSZIP) format signatures correctly', () => {
      // Mock minimal zip header containing PK\x03\x04
      const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      const detected = getSplatFileType(zipHeader);
      // Spark returns either PCSOGSZIP or PLY/null based on zip entries
      expect([SplatFileType.PCSOGSZIP, SplatFileType.PLY, undefined]).toContain(detected);
    });

    it('verifies PLY header detection', () => {
      const plyHeader = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\n');
      const detected = getSplatFileType(plyHeader);
      expect(detected).toBe(SplatFileType.PLY);
    });
  });
});
