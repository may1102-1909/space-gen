import { loadPlugin, nodeRegistry, type AnyNodeDefinition } from '@pascal-app/core';
import { builtinPlugin } from '@pascal-app/nodes';

/**
 * Pascal's built-ins with one swap: `measurement` keeps Pascal's schema and behaviour but uses
 * our tool (scan-snapped input) and renderer (values shown as scan estimates).
 */
const spaceGenPlugin = {
  ...builtinPlugin,
  nodes: builtinPlugin.nodes?.map((def): AnyNodeDefinition =>
    def.kind === 'measurement'
      ? {
          ...def,
          tool: () => import('@/components/viewer/MeasureTool'),
          renderer: { kind: 'parametric', module: () => import('@/components/viewer/EstimateMeasurementRenderer') as Promise<any> },
        }
      : def,
  ),
};

let initPromise: Promise<void> | null = null;
let isInitialized = false;

/**
 * Idempotently initializes Pascal Core and loads the built-in node plugin.
 * Registers standard nodes: wall, slab, ceiling, roof, zone, item, scan, guide, etc.
 * Must run on the client before <Viewer> or <Editor> renders.
 */
export async function ensurePascalInitialized(): Promise<void> {
  if (isInitialized) {
    return;
  }

  if (typeof window === 'undefined') {
    // SSR guard: do not load plugins on the server
    return;
  }

  if (!initPromise) {
    initPromise = (async () => {
      try {
        await loadPlugin(spaceGenPlugin);
        isInitialized = true;
      } catch (error) {
        initPromise = null;
        console.error('[Pascal] Failed to initialize Pascal builtin plugin:', error);
        throw error;
      }
    })();
  }

  return initPromise;
}

/**
 * Returns whether Pascal builtin plugins have completed initialization.
 */
export function isPascalInitialized(): boolean {
  return isInitialized;
}

/**
 * Returns the list of currently registered node types from nodeRegistry.
 */
export function getRegisteredNodeTypes(): string[] {
  return Array.from(nodeRegistry.entries()).map(([kind]) => kind);
}

/**
 * Checks if a specific node kind is registered in the nodeRegistry.
 */
export function hasRegisteredNodeType(kind: string): boolean {
  return nodeRegistry.has(kind);
}
