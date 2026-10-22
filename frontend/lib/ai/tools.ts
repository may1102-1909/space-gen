/**
 * Read-only tools for the spatial agent. Every tool reads a plain snapshot (AgentContext) built
 * from Pascal nodes and the room interpretation; none can change the scene. The only way the
 * agent produces output is `submit_proposals`, whose arguments are EditProposal drafts that the
 * executor validates and returns for the user to accept.
 */
import type { RoomInterpretation } from '@/lib/contracts';
import {
  buildRoom,
  categoryIs,
  solvePlacement,
  type PlacementAssetSpec,
  type PlacementScene,
  type PlacementStrategy,
  type Vec2,
} from '@/lib/placement';
import { searchCatalog, type CatalogEntry } from './catalog';
import type { JsonSchema, ToolSpec } from './model';
import { finalizeProposals } from './proposals';
import type { VisualDescriptors } from './vision';

export interface UploadedAsset {
  name: string;
  /** Project asset-store or catalog URL; proposals reference it. */
  url: string;
  dimensions: [number, number, number];
  category?: string;
}

export interface AgentContext {
  scene: PlacementScene;
  interpretation: RoomInterpretation;
  /** 'scan' = interpretation from the scan pipeline; 'pascal' = derived from Pascal wall/door/slab nodes. */
  interpretationSource: 'scan' | 'pascal';
  catalog: CatalogEntry[];
  selectedIds: string[];
  upload?: UploadedAsset;
  reference?: VisualDescriptors;
}

export const SUBMIT_TOOL = 'submit_proposals';

const vec3 = (description: string): JsonSchema => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description });

export const PROPOSAL_DRAFT_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['add', 'move', 'replace', 'remove'] },
    targetNodeId: { type: 'string', description: 'Pascal item id being moved/replaced/removed; omit for add' },
    asset: {
      type: 'object',
      description: 'Required for add and replace',
      properties: {
        source: { type: 'string', enum: ['catalog', 'upload', 'generated'] },
        url: { type: 'string' },
        dimensions: {
          type: 'object',
          properties: { width: { type: 'number' }, height: { type: 'number' }, depth: { type: 'number' } },
          required: ['width', 'height', 'depth'],
        },
      },
      required: ['source', 'url', 'dimensions'],
    },
    transform: {
      type: 'object',
      description: 'Required for add and move. position is the base center [x, 0, z] (Y-up, meters, floor y=0)',
      properties: {
        position: vec3('[x, y, z] base center in meters'),
        rotationY: { type: 'number', description: 'yaw in radians; front faces local +Z' },
        scale: vec3('[sx, sy, sz]; use [1, 1, 1]'),
      },
      required: ['position', 'rotationY', 'scale'],
    },
    rationale: { type: 'string', description: 'One or two sentences: what changes and why it fits the room' },
  },
  required: ['op', 'rationale'],
};

export const SUBMISSION_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Short reply to the user summarising the proposals' },
    proposals: { type: 'array', items: PROPOSAL_DRAFT_JSON_SCHEMA },
  },
  required: ['message', 'proposals'],
};

export const SPATIAL_TOOLS: ToolSpec[] = [
  {
    name: 'get_scene_summary',
    description:
      'Editable Pascal items (id, name, category, base position, yaw, size), the current selection, and any uploaded model or analysed reference photo.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_room_interpretation',
    description:
      'Room structure: walls (with length and into-room normal), doors/windows, ceiling height and scan detections. Trusted (user-verified) elements are listed first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'search_catalog',
    description: 'Rank catalog furniture by similarity. Set useReferencePhoto to search with the analysed photo descriptors.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        category: { type: 'string' },
        styleTags: { type: 'array', items: { type: 'string' } },
        colorHex: { type: 'string' },
        dimensions: vec3('target size [w, h, d] meters'),
        useReferencePhoto: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'solve_placement',
    description:
      'Run the placement solver. For add: give assetId (catalog) or useUpload, a category and count. For move: give op "move" and targetNodeId. Returns validated layouts with ready proposal drafts.',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['add', 'move', 'replace'] },
        assetId: { type: 'string', description: 'catalog entry id' },
        useUpload: { type: 'boolean', description: 'place the uploaded GLB' },
        targetNodeId: { type: 'string', description: 'item to move or replace' },
        category: { type: 'string' },
        count: { type: 'number' },
        anchorId: { type: 'string', description: 'item to group around, e.g. a dining table' },
        strategy: { type: 'string', enum: ['around-anchor', 'along-wall', 'facing-focal'] },
        wallId: { type: 'string', description: 'restrict along-wall layouts to this wall' },
      },
    },
  },
  {
    name: 'validate_proposals',
    description: 'Check drafts against the placement rules (overlap, walls, doors, walkways) without submitting them.',
    parameters: { type: 'object', properties: { proposals: { type: 'array', items: PROPOSAL_DRAFT_JSON_SCHEMA } }, required: ['proposals'] },
  },
  {
    name: SUBMIT_TOOL,
    description: 'Finish: submit EditProposal drafts for the user to review. Call exactly once, after reading the scene.',
    parameters: SUBMISSION_JSON_SCHEMA,
  },
];

