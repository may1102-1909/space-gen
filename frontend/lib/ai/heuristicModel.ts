/**
 * Offline planner that speaks the same tool protocol as a real model: it reads the scene with
 * the read-only tools, picks a target and asset from keywords, asks the solver for positions,
 * checks drafts with validate_proposals and submits them. Used when no API key is configured
 * and as the deterministic model in the eval suite.
 */
import { parsePlacementCount, yawFacing, type Vec2 } from '@/lib/placement';
import type { GenerateJsonRequest, GenerateRequest, ModelTurn, SpatialModel, ToolCall, ToolResult } from './model';
import { descriptorsFromHint, type VisualDescriptors } from './vision';
import type { getRoomInterpretation, getSceneSummary, searchCatalogTool, solvePlacementTool, validateProposalsTool } from './tools';

type Summary = ReturnType<typeof getSceneSummary>;
type Room = ReturnType<typeof getRoomInterpretation>;
type Search = ReturnType<typeof searchCatalogTool>;
type Solve = Exclude<ReturnType<typeof solvePlacementTool>, { error: string }> & { error?: string };
type Check = ReturnType<typeof validateProposalsTool>;
type SceneItem = Summary['items'][number];
type Draft = Record<string, unknown> & { rationale: string };
interface Submission {
  message: string;
  proposals: Draft[];
}

/** Planner coroutine: yields tool calls, receives their results, returns the submission. */
type Plan = Generator<ToolCall[], Submission, ToolResult[]>;

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\bcoffee table\b/, 'coffee_table'],
  [/\bdining table\b/, 'dining_table'],
  [/\b(tv|media) (console|unit|stand)\b|\bconsole\b/, 'tv_console'],
  [/\barm ?chairs?\b/, 'armchair'],
  [/\bchairs?\b|\bseats?\b/, 'chair'],
  [/\bstools?\b/, 'stool'],
  [/\bsofas?\b|\bcouch(es)?\b/, 'sofa'],
  [/\bbeds?\b/, 'bed'],
  [/\bnightstands?\b/, 'nightstand'],
  [/\bdesks?\b/, 'desk'],
  [/\blamps?\b/, 'lamp'],
  [/\bplants?\b/, 'plant'],
  [/\bsideboards?\b|\bcabinets?\b|\bdressers?\b|\bbookcases?\b|\bshelf\b|\bshelves\b/, 'storage'],
  [/\btables?\b/, 'table'],
];

const STYLE_WORDS = ['scandinavian', 'minimalist', 'mid century', 'mid_century', 'leather', 'luxury', 'modern', 'industrial', 'velvet', 'boucle', 'oak', 'walnut', 'fabric', 'lounge', 'japandi', 'contemporary'];

/** Categories mentioned in `text`, in order of appearance. */
function categoriesIn(text: string): string[] {
  const hits: { at: number; category: string }[] = [];
  let rest = text.toLowerCase();
  for (const [re, category] of CATEGORY_WORDS) {
    const m = rest.match(re);
    if (m && m.index !== undefined) {
      hits.push({ at: m.index, category });
      rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.category);
}

const matchesCategory = (item: SceneItem, category: string) => {
  const c = item.category;
  const name = item.name.toLowerCase();
  if (category === 'table') return c.includes('table') || name.includes('table');
  if (category === 'chair') return c === 'chair' || c.endsWith('_chair') || /\bchair\b|armchair/.test(name);
  return c === category || c.endsWith(`_${category}`) || c.startsWith(`${category}_`) || name.includes(category.replace('_', ' '));
};

function findItem(items: SceneItem[], category: string, prompt: string, exclude: string[] = []): SceneItem | undefined {
  const pool = items.filter((i) => !exclude.includes(i.id) && matchesCategory(i, category));
  const p = prompt.toLowerCase();
  const side = ['left', 'right', 'north', 'south', 'east', 'west'].find((s) => p.includes(s));
  return (side && pool.find((i) => i.name.toLowerCase().includes(side))) || pool[0];
}

const fmt = (n: number) => n.toFixed(2);

/** Into-room normal of each compass wall, with north at -Z (the realistic_room convention). */
const COMPASS_INWARD: Record<string, [number, number]> = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] };

/** Wall named after the direction, else the wall whose into-room normal points that way. */
function compassWall(room: Room, side: string): Room['walls'][number] | undefined {
  const named = room.walls.find((w) => w.id.toLowerCase().includes(side));
  if (named) return named;
  const [nx, nz] = COMPASS_INWARD[side];
  const best = [...room.walls].sort((a, b) => b.inward[0] * nx + b.inward[1] * nz - (a.inward[0] * nx + a.inward[1] * nz))[0];
  return best && best.inward[0] * nx + best.inward[1] * nz > 0.7 ? best : undefined;
}

