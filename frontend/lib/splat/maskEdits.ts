import { SplatEdit, SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark';
import type { MaskRegion } from '@/lib/contracts';

type SplatEditInstance = InstanceType<typeof SplatEdit>;

export interface MaskableMesh {
  edits: SplatEditInstance[] | null;
}

/**
 * Builds one Spark SplatEdit per enabled mask region.
 *
 * Spark evaluates edit SDFs after the SplatMesh's own transform (world space), and the mesh's
 * matrix is the persisted scanToScene. Mask OBBs are therefore authored in scene frame
 * (Y-up, meters, floor y=0) and must not be multiplied by scanToScene again.
 */
export function buildMaskEdits(regions: readonly MaskRegion[]): SplatEditInstance[] {
  const edits: SplatEditInstance[] = [];
  for (const mask of regions) {
    if (mask.enabled === false) continue;
    const sdf = new SplatEditSdf({
      type: SplatEditSdfType.BOX,
      opacity: mask.ghost ? (mask.opacity ?? 0.25) : 0.0,
    });
    sdf.position.set(mask.obb.center[0], mask.obb.center[1], mask.obb.center[2]);
    sdf.rotation.set(0, mask.obb.yaw || 0, 0);
    // Spark box SDFs take half-extents through the object's scale.
    sdf.scale.set(
      Math.max(0.005, mask.obb.size[0] / 2),
      Math.max(0.005, mask.obb.size[1] / 2),
      Math.max(0.005, mask.obb.size[2] / 2),
    );
    sdf.updateMatrixWorld();
    edits.push(new SplatEdit({ sdfs: [sdf], softEdge: mask.feather ?? 0.05, sdfSmooth: 0.02 }));
  }
  return edits;
}

/**
 * Attaches mask edits to a single mesh. The edits are deliberately NOT added to the THREE scene:
 * Spark treats any SplatEdit in the scene graph outside a SplatMesh as a global edit and also
 * applies `mesh.edits`, which would apply every mask twice (ghost opacity 0.25 → 0.0625).
 */
export function applyMaskEdits(mesh: MaskableMesh, regions: readonly MaskRegion[]): SplatEditInstance[] {
  const edits = buildMaskEdits(regions);
  mesh.edits = edits.length > 0 ? edits : null;
  return edits;
}
