import { useMemo } from 'react';
import { useScene } from '@pascal-app/core';
import { useNavigation } from './navigationStore';
import { extractRoomVolume, navSignature, resolveSceneKind, type NavNode, type RoomVolume, type SceneKind } from './room';

export interface RoomNavigation {
  room: RoomVolume | null;
  detected: SceneKind;
  kind: SceneKind;
  /** The room volume to confine to: only for interior scenes that actually have a room. */
  confinement: RoomVolume | null;
}

/** The scene's room, its auto-detected kind, and the effective kind after the manual override. */
export function useRoomNavigation(): RoomNavigation {
  const signature = useScene((state) => navSignature(state.nodes as unknown as Record<string, NavNode | undefined>));
  const override = useNavigation((state) => state.sceneKindOverride);
  const room = useMemo(() => extractRoomVolume(Object.fromEntries((JSON.parse(signature) as NavNode[]).map((n, i) => [String(i), n]))), [signature]);
  const detected: SceneKind = room ? 'interior' : 'exterior';
  const kind = resolveSceneKind(override, detected);
  return { room, detected, kind, confinement: kind === 'interior' ? room : null };
}