function styleWords(prompt: string): string[] {
  const p = prompt.toLowerCase();
  return STYLE_WORDS.filter((w) => p.includes(w)).map((w) => w.replace(' ', '_'));
}

function* plan(prompt: string): Plan {
  const p = prompt.toLowerCase();
  const [summaryRes, roomRes] = yield [
    { name: 'get_scene_summary', args: {} },
    { name: 'get_room_interpretation', args: {} },
  ];
  const summary = summaryRes.response as Summary;
  const room = roomRes.response as Room;
  const items = summary.items;
  const selected = items.find((i) => summary.selectedIds.includes(i.id));
  const mentioned = categoriesIn(p);
  const wantsUpload = !!summary.upload && /\b(this|uploaded|my) (model|glb|file|asset|one)\b|\bthis\b/.test(p);
  const wantsPhoto = !!summary.referencePhoto;

  const check = function* (drafts: Draft[]): Generator<ToolCall[], Check, ToolResult[]> {
    const [res] = yield [{ name: 'validate_proposals', args: { proposals: drafts } }];
    return res.response as Check;
  };

  if (/\b(paint|colou?r|finish|wallpaper|light(ing)?)\b/.test(p) && !mentioned.length) {
    return { message: 'Wall finishes, materials and lighting are not editable yet; I can add, move, replace or remove furniture.', proposals: [] };
  }

  // remove
  if (/\b(remove|delete|get rid of|take out)\b/.test(p)) {
    const target = (/\b(this|it|selected)\b/.test(p) && selected) || (mentioned[0] ? findItem(items, mentioned[0], p) : selected);
    if (!target) return { message: 'I could not find the item to remove.', proposals: [] };
    return {
      message: `Proposed removing "${target.name}".`,
      proposals: [{ op: 'remove', targetNodeId: target.id, rationale: `Removes "${target.name}" (${target.category}) as requested, freeing ${fmt(target.dimensions.width)} x ${fmt(target.dimensions.depth)} m of floor.` }],
    };
  }

  // replace / swap
  if (/\b(replace|swap|change|exchange)\b/.test(p)) {
    const named = mentioned.find((c) => items.some((i) => matchesCategory(i, c)));
    const target = (/\b(selected|it)\b/.test(p) && selected) || (named ? findItem(items, named, p) : selected);
    if (!target) return { message: 'I could not tell which item to replace; select it or name it.', proposals: [] };

    let asset: { source: string; url: string; dimensions: { width: number; height: number; depth: number } } | undefined;
    let assetName = '';
    let assetId: string | undefined;
    let why = '';
    if (summary.upload && (wantsUpload || !wantsPhoto)) {
      asset = { source: 'upload', url: summary.upload.url, dimensions: summary.upload.dimensions };
      assetName = summary.upload.name;
      why = `uses your uploaded model (${fmt(asset.dimensions.width)} x ${fmt(asset.dimensions.height)} x ${fmt(asset.dimensions.depth)} m measured)`;
    } else {
      const hint = descriptorsFromHint(p.replace(/.*\bwith\b/, ''));
      const [res] = yield [
        {
          name: 'search_catalog',
          args: wantsPhoto
            ? { useReferencePhoto: true }
            : {
                category: mentioned.length > 1 ? mentioned[mentioned.length - 1] : target.category,
                styleTags: styleWords(p).length ? styleWords(p) : hint.styleTags,
                dimensions: [target.dimensions.width, target.dimensions.height, target.dimensions.depth],
                text: p,
              },
        },
      ];
      const best = (res.response as Search).matches[0];
      if (!best) return { message: `No catalog item matches the ${target.category} you described.`, proposals: [] };
      asset = { source: 'catalog', url: best.url, dimensions: best.dimensions };
      assetName = best.name;
      assetId = best.assetId;
      why = wantsPhoto ? `is the closest catalog match to your photo (${best.reasons.join(', ')})` : `matches "${best.reasons.join(', ')}"`;
    }

    const inPlace: Draft = {
      op: 'replace',
      targetNodeId: target.id,
      asset,
      transform: { position: target.position, rotationY: target.rotationY, scale: [1, 1, 1] },
      rationale: `Replaces "${target.name}" with "${assetName}" in the same spot and orientation; it ${why}.`,
    };
    const verdict = yield* check([inPlace]);
    if (verdict.results[0]?.ok) return { message: `Proposed replacing "${target.name}" with "${assetName}".`, proposals: [inPlace] };

    // Does not fit in place: let the solver find the nearest valid spot.
    const [solveRes] = yield [
      { name: 'solve_placement', args: { op: 'replace', targetNodeId: target.id, ...(asset.source === 'upload' ? { useUpload: true } : { assetId }), category: target.category } },
    ];
    const solved = solveRes.response as Solve;
    const slot = solved.layouts?.[0]?.proposals[0];
    if (!slot) return { message: `"${assetName}" does not fit where "${target.name}" stands and the solver found no free spot.`, proposals: [] };
    const blocked = verdict.results[0]?.violations.find((v) => v.severity === 'error')?.detail ?? 'it collides in place';
    return {
      message: `Proposed replacing "${target.name}" with "${assetName}", shifted to fit.`,
      proposals: [{ ...slot, rationale: `Replaces "${target.name}" with "${assetName}"; it ${why}. Shifted because in place ${blocked}. ${slot.rationale}` } as Draft],
    };
  }

  // move / rotate
  if (/\b(move|shift|push|slide|put|rotate|turn)\b/.test(p) && mentioned.length && !/\badd\b/.test(p)) {
    const target = (/\b(it|this|selected)\b/.test(p) && selected) || findItem(items, mentioned[0], p);
    if (!target) return { message: `I could not find a ${mentioned[0]} to move.`, proposals: [] };
    const other = mentioned.slice(1).map((c) => findItem(items, c, p, [target.id])).find(Boolean);

    if (/\b(rotate|turn|face|facing)\b/.test(p) && other) {
      const yaw = yawFacing([other.position[0] - target.position[0], other.position[2] - target.position[2]]);
      const draft: Draft = {
        op: 'move',
        targetNodeId: target.id,
        transform: { position: target.position, rotationY: Number(yaw.toFixed(3)), scale: [1, 1, 1] },
        rationale: `Turns "${target.name}" in place to face "${other.name}" for a direct sight line.`,
      };
      return { message: `Proposed turning "${target.name}" toward "${other.name}".`, proposals: [draft] };
    }

    if (/\bcloser\b|\bnearer\b|\btowards?\b/.test(p) && other) {
      const step = Number(p.match(/(\d+(?:\.\d+)?)\s*m\b/)?.[1] ?? 0.5);
      const d: Vec2 = [other.position[0] - target.position[0], other.position[2] - target.position[2]];
      const dist = Math.hypot(d[0], d[1]) || 1;
      for (const s of [step, step * 0.6, step * 0.3]) {
        const k = Math.min(s / dist, 0.5);
        const position = [Number((target.position[0] + d[0] * k).toFixed(3)), target.position[1], Number((target.position[2] + d[1] * k).toFixed(3))];
        const draft: Draft = {
          op: 'move',
          targetNodeId: target.id,
          transform: { position, rotationY: target.rotationY, scale: [1, 1, 1] },
          rationale: `Moves "${target.name}" ${fmt(s)} m toward "${other.name}" (gap now ${fmt(dist - s)} m center to center), keeping its orientation.`,
        };
        const verdict = yield* check([draft]);
        if (verdict.results[0]?.ok) return { message: `Proposed moving "${target.name}" closer to "${other.name}".`, proposals: [draft] };
      }
      return { message: `"${target.name}" cannot get closer to "${other.name}" without a collision.`, proposals: [] };
    }

    const wallArgs: Record<string, unknown> = { op: 'move', targetNodeId: target.id };
    let where = '';
    if (/\bwall\b/.test(p)) {
      wallArgs.strategy = 'along-wall';
      const side = ['north', 'south', 'east', 'west'].find((s) => p.includes(s));
      const sideWall = side ? compassWall(room, side) : undefined;
      if (sideWall) {
        wallArgs.wallId = sideWall.id;
        where = `against wall ${sideWall.id}`;
      } else if (/\blong(est)?\b/.test(p) && room.longestWallId) {
        wallArgs.wallId = room.longestWallId;
        const len = room.walls.find((w) => w.id === room.longestWallId)?.length ?? 0;
        where = `against the longest wall (${room.longestWallId}, ${fmt(len)} m)`;
      } else if (/\bshort(est)?\b/.test(p)) {
        const shortest = [...room.walls].sort((a, b) => a.length - b.length)[0];
        wallArgs.wallId = shortest?.id;
        where = `against the shortest wall (${shortest?.id})`;
      } else where = 'against a wall';
    } else if (other) {
      wallArgs.anchorId = other.id;
      where = `next to "${other.name}"`;
    }
    const [res] = yield [{ name: 'solve_placement', args: wallArgs }];
    const solved = res.response as Solve;
    let layout = solved.layouts?.[0];
    if (!layout && wallArgs.wallId) {
      // That wall has no free span (e.g. a door in the way); fall back to any wall.
      const [retry] = yield [{ name: 'solve_placement', args: { ...wallArgs, wallId: undefined } }];
      layout = (retry.response as Solve).layouts?.[0];
      where = `${where}; that wall is blocked, so the best free wall`;
    }
    const slot = layout?.proposals[0];
    if (!slot) return { message: `No valid spot found for "${target.name}" ${where}.`, proposals: [] };
    return {
      message: `Proposed moving "${target.name}" ${where}.`,
      proposals: [{ ...slot, rationale: `Moves "${target.name}" ${where}. ${slot.rationale}` } as Draft],
    };
  }

  // add / place
  if (/\b(add|place|put|arrange|spawn|bring|insert)\b/.test(p)) {
    const count = parsePlacementCount(p, 1);
    const anchorWord = p.match(/\b(?:around|at|by|next to|beside|near)\s+(?:the\s+)?([a-z ]+)/)?.[1] ?? '';
    const anchorCat = categoriesIn(anchorWord)[0];
    const newCat = mentioned.find((c) => c !== anchorCat) ?? summary.upload?.name.split(/[^a-z]/i)[0]?.toLowerCase() ?? 'chair';
    const anchor = anchorCat ? findItem(items, anchorCat === 'table' && /dining/.test(p + newCat) ? 'dining_table' : anchorCat, p) ?? findItem(items, anchorCat, p) : undefined;

    const solveArgs: Record<string, unknown> = { op: 'add', count, category: newCat === 'armchair' ? 'armchair' : newCat };
    let assetName = '';
    if (summary.upload && wantsUpload) {
      solveArgs.useUpload = true;
      assetName = summary.upload.name;
    } else {
      const [res] = yield [
        {
          name: 'search_catalog',
          args: wantsPhoto ? { useReferencePhoto: true } : { category: /dining/.test(p) && newCat === 'chair' ? 'chair' : newCat, styleTags: styleWords(p).length ? styleWords(p) : /dining/.test(p) ? ['dining_chair'] : [], text: p },
        },
      ];
      const best = (res.response as Search).matches[0];
      if (!best) return { message: `The catalog has no ${newCat}.`, proposals: [] };
      solveArgs.assetId = best.assetId;
      assetName = best.name;
    }
    if (anchor) solveArgs.anchorId = anchor.id;
    if (/\bwall\b/.test(p)) solveArgs.strategy = 'along-wall';
    else if (/\bfacing\b|\bface\b/.test(p)) solveArgs.strategy = 'facing-focal';
    // "around the table" means grouped at the table, even if fewer seats fit than a wall row would hold.
    else if (anchor) solveArgs.strategy = 'around-anchor';

    const [res] = yield [{ name: 'solve_placement', args: solveArgs }];
    let layout = (res.response as Solve).layouts?.[0];
    if (!layout && solveArgs.strategy) {
      const [retry] = yield [{ name: 'solve_placement', args: { ...solveArgs, strategy: undefined } }];
      layout = (retry.response as Solve).layouts?.[0];
    }
    if (!layout) return { message: `No collision-free spot for ${count} x "${assetName}".`, proposals: [] };
    const short = layout.placed < count ? ` Only ${layout.placed} of ${count} fit without collisions.` : '';
    return {
      message: `Proposed ${layout.placed} x "${assetName}"${anchor ? ` around "${anchor.name}"` : ''}.${short}`,
      proposals: layout.proposals.map((d, i) => ({ ...d, rationale: `Adds "${assetName}" #${i + 1}${anchor ? ` at "${anchor.name}"` : ''}. ${d.rationale}` }) as Draft),
    };
  }

  return { message: 'I can add, move, replace or remove furniture. Try "add 2 chairs around the dining table".', proposals: [] };
}

