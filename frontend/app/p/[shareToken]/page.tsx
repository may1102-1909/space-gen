'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Pause, Play } from 'lucide-react';
import { loadSharedProject } from '@/lib/presentation/api';
import { catalogProductLinks, listItems, resolveVariants, safeWebUrl, type SharedProject } from '@/lib/presentation/model';
import { AUTOPLAY_INTERVAL_MS, jumpTo, poseOf, stepTour, togglePlay, type TourState } from '@/lib/presentation/tour';
import { formatMeasurement } from '@/lib/measurement/accuracy';

const PresentationViewer = dynamic(() => import('@/components/presentation/PresentationViewer'), { ssr: false });

/** Read-only client presentation. Nothing here can write: the share token only unlocks GET. */
export default function PresentationPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [project, setProject] = useState<SharedProject | null>(null);
  const [error, setError] = useState('');
  const [catalogLinks, setCatalogLinks] = useState<Record<string, string>>({});
  const [variantId, setVariantId] = useState<string | null>(null);
  const [tour, setTour] = useState<TourState>({ index: 0, playing: false });
  const [stops, setStops] = useState(0);

  useEffect(() => {
    let alive = true;
    loadSharedProject(shareToken).then((p) => alive && setProject(p)).catch((e: Error) => alive && setError(e.message));
    fetch('/catalog/catalogManifest.json').then((r) => r.json()).then((m) => alive && setCatalogLinks(catalogProductLinks(m))).catch(() => {});
    return () => { alive = false; };
  }, [shareToken]);

  const variants = useMemo(() => (project ? resolveVariants(project) : []), [project]);
  const variant = variants.find((v) => v.id === variantId) ?? variants.find((v) => v.id === project?.activeVariantId) ?? variants[0];
  const viewpoints = project?.viewpoints ?? [];
  const count = viewpoints.length;
  const current = viewpoints[tour.index] ?? null;
  const scaleSource = project?.scan.scaleSource ?? 'none';
  const items = useMemo(() => (project && variant ? listItems(variant.sceneSnapshot, project.assets, catalogLinks) : []), [project, variant, catalogLinks]);
  const heroImages = (project?.heroImages ?? []).filter((h) => !h.variantId || h.variantId === variant?.id);

  useEffect(() => {
    if (!tour.playing || count < 2) return;
    const id = setInterval(() => { setTour((t) => stepTour(t, count, 1)); setStops((n) => n + 1); }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tour.playing, count]);

  if (error) return <main role="alert" className="flex flex-1 items-center justify-center text-text-muted">{error}</main>;
  if (!project || !variant) return <main className="flex flex-1 items-center justify-center text-text-muted">Loading presentation…</main>;

  const step = (dir: 1 | -1) => { setTour((t) => stepTour(t, count, dir)); setStops((n) => n + 1); };

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden">
      <PresentationViewer
        sceneSnapshot={variant.sceneSnapshot}
        fallbackScan={project.scan.url ? { url: project.scan.url, scanToScene: project.scan.scanToScene } : undefined}
        pose={current ? poseOf(current) : null}
        flightKey={`${current?.id ?? 'start'}:${stops}`}
      />

      <header className="pointer-events-none absolute left-4 right-4 top-4 flex flex-wrap items-start justify-between gap-3">
        <div className="pointer-events-auto rounded-lg border border-border bg-surface/90 px-4 py-2 backdrop-blur">
          <h1 className="text-sm font-semibold">{project.name}</h1>
          {variants.length > 1 && (
            <div role="group" aria-label="Design variants" className="mt-2 flex gap-1">
              {variants.map((v) => (
                <button key={v.id} aria-pressed={v.id === variant.id} onClick={() => setVariantId(v.id)} className={`rounded border px-3 py-1 text-xs ${v.id === variant.id ? 'border-accent bg-accent/20 text-accent' : 'border-border'}`}>{v.name}</button>
              ))}
            </div>
          )}
        </div>
      </header>

      <aside aria-label="Items" className="absolute right-4 top-24 flex max-h-[calc(100%-12rem)] w-72 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface/90 p-3 text-sm backdrop-blur">
        <h2 className="font-medium">Items ({items.length})</h2>
        {items.length === 0 && <p className="text-xs text-text-muted">No furnishings in this design yet.</p>}
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const link = safeWebUrl(item.productUrl);
            return (
              <li key={item.id} className="rounded border border-border p-2">
                <div className="font-medium">{item.name}</div>
                {item.dimensions && <div className="text-xs text-text-muted">W {formatMeasurement(item.dimensions[0], scaleSource)} · H {formatMeasurement(item.dimensions[1], scaleSource)} · D {formatMeasurement(item.dimensions[2], scaleSource)}</div>}
                {link && <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex items-center gap-1 text-xs text-accent">Product page <ExternalLink size={12} /></a>}
              </li>
            );
          })}
        </ul>
        {heroImages.length > 0 && (
          <section aria-label="Renders" className="flex flex-col gap-2">
            <h2 className="font-medium">Renders</h2>
            {heroImages.map((h) => (
              <figure key={h.id} className="relative overflow-hidden rounded border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={h.url} alt={h.caption || 'AI render'} referrerPolicy="no-referrer" className="w-full" />
                <figcaption className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">AI render</figcaption>
              </figure>
            ))}
          </section>
        )}
      </aside>

      {count > 0 && (
        <nav aria-label="Guided tour" className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-2 backdrop-blur">
          <button aria-label="Previous viewpoint" onClick={() => step(-1)} className="rounded-full p-2 hover:bg-surface-elevated"><ChevronLeft size={18} /></button>
          <div className="min-w-44 text-center text-sm">
            <div data-testid="tour-name" className="font-medium">{current?.name}</div>
            <div data-testid="tour-position" className="text-xs text-text-muted">Viewpoint {tour.index + 1} of {count}</div>
          </div>
          <button aria-label="Next viewpoint" onClick={() => step(1)} className="rounded-full p-2 hover:bg-surface-elevated"><ChevronRight size={18} /></button>
          {count > 1 && (
            <button aria-label={tour.playing ? 'Pause tour' : 'Play tour'} aria-pressed={tour.playing} onClick={() => setTour((t) => togglePlay(t, count))} className="rounded-full p-2 hover:bg-surface-elevated">{tour.playing ? <Pause size={18} /> : <Play size={18} />}</button>
          )}
          <select aria-label="Jump to viewpoint" value={tour.index} onChange={(e) => { setTour((t) => jumpTo(t, count, Number(e.target.value))); setStops((n) => n + 1); }} className="rounded border border-border bg-background px-2 py-1 text-xs">
            {viewpoints.map((v, i) => <option key={v.id} value={i}>{v.name}</option>)}
          </select>
        </nav>
      )}
    </main>
  );
}
