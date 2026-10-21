import {
  pauseSceneHistory,
  resumeSceneHistory,
  subscribeSceneCommits,
  useScene,
  type AnyNode,
  type AnyNodeId,
  type SceneCommit,
} from '@pascal-app/core';
import { getInterpretationMeta, hasInterpretationNodes, withInterpretationMeta, type InterpretationMeta } from './scanConverter';

/**
 * Keeps the RoomInterpretation in sync with Pascal's own wall / door / window tools.
 *
 * Pascal tools write plain nodes. After each local commit, walls and openings the tool created
 * get interpretation metadata (provenance=user, status=corrected) and interpreted ones whose
 * geometry it changed are marked corrected, so `deriveInterpretationFromScene` (and the project
 * save) picks them up. The stamp is written with history paused, so it folds into the tool's
 * own undo step: undo removes the edit and its stamp together, redo restores both.
 */

type NodeMap = Record<string, any>;
const CORRECTED = { provenance: 'user' as const, status: 'corrected' as const };
const WALL_FIELDS = ['start', 'end', 'thickness', 'height'];
const OPENING_FIELDS = ['position', 'width', 'height', 'wallId', 'parentId'];

const isOpening = (n: any) => n?.type === 'door' || n?.type === 'window';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function openingKind(node: any): InterpretationMeta['openingKind'] {
  if (node.type === 'window') return 'window';
  return node.openingKind === 'opening' ? 'opening' : 'door';
}

/** Metadata patches that bring tool edits into the interpretation; empty when nothing to do. */
export function planInterpretationStamps(before: NodeMap, current: NodeMap): Array<{ id: AnyNodeId; data: Partial<AnyNode> }> {
  if (!hasInterpretationNodes(current)) return [];
  const updates: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = [];
  const sourceKey = (n: any) => {
    const meta = getInterpretationMeta(n);
    return meta ? `${meta.kind}:${meta.sourceId}` : null;
  };
  // Source ids still held by a node that existed before this commit, and ids the commit removed.
  const surviving = new Set<string>();
  for (const node of Object.values(current)) if (before[node?.id]) surviving.add(sourceKey(node) || '');
  const removed = new Set<string>();
  for (const node of Object.values(before)) if (!current[node?.id]) removed.add(sourceKey(node) || '');
  const claimed = new Set<string>();

  for (const node of Object.values(current)) {
    if (!node || (node.type !== 'wall' && !isOpening(node))) continue;
    const prev = before[node.id];
    const meta = getInterpretationMeta(node);
    const kind = node.type === 'wall' ? 'wall' : 'opening';
    let patch: Partial<InterpretationMeta> | null = null;

    if (!meta) {
      patch = { kind, sourceId: node.id, confidence: 1, ...CORRECTED, ...(kind === 'opening' ? { openingKind: openingKind(node) } : {}) };
    } else if (!prev) {
      // Pascal splits a wall by replacing it with pieces that copy its metadata: the first piece
      // keeps the source id, the others get their own, and all of them are user corrections.
      const key = sourceKey(node)!;
      const taken = surviving.has(key) || claimed.has(key);
      claimed.add(key);
      if (taken) patch = { sourceId: node.id, ...CORRECTED };
      else if (removed.has(key)) patch = CORRECTED;
    } else {
      const fields = node.type === 'wall' ? WALL_FIELDS : OPENING_FIELDS;
      const changed = fields.some((f) => !same(prev[f], node[f]));
      if (changed && (meta.provenance !== 'user' || meta.status !== 'corrected')) patch = CORRECTED;
    }
    if (patch) updates.push({ id: node.id as AnyNodeId, data: { metadata: withInterpretationMeta(node, patch) } as Partial<AnyNode> });
  }
  return updates;
}

/** Applies a commit's stamps without creating a new history step. */
export function stampCommit(commit: Pick<SceneCommit, 'before' | 'current'>) {
  const updates = planInterpretationStamps(commit.before.nodes as NodeMap, useScene.getState().nodes as NodeMap);
  if (!updates.length) return;
  pauseSceneHistory(useScene);
  try {
    useScene.getState().applyNodeChanges({ update: updates });
  } finally {
    resumeSceneHistory(useScene);
  }
}

/** Subscribes the sync to local scene commits; returns the unsubscribe. */
export function installArchitecturalSync(): () => void {
  return subscribeSceneCommits((commit) => {
    if (commit.origin !== 'local') return;
    // Run after the tool's synchronous writes (and zundo's past-state push) finish.
    queueMicrotask(() => stampCommit(commit));
  });
}
