// @pascal-app/editor ships uncompiled TypeScript that does not type-check under this app's
// tsconfig, so the app reaches it through this module and the typed surface in pascalEditor.d.ts.
export { Grid, ToolManager, useEditor, usePlacementPreview } from '@pascal-app/editor';
