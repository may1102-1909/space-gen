import { describe, expect, it } from 'vitest';
import type { EditProposal } from '@/lib/contracts';
import { solvePlacement, validate, type PlacementItem } from '@/lib/placement';
import { item, opening, rectRoom } from './fixtures';

const room = rectRoom(12, 10, [
  opening({ id: 'door_1', wallId: 'wall_s', kind: 'door', offset: 6, width: 0.9 }),
  opening({ id: 'win_1', wallId: 'wall_n', kind: 'window', offset: 6, width: 2 }),
]);

// 30 items on a 6 x 5 grid, every other one rotated.
const items: PlacementItem[] = Array.from({ length: 30 }, (_, i) =>
  item(`item_${i}`, i % 3 === 0 ? 'table' : 'storage', [1.2 + (i % 6) * 1.9, 0, 1.2 + Math.floor(i / 6) * 1.8], [0.8, 0.8, 0.6], (i % 2) * 0.4),
);
const scene = { items };

const moveAll = (): EditProposal[] =>
  items.map((it) => ({
    id: `p_${it.id}`,
    op: 'move',
    targetNodeId: it.id,
    asset: null,
    transform: { position: [it.obb.center[0] + 0.1, 0, it.obb.center[2]], rotationY: it.obb.yaw, scale: [1, 1, 1] },
    rationale: 'perf',
    validation: { ok: true, violations: [] },
    status: 'pending',
  }));

function timeMs(fn: () => void): number {
  fn(); // warm-up
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  return runs.sort((a, b) => a - b)[2];
}

describe('placement performance (30 items)', () => {
  it('validates a proposal for each of 30 items in under 50 ms', () => {
    const proposals = moveAll();
    const ms = timeMs(() => proposals.forEach((p) => validate(p, scene, room)));
    console.log(`validate x30 (30-item scene): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });

  it('solves "place 4 chairs" in a 30-item room in under 50 ms', () => {
    const chair = { url: '/c.glb', category: 'chair', dimensions: { width: 0.45, height: 0.85, depth: 0.5 } };
    const ms = timeMs(() => solvePlacement({ asset: chair, count: 4 }, scene, room));
    console.log(`solvePlacement 4 chairs (30-item scene): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });
});
