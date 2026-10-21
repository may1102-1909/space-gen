import type { EditProposal, OpeningInterpretation, RoomInterpretation } from '@/lib/contracts';
import { RoomInterpretationSchema } from '@/lib/contracts';
import type { PlacementItem } from '@/lib/placement';
import realisticRoom from '../../fixtures/realistic_room.json';

export const realistic = {
  interpretation: RoomInterpretationSchema.parse(realisticRoom.interpretation),
  sceneSnapshot: realisticRoom.sceneSnapshot as Record<string, unknown>,
  assets: realisticRoom.assets,
};

/** Closed rectangular room [0,w] x [0,d] with 0.2 m walls on the outline, walls listed N, E, S, W. */
export function rectRoom(w: number, d: number, openings: OpeningInterpretation[] = []): RoomInterpretation {
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, d],
    [0, d],
  ];
  const ids = ['wall_n', 'wall_e', 'wall_s', 'wall_w'];
  return {
    provenance: 'user',
    floor: { normal: [0, 1, 0], constant: 0, provenance: 'user' },
    ceilingHeight: 2.7,
    outline: corners,
    walls: corners.map((c, i) => {
      const n = corners[(i + 1) % 4];
      return {
        id: ids[i],
        start: [c[0], 0, c[1]],
        end: [n[0], 0, n[1]],
        height: 2.7,
        thickness: 0.2,
        confidence: 1,
        provenance: 'user',
      };
    }),
    openings,
    detections: [],
  };
}

/** L-shaped room: 6x6 square with the [3,6]x[3,6] quadrant cut out. */
export function lRoom(): RoomInterpretation {
  const pts: [number, number][] = [
    [0, 0],
    [6, 0],
    [6, 3],
    [3, 3],
    [3, 6],
    [0, 6],
  ];
  return {
    provenance: 'user',
    floor: { normal: [0, 1, 0], constant: 0, provenance: 'user' },
    ceilingHeight: 2.7,
    outline: pts,
    walls: pts.map((p, i) => {
      const n = pts[(i + 1) % pts.length];
      return {
        id: `wall_${i}`,
        start: [p[0], 0, p[1]],
        end: [n[0], 0, n[1]],
        height: 2.7,
        thickness: 0.2,
        confidence: 1,
        provenance: 'user',
      };
    }),
    openings: [],
    detections: [],
  };
}

export const opening = (o: Partial<OpeningInterpretation> & Pick<OpeningInterpretation, 'id' | 'wallId' | 'kind' | 'offset' | 'width'>): OpeningInterpretation => ({
  height: o.kind === 'door' ? 2.1 : 1.2,
  sill: o.kind === 'door' ? 0 : 0.9,
  confidence: 1,
  provenance: 'user',
  ...o,
});

/** Floor item from base-center position and size [w, h, d]. */
export function item(
  id: string,
  category: string,
  [x, y, z]: [number, number, number],
  size: [number, number, number],
  yaw = 0,
  extra: Partial<PlacementItem> = {},
): PlacementItem {
  return { id, name: id, category, obb: { center: [x, y + size[1] / 2, z], size, yaw }, attachTo: 'floor', ...extra };
}

export function addProposal(
  position: [number, number, number],
  dims: { width: number; height: number; depth: number },
  rotationY = 0,
): EditProposal {
  return {
    id: 'p_test',
    op: 'add',
    targetNodeId: null,
    asset: { source: 'catalog', url: '/assets/models/test.glb', dimensions: dims },
    transform: { position, rotationY, scale: [1, 1, 1] },
    rationale: 'test',
    validation: { ok: true, violations: [] },
    status: 'pending',
  };
}