export const READ_ONLY_TOOL_NAMES = SPATIAL_TOOLS.map((t) => t.name).filter((n) => n !== SUBMIT_TOOL);

const r2 = (n: number) => Number(n.toFixed(3));

function itemSummary(ctx: AgentContext) {
  return ctx.scene.items.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    position: [r2(i.obb.center[0]), r2(i.obb.center[1] - i.obb.size[1] / 2), r2(i.obb.center[2])],
    rotationY: r2(i.obb.yaw),
    dimensions: { width: r2(i.obb.size[0]), height: r2(i.obb.size[1]), depth: r2(i.obb.size[2]) },
    attachTo: i.attachTo ?? 'floor',
  }));
}

export function getSceneSummary(ctx: AgentContext) {
  return {
    frame: 'Y-up, meters, floor y=0; positions are base centers [x, y, z]; yaw radians, front faces local +Z',
    items: itemSummary(ctx),
    selectedIds: ctx.selectedIds,
    upload: ctx.upload
      ? { name: ctx.upload.name, url: ctx.upload.url, dimensions: { width: ctx.upload.dimensions[0], height: ctx.upload.dimensions[1], depth: ctx.upload.dimensions[2] } }
      : null,
    referencePhoto: ctx.reference ?? null,
  };
}

const trustRank = (provenance: string, status?: string) =>
  provenance === 'user' || status === 'verified' || status === 'corrected' ? 0 : 1;

