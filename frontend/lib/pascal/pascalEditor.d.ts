import type { FC } from 'react';

/** The subset of @pascal-app/editor this app uses (see pascalEditor.js). */
export type EditorMode = 'select' | 'edit' | 'delete' | 'build' | 'material-paint' | 'terrain-sculpt';
export type ToolMode = { mode: 'select' } | { mode: 'build'; tool: string };

export interface EditorState {
  mode: EditorMode;
  tool: string | null;
  setPhase: (phase: 'site' | 'building') => void;
  armToolMode: (next: ToolMode) => void;
  setSnappingMode: (context: 'wall' | 'item' | 'polygon' | 'rotation', mode: 'grid' | 'lines' | 'angles' | 'off') => void;
  setContinuation: (context: 'wall' | 'fence' | 'point' | 'cabinet' | 'canopy', mode: string) => void;
}

export declare const useEditor: {
  <T>(selector: (state: EditorState) => T): T;
  getState: () => EditorState;
};
/** Interactive drafting plane: raycasts the pointer and emits grid:move / grid:click. */
export declare const Grid: FC;
/** Mounts the active registry build tool (wall / slab / door / window / …). */
export declare const ToolManager: FC;
