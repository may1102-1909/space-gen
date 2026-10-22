'use client';

import { useMemo, useState } from 'react';
import { useScene } from '@pascal-app/core';
import { extractDrawingModel } from '@/lib/drawings/model';
import { renderPlanSvg } from '@/lib/drawings/plan';
import { renderElevationSvg } from '@/lib/drawings/elevation';
import type { DrawingScale } from '@/lib/drawings/svg';

const PRINT_CSS = `@media print {
  @page { margin: 8mm; }
  body * { visibility: hidden !important; }
  .drawing-sheet, .drawing-sheet * { visibility: visible !important; }
  .drawing-sheet { position: fixed; left: 0; top: 0; }
}`;

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawing';
}

/** Read-only plan and elevation sheets generated live from the Pascal scene. */
export function DrawingsPanel({ projectName, onClose }: { projectName: string; onClose: () => void }) {
  const nodes = useScene((s) => s.nodes);
  const model = useMemo(() => extractDrawingModel(nodes), [nodes]);
  const [tab, setTab] = useState<'plan' | 'elevation'>('plan');
  const [scale, setScale] = useState<DrawingScale>(50);
  const [wallId, setWallId] = useState<string>('');
  const activeWall = model.walls.find((w) => w.id === wallId) ?? model.walls[0];
  const date = new Date().toISOString().slice(0, 10);

  const svg = useMemo(() => {
    if (!model.walls.length) return '';
    const opts = { scale, projectName, date };
    return tab === 'plan' ? renderPlanSvg(model, opts) : activeWall ? renderElevationSvg(model, activeWall.id, opts) : '';
  }, [model, tab, scale, projectName, date, activeWall]);

  const exportSvg = () => {
    const name = tab === 'plan' ? 'plan' : `elevation-${slug(activeWall?.name ?? 'wall')}`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${slug(projectName)}-${name}-1-${scale}.svg` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const tabClass = (on: boolean) => `rounded px-3 py-1 ${on ? 'bg-accent text-white' : 'border border-border'}`;
  return (
    <section role="region" aria-label="Drawings" className="fixed inset-0 z-[60] flex flex-col bg-background">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 text-sm">
        <span className="mr-2 font-semibold">Drawings</span>
        <div role="tablist" className="flex gap-1">
          <button role="tab" aria-selected={tab === 'plan'} onClick={() => setTab('plan')} className={tabClass(tab === 'plan')}>Plan</button>
          <button role="tab" aria-selected={tab === 'elevation'} onClick={() => setTab('elevation')} className={tabClass(tab === 'elevation')}>Elevations</button>
        </div>
        {tab === 'elevation' && model.walls.length > 0 && (
          <label className="flex items-center gap-1">Wall
            <select aria-label="Elevation wall" value={activeWall?.id} onChange={(e) => setWallId(e.target.value)} className="rounded border border-border bg-surface px-2 py-1">
              {model.walls.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1">Scale
          <select aria-label="Scale" value={scale} onChange={(e) => setScale(Number(e.target.value) as DrawingScale)} className="rounded border border-border bg-surface px-2 py-1">
            <option value={50}>1:50</option>
            <option value={100}>1:100</option>
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={exportSvg} disabled={!svg} className="rounded border border-border px-3 py-1 disabled:opacity-50">Export SVG</button>
          <button onClick={() => window.print()} disabled={!svg} className="rounded border border-border px-3 py-1 disabled:opacity-50">Print / PDF</button>
          <button onClick={onClose} className="rounded bg-accent px-3 py-1 text-white">Close</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-neutral-500/30 p-6">
        {svg ? (
          // Generated locally from scene data; every node-supplied string is XML-escaped in lib/drawings/svg.ts.
          <div data-testid="drawing-sheet" className="drawing-sheet mx-auto w-fit bg-white shadow-lg" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="text-text-muted">No walls in the scene yet. Build the editable room from the scan (Review scan) or draw walls first.</p>
        )}
      </div>
    </section>
  );
}
