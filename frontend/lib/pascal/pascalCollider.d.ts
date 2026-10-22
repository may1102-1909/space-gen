import type * as THREE from 'three';

/** The subset of the editor's first-person collider module this app uses (see pascalCollider.js). */
export interface FirstPersonColliderWorld {
  mesh: THREE.Mesh;
  bounds: THREE.Box3 | null;
  dispose: () => void;
}

/** Merges the rendered walls/slabs/doors/items (plus level fallback floors) into one BVH collider. */
export declare function buildFirstPersonColliderWorldFromRegistry(): FirstPersonColliderWorld | null;
