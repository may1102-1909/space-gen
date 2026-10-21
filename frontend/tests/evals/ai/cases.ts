/**
 * Spatial-agent eval set: 15 prompts over the realistic_room fixture and two synthetic rooms.
 * Each case states what a correct answer targets; score.ts checks target, placement validity
 * and rationale quality.
 */
import type { EditOp } from '@/lib/contracts';
import type { VisualDescriptors } from '@/lib/ai/vision';
import type { SpatialRequest } from '@/lib/ai/agent';
import { bedroomFixture, boxGlb, diningFixture, glbDataUrl, realisticFixture, TINY_PNG, type FixtureRoom } from './fixtures';

export interface EvalExpectation {
  /** Expected op of every proposal; 'none' = the agent should decline with an explanation. */
  op: EditOp | 'none';
  /** Proposal target must be one of these Pascal item ids (move/replace/remove). */
  targets?: string[];
  count?: number;
  /** Added items must sit within `radius` m (plan distance) of this item's center. */
  near?: { id: string; radius: number };
  /** Moved item must end within `distance` m of one of these walls' interior lines. */
  againstWalls?: { ids: string[]; distance: number };
  /** Moved item must end closer to this item than it started. */
  closerTo?: string;
  /** Moved item must face this item (yaw within 0.35 rad). */
  facing?: string;
  /** Replacement / added asset category must contain one of these words. */
  assetCategory?: string[];
  assetSource?: 'catalog' | 'upload';
  /** Reply must contain this text (case-insensitive), e.g. a stated shortfall. */
  messageIncludes?: string;
}

export interface EvalCase {
  id: string;
  room: () => FixtureRoom;
  prompt: string;
  selectedIds?: string[];
  attachment?: SpatialRequest['attachment'];
  /** Vision answer the fake model returns for photo cases; such cases need a real photo for the live eval. */
  fakeVision?: VisualDescriptors;
  expect: EvalExpectation;
}

const glb = (size: [number, number, number], name: string, unitsPerMeter = 1): SpatialRequest['attachment'] => ({
  type: 'glb',
  name,
  url: `blob:eval/${name}`,
  dataUrl: glbDataUrl(boxGlb(size, unitsPerMeter)),
});

const CHAIRS = ['item_chair_left', 'item_chair_right'];

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'replace-chair-with-upload',
    room: realisticFixture,
    prompt: 'Replace the chair with this model',
    attachment: glb([0.7, 0.8, 0.72], 'oak_chair.glb'),
    expect: { op: 'replace', targets: CHAIRS, assetSource: 'upload' },
  },
  {
    id: 'add-4-dining-chairs',
    room: realisticFixture,
    prompt: 'Add 4 dining chairs around the dining table',
    // The Pascal table has yaw 0, so its east end and one east seat sit in the balcony door swing:
    // only 3 seats fit at the table, and the agent must say so.
    expect: { op: 'add', count: 3, near: { id: 'item_dining_table', radius: 1.6 }, assetCategory: ['chair'], messageIncludes: 'only 3 of 4' },
  },
  {
    id: 'move-sofa-long-wall',
    room: realisticFixture,
    prompt: 'Move the sofa against the long wall',
    expect: { op: 'move', targets: ['item_sofa_01'], againstWalls: { ids: ['wall_north', 'wall_south'], distance: 0.8 } },
  },
  {
    id: 'move-sofa-closer-coffee-table',
    room: realisticFixture,
    prompt: 'Move the sofa 0.5m closer to the coffee table',
    expect: { op: 'move', targets: ['item_sofa_01'], closerTo: 'item_coffee_table' },
  },
  {
    id: 'replace-coffee-table-walnut',
    room: realisticFixture,
    prompt: 'Replace the coffee table with a walnut one',
    expect: { op: 'replace', targets: ['item_coffee_table'], assetCategory: ['table'], assetSource: 'catalog' },
  },
  {
    id: 'remove-tv-console',
    room: realisticFixture,
    prompt: 'Remove the TV console',
    expect: { op: 'remove', targets: ['item_tv_console'] },
  },
  {
    id: 'replace-armchair-from-photo',
    room: realisticFixture,
    prompt: 'Replace the right armchair with the chair in this photo',
    attachment: { type: 'image', name: 'lounge.png', dataUrl: TINY_PNG },
    fakeVision: { category: 'chair', subType: 'lounge_chair', styleTags: ['mid_century', 'leather', 'lounge'], primaryColorHex: '#2B2625', estimatedDimensions: [0.85, 0.82, 0.85] },
    expect: { op: 'replace', targets: ['item_chair_right'], assetCategory: ['chair'], assetSource: 'catalog' },
  },
  {
    id: 'add-upload-next-to-sofa',
    room: realisticFixture,
    prompt: 'Place this plant model next to the sofa',
    // Authored in millimetres; the GLB measurer rescales to meters.
    attachment: glb([0.45, 1.2, 0.45], 'fiddle_leaf_plant.glb', 1000),
    expect: { op: 'add', count: 1, near: { id: 'item_sofa_01', radius: 2.5 }, assetSource: 'upload' },
  },
  {
    id: 'rotate-armchair-face-tv',
    room: realisticFixture,
    prompt: 'Rotate the left armchair to face the TV console',
    expect: { op: 'move', targets: ['item_chair_left'], facing: 'item_tv_console' },
  },
  {
    id: 'dining-add-2-chairs',
    room: diningFixture,
    prompt: 'Add two chairs around the dining table',
    expect: { op: 'add', count: 2, near: { id: 'item_dining_table', radius: 1.5 }, assetCategory: ['chair'] },
  },
  {
    id: 'dining-move-sideboard-east',
    room: diningFixture,
    prompt: 'Move the sideboard against the east wall',
    expect: { op: 'move', targets: ['item_sideboard'], againstWalls: { ids: ['wall_e'], distance: 0.7 } },
  },
  {
    id: 'dining-replace-selected-table',
    room: diningFixture,
    prompt: 'Replace the selected table with an oak dining table',
    selectedIds: ['item_dining_table'],
    expect: { op: 'replace', targets: ['item_dining_table'], assetCategory: ['table'], assetSource: 'catalog' },
  },
  {
    id: 'bedroom-add-lounge-chair-wall',
    room: bedroomFixture,
    prompt: 'Add a lounge chair along the wall',
    expect: { op: 'add', count: 1, assetCategory: ['chair'] },
  },
  {
    id: 'bedroom-move-armchair-closer-bed',
    room: bedroomFixture,
    prompt: 'Move the armchair closer to the bed',
    expect: { op: 'move', targets: ['item_armchair'], closerTo: 'item_bed' },
  },
  {
    id: 'bedroom-paint-wall-unsupported',
    room: bedroomFixture,
    prompt: 'Paint the north wall sage green',
    expect: { op: 'none' },
  },
];
