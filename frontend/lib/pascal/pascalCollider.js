// The editor's collider builder (walls, slabs, doors, items from the live Pascal scene) is not in the
// package's exports map, so it is reached by path. Like pascalEditor.js this is untyped TypeScript
// source; the typed surface lives in pascalCollider.d.ts.
export { buildFirstPersonColliderWorldFromRegistry } from '../../node_modules/@pascal-app/editor/src/components/editor/first-person/build-collider-world.ts';
