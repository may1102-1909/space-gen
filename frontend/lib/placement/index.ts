export * from './types';
export * from './geometry';
export {
  buildContext,
  buildRoomModel,
  inferCategory,
  normalizeCategory,
  type Obstacle,
  type PlacementContext,
  type RoomModel,
  type SceneInput,
  type Subject,
} from './context';
export { validate, validateSubject, proposalToSubject, clearFrontDepth } from './validate';
export {
  solvePlacements,
  solveInContext,
  type PlacementAsset,
  type PlacementLayout,
  type PlacementRequest,
  type PlacementStrategy,
  type ScoredPlacement,
} from './solver';
