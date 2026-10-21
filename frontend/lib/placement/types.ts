/**
 * Plain-data types for the placement validator and solver.
 * Frame: Y-up, meters, floor at y=0. Plan coordinates are [x, z].
 * Yaw follows three.js rotation about +Y; an item's front faces local +Z,
 * i.e. world direction (sin yaw, cos yaw) in plan.
 */
import type { OrientedBoundingBox } from '@/lib/contracts';

export type Vec2 = [number, number];

export type PlacementAttachment = 'floor' | 'wall' | 'ceiling';

/** One editable object, reduced to what spatial rules need. `obb.center` is the box center (mid-height). */
export interface PlacementItem {
  id: string;
  name: string;
  category: string;
  obb: OrientedBoundingBox;
  attachTo?: PlacementAttachment;
  /** Items sharing a groupId (e.g. chairs around one table) do not trigger walkway/front-clearance rules against each other. */
  groupId?: string;
}

/** Snapshot of the editable scene, derived from Pascal nodes by the adapter (never the live store). */
export interface PlacementScene {
  items: PlacementItem[];
}

export interface WallGeometry {
  id: string;
  a: Vec2;
  b: Vec2;
  dir: Vec2;
  /** Unit normal pointing into the room. */
  inward: Vec2;
  length: number;
  thickness: number;
  height: number;
  footprint: Vec2[];
}

export interface OpeningGeometry {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'opening';
  /** Opening center on the wall's interior face. */
  center: Vec2;
  dir: Vec2;
  inward: Vec2;
  width: number;
  height: number;
  sill: number;
}

export interface RoomGeometry {
  outline: Vec2[];
  floorY: number;
  ceilingHeight: number;
  walls: WallGeometry[];
  doors: OpeningGeometry[];
  windows: OpeningGeometry[];
  centroid: Vec2;
}

export interface PlacementConfig {
  /** Penetration (m) allowed before two boxes count as overlapping. */
  overlapTolerance: number;
  /** Distance (m) a footprint corner may sit outside the room outline. */
  outlineTolerance: number;
  /** Max gap (m) between an item's bottom and its support (floor or another item's top). */
  supportTolerance: number;
  /** Max gap (m) between a wall-attached item's back and the wall face. */
  wallAttachTolerance: number;
  /** Door swing radius = door width * doorSwingFactor + doorClearanceMargin. */
  doorSwingFactor: number;
  doorClearanceMargin: number;
  /** Minimum width (m) of a passage between an item and an obstacle. */
  walkwayMin: number;
  /** Gaps up to this size count as intentional adjacency (against a wall, chair tucked to table), not a walkway. */
  abutMax: number;
  /** Items at or below this height (rugs, mats) never block. */
  lowProfileHeight: number;
  /** Items whose bottom is above this height (wall shelves) do not obstruct walking. */
  headroom: number;
  /** Required free depth (m) in front of an item, by category key; `default` is the fallback, 0 disables. */
  frontClearance: Record<string, number>;
  /** Categories an item may sit close to without walkway/front-clearance warnings. */
  companions: Record<string, string[]>;
  /** Depth (m) of the zone in front of a window that tall items must stay out of. */
  windowZoneDepth: number;
  sillTolerance: number;
  /** Solver: anchor categories each asset category groups around, in priority order. */
  anchorAffinity: Record<string, string[]>;
  /** Solver: minimum anchor height (m) per asset category, e.g. dining chairs need a table at seating height. */
  anchorMinHeight: Record<string, number>;
  /** Solver: gap (m) between an anchor's edge and the placed item, by anchor category key. */
  anchorGap: Record<string, number>;
  /** Solver: categories treated as focal points (things seating faces). */
  focalCategories: string[];
  /** Solver: sample step (m) along walls. */
  wallStep: number;
  /** Solver: radii (m) of the arcs around a focal point. */
  focalRadii: number[];
}

export interface PlacementAssetSpec {
  url: string;
  name?: string;
  category: string;
  dimensions: { width: number; height: number; depth: number };
  source?: 'catalog' | 'upload' | 'generated';
}

/** UI-facing candidate consumed by the store and AIPlacementPreview. */
export interface CandidatePlacement {
  id: string;
  name: string;
  category: string;
  modelUrl: string;
  position: [number, number, number];
  rotation: [number, number, number];
  dimensions: [number, number, number];
  confidence: number;
  reasoning: string;
  zoneId?: string;
  status: 'pending' | 'accepted' | 'rejected';
}