export function getRoomInterpretation(ctx: AgentContext) {
  const room = buildRoom(ctx.interpretation);
  const byId = new Map(ctx.interpretation.walls.map((w) => [w.id, w]));
  const walls = room.walls
    .map((w) => {
      const src = byId.get(w.id);
      return {
        id: w.id,
        start: w.a.map(r2),
        end: w.b.map(r2),
        length: r2(w.length),
        inward: w.inward.map(r2),
        trusted: src ? trustRank(src.provenance) === 0 : false,
        confidence: src?.confidence ?? 1,
      };
    })
    .sort((a, b) => Number(b.trusted) - Number(a.trusted) || b.confidence - a.confidence);
  const longest = [...walls].sort((a, b) => b.length - a.length)[0];
  return {
    source: ctx.interpretationSource,
    ceilingHeight: ctx.interpretation.ceilingHeight,
    outline: ctx.interpretation.outline,
    longestWallId: longest?.id ?? null,
    walls,
    openings: ctx.interpretation.openings
      .map((o) => ({ id: o.id, wallId: o.wallId, kind: o.kind, centerOffset: o.offset, width: o.width, trusted: trustRank(o.provenance) === 0, confidence: o.confidence }))
      .sort((a, b) => Number(b.trusted) - Number(a.trusted)),
    detections: ctx.interpretation.detections
      .filter((d) => d.status !== 'rejected')
      .map((d) => ({ id: d.id, category: d.category, label: d.label, status: d.status, center: d.obb.center.map(r2), size: d.obb.size.map(r2), yaw: r2(d.obb.yaw) }))
      .sort((a, b) => trustRank('auto', a.status) - trustRank('auto', b.status)),
    note: 'Detections are scan evidence; edit Pascal items (ids from get_scene_summary).',
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
const tuple3 = (v: unknown): [number, number, number] | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? (v as [number, number, number]) : undefined;

export function searchCatalogTool(ctx: AgentContext, args: Record<string, unknown>) {
  const ref = args.useReferencePhoto ? ctx.reference : undefined;
  const matches = searchCatalog(ctx.catalog, {
    text: str(args.text),
    category: str(args.category) ?? ref?.category,
    styleTags: strList(args.styleTags) ?? ref?.styleTags,
    colorHex: str(args.colorHex) ?? ref?.primaryColorHex,
    dimensions: tuple3(args.dimensions) ?? ref?.estimatedDimensions,
    limit: num(args.limit) ?? 5,
  });
  return {
    matches: matches.map((m) => ({
      assetId: m.entry.id,
      name: m.entry.name,
      category: m.entry.category,
      url: m.entry.url,
      dimensions: m.entry.dimensions,
      score: m.score,
      reasons: m.reasons,
    })),
  };
}

export function solvePlacementTool(ctx: AgentContext, args: Record<string, unknown>) {
  const op = (str(args.op) ?? (args.targetNodeId && !args.assetId && !args.useUpload ? 'move' : 'add')) as 'add' | 'move' | 'replace';
  const target = str(args.targetNodeId) ? ctx.scene.items.find((i) => i.id === args.targetNodeId) : undefined;
  if (op !== 'add' && !target) return { error: `targetNodeId "${String(args.targetNodeId ?? '')}" is not an item in the scene` };

  let asset: PlacementAssetSpec;
  let source: 'catalog' | 'upload' = 'catalog';
  if (op === 'move') {
    const [width, height, depth] = target!.obb.size;
    asset = { url: '', name: target!.name, category: target!.category, dimensions: { width, height, depth } };
  } else if (args.useUpload) {
    if (!ctx.upload) return { error: 'No uploaded model in this request' };
    const [width, height, depth] = ctx.upload.dimensions;
    source = 'upload';
    asset = { url: ctx.upload.url, name: ctx.upload.name, category: str(args.category) ?? ctx.upload.category ?? target?.category ?? 'item', dimensions: { width, height, depth }, source };
  } else {
    const entry = ctx.catalog.find((e) => e.id === args.assetId);
    if (!entry) return { error: `assetId "${String(args.assetId ?? '')}" is not in the catalog; call search_catalog first` };
    asset = { url: entry.url, name: entry.name, category: str(args.category) ?? entry.category, dimensions: entry.dimensions, source };
  }

  const count = op === 'add' ? Math.max(1, Math.min(12, Math.floor(num(args.count) ?? 1))) : 1;
  const scene: PlacementScene = target ? { items: ctx.scene.items.filter((i) => i.id !== target.id) } : ctx.scene;
  const strategy = str(args.strategy) as PlacementStrategy | undefined;
  const wallId = str(args.wallId);
  const layouts = solvePlacement({ asset, count, anchorId: str(args.anchorId), topK: 50 }, scene, ctx.interpretation)
    .filter((l) => !strategy || l.strategy === strategy)
    .filter((l) => !wallId || l.id === `along-wall:${wallId}`)
    .filter((l) => op === 'add' || l.placements.length > 0);

  // For a single moved/replaced item, prefer slots near where it stands now.
  const origin: Vec2 | undefined = target ? [target.obb.center[0], target.obb.center[2]] : undefined;
  const dist = (p: [number, number, number]) => (origin ? Math.hypot(p[0] - origin[0], p[2] - origin[1]) : 0);
  const ranked = op === 'add' ? layouts : [...layouts].sort((a, b) => b.score - a.score || dist(a.placements[0].position) - dist(b.placements[0].position));

  return {
    asset: { url: asset.url || null, category: asset.category, dimensions: asset.dimensions, source },
    layouts: ranked.slice(0, 3).map((l) => ({
      layoutId: l.id,
      strategy: l.strategy,
      score: l.score,
      placed: l.placements.length,
      requested: count,
      reasons: l.reasons,
      proposals: l.placements.map((slot) => ({
        op,
        targetNodeId: op === 'add' ? undefined : target!.id,
        asset: op === 'move' ? undefined : { source, url: asset.url, dimensions: asset.dimensions },
        transform: { position: slot.position.map(r2), rotationY: r2(slot.rotationY), scale: [1, 1, 1] },
        rationale: [l.reasons[0], ...slot.reasons].join('. '),
      })),
    })),
  };
}

/** Dry-run of the executor's validation for drafts the model is considering. */
export function validateProposalsTool(ctx: AgentContext, args: Record<string, unknown>) {
  const drafts = Array.isArray(args.proposals) ? args.proposals : [];
  const { proposals, rejectedDrafts } = finalizeProposals(ctx, drafts, 'check');
  return {
    results: proposals.map((p) => ({
      op: p.op,
      targetNodeId: p.targetNodeId ?? null,
      ok: p.validation.ok,
      violations: p.validation.violations.map((v) => ({ rule: v.rule, severity: v.severity, detail: v.detail })),
    })),
    malformed: rejectedDrafts.map((r) => r.error),
  };
}

/** Finds scene items whose category or name mentions `word` (e.g. "chair" matches "armchair" items named "Lounge Armchair"). */
export function itemsMatching(ctx: AgentContext, word: string) {
  const w = word.toLowerCase();
  return ctx.scene.items.filter((i) => categoryIs(i.category, w) || i.category.includes(w) || i.name.toLowerCase().includes(w));
}

/** Runs one read-only tool. Unknown names (including any attempt at a mutating tool) return an error result. */
export function runReadTool(ctx: AgentContext, name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'get_scene_summary':
      return getSceneSummary(ctx);
    case 'get_room_interpretation':
      return getRoomInterpretation(ctx);
    case 'search_catalog':
      return searchCatalogTool(ctx, args);
    case 'solve_placement':
      return solvePlacementTool(ctx, args);
    case 'validate_proposals':
      return validateProposalsTool(ctx, args);
    default:
      return { error: `Unknown tool "${name}". Available: ${READ_ONLY_TOOL_NAMES.join(', ')}, ${SUBMIT_TOOL}` };
  }
}