export class HeuristicModel implements SpatialModel {
  readonly name = 'heuristic';
  private planner: Plan | null = null;

  /** `vision` fixes the reference-photo answer (tests); otherwise it is read from the user's words. */
  constructor(private readonly options: { vision?: VisualDescriptors } = {}) {}

  async generate(request: GenerateRequest): Promise<ModelTurn> {
    const last = request.messages[request.messages.length - 1];
    let step: IteratorResult<ToolCall[], Submission>;
    if (!this.planner) {
      const first = request.messages.find((m) => m.role === 'user');
      const text = first && first.role === 'user' ? first.text.split('\n')[0].replace(/^User request:\s*/, '') : '';
      this.planner = plan(text);
      step = this.planner.next(undefined as unknown as ToolResult[]);
    } else {
      step = this.planner.next(last.role === 'tool' ? last.results : []);
    }
    if (step.done) return { toolCalls: [{ name: 'submit_proposals', args: step.value as unknown as Record<string, unknown> }] };
    return { toolCalls: step.value };
  }

  async generateJson(request: GenerateJsonRequest) {
    const first = request.messages.find((m) => m.role === 'user');
    // Vision without a vision model: read the descriptors from the user's words.
    if (first && first.role === 'user' && first.image) return { value: this.options.vision ?? descriptorsFromHint(first.text) };
    return { value: { message: 'No proposals.', proposals: [] } };
  }
}
