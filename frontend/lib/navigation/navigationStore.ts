import { create } from 'zustand';
import type { SceneKind } from './room';

export type ViewMode = 'splat' | 'mesh' | 'both';
export type NavMode = 'orbit' | 'walk';

/** What each view mode shows. Splat keeps the Pascal layer mounted (collision, picking) but invisible. */
export function viewModeLayers(mode: ViewMode): { splat: boolean; pascal: boolean } {
  return { splat: mode !== 'mesh', pascal: mode !== 'splat' };
}

interface NavigationState {
  viewMode: ViewMode;
  navMode: NavMode;
  /** Manual interior/exterior choice; null means auto-detect. Persisted in the manifest by the editor. */
  sceneKindOverride: SceneKind | null;
  setViewMode: (mode: ViewMode) => void;
  setNavMode: (mode: NavMode) => void;
  setSceneKindOverride: (kind: SceneKind | null) => void;
}

/** Per-session navigation state (view mode and nav mode are deliberately not saved). */
export const useNavigation = create<NavigationState>((set) => ({
  viewMode: 'both',
  navMode: 'orbit',
  sceneKindOverride: null,
  setViewMode: (viewMode) => set({ viewMode }),
  setNavMode: (navMode) => set({ navMode }),
  setSceneKindOverride: (sceneKindOverride) => set({ sceneKindOverride }),
}));
