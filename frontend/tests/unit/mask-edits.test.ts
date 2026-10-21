import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SplatEditSdf } from '@sparkjsdev/spark';
import type { MaskRegion } from '@/lib/contracts';
import { applyMaskEdits, buildMaskEdits, type MaskableMesh } from '@/lib/splat/maskEdits';

const chairMask: MaskRegion = {
  id: 'mask_item_chair',
  obb: { center: [2, 0.425, -0.75], size: [0.6, 0.85, 0.5], yaw: Math.PI / 2 },
  feather: 0.04,
  enabled: true,
  itemId: 'item_chair',
  ghost: false,
  opacity: 0,
};

/** Same world→SDF mapping Spark's SplatEdits.update() encodes (scale reset to 1, inverse matrixWorld). */
function sdfLocal(sdf: InstanceType<typeof SplatEditSdf>, world: THREE.Vector3): THREE.Vector3 {
  const halfExtents = sdf.scale.clone();
  sdf.scale.setScalar(1);
  sdf.updateMatrixWorld();
  const local = world.clone().applyMatrix4(sdf.matrixWorld.clone().invert());
  sdf.scale.copy(halfExtents);
  sdf.updateMatrixWorld();
  return local.divide(halfExtents);
}

const inside = (v: THREE.Vector3) => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1;

describe('mask edits (Spark SplatEdit SDF boxes)', () => {
  it('encodes OBB center, yaw and half-extents in scene frame', () => {
    const [edit] = buildMaskEdits([chairMask]);
    const sdf = edit.sdfs![0];
    expect(sdf.position.toArray()).toEqual([2, 0.425, -0.75]);
    expect(sdf.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(sdf.scale.x).toBeCloseTo(0.3);
    expect(sdf.scale.y).toBeCloseTo(0.425);
    expect(sdf.scale.z).toBeCloseTo(0.25);
    expect(sdf.opacity).toBe(0);
    expect(edit.softEdge).toBeCloseTo(0.04);
    // With yaw 90°, the box's 0.6m width lies along world Z, its 0.5m depth along world X.
    expect(inside(sdfLocal(sdf, new THREE.Vector3(2, 0.4, -0.75 + 0.29)))).toBe(true);
    expect(inside(sdfLocal(sdf, new THREE.Vector3(2 + 0.29, 0.4, -0.75)))).toBe(false);
  });

  it('uses ghost opacity and skips disabled regions', () => {
    const edits = buildMaskEdits([
      { ...chairMask, ghost: true, opacity: 0.25 },
      { ...chairMask, id: 'off', enabled: false },
    ]);
    expect(edits).toHaveLength(1);
    expect(edits[0].sdfs![0].opacity).toBe(0.25);
  });

  it('attaches edits only to the mesh (never as scene-global edits) and clears them', () => {
    const mesh: MaskableMesh = { edits: null };
    const edits = applyMaskEdits(mesh, [chairMask]);
    expect(mesh.edits).toBe(edits);
    // Spark collects any SplatEdit found in the scene graph outside a SplatMesh as global;
    // a parentless edit is the guarantee it is applied exactly once via mesh.edits.
    expect(edits.every((edit) => edit.parent === null)).toBe(true);
    applyMaskEdits(mesh, []);
    expect(mesh.edits).toBeNull();
  });

  it('masks the same scan splat regardless of scanToScene, since edits run after the mesh transform', () => {
    // A splat authored in scan space at (10, 5, 3); scanToScene rotates 90° about Y, scales 0.5, translates.
    const scanToScene = new THREE.Matrix4().compose(
      new THREE.Vector3(-3, 0.2, 1),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      new THREE.Vector3(0.5, 0.5, 0.5),
    );
    const scanPoint = new THREE.Vector3(10, 5, 3);
    const scenePoint = scanPoint.clone().applyMatrix4(scanToScene);
    const [edit] = buildMaskEdits([{ ...chairMask, obb: { center: scenePoint.toArray() as [number, number, number], size: [0.2, 0.2, 0.2], yaw: 0 } }]);
    expect(inside(sdfLocal(edit.sdfs![0], scenePoint))).toBe(true);
    // Applying the OBB in scan space instead (the bug this guards against) would miss the splat.
    expect(inside(sdfLocal(edit.sdfs![0], scanPoint))).toBe(false);
  });
});
