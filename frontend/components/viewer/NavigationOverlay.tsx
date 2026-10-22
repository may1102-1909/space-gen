'use client';

import React from 'react';
import { useNavigation, type NavMode, type ViewMode } from '@/lib/navigation/navigationStore';
import { useScene } from '@pascal-app/core';
import { NO_WALLS_HINT, planCollider, type NavNode } from '@/lib/navigation/room';
import { useRoomNavigation } from '@/lib/navigation/useRoom';

const VIEW_MODES: Array<{ id: ViewMode; label: string; title: string }> = [
  { id: 'splat', label: 'Splat', title: 'Gaussian splat only (editable nodes stay invisible but still collide and pick)' },
  { id: 'mesh', label: 'Mesh', title: 'Editable room and objects only' },
  { id: 'both', label: 'Both', title: 'Splat with the editable layer on top' },
];
const NAV_MODES: Array<{ id: NavMode; label: string; title: string }> = [
  { id: 'orbit', label: 'Orbit', title: 'Orbit, pan and zoom' },
  { id: 'walk', label: 'Walk', title: 'First-person walk with collisions' },
];

function Segment<T extends string>({ label, value, options, onChange, testId }: {
  label: string;
  value: T | null;
  options: Array<{ id: T; label: string; title: string }>;
  onChange: (id: T) => void;
  testId: string;
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="flex overflow-hidden rounded-md border border-border bg-surface/90 text-xs shadow backdrop-blur">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.title}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`px-3 py-1.5 ${value === option.id ? 'bg-accent text-white' : 'text-text-muted hover:text-text'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface NavigationOverlayProps {
  /** Shows the Interior/Exterior toggle (designers only). */
  editable?: boolean;
}

/** View mode (Splat / Mesh / Both), navigation (Orbit / Walk), scene kind, and the walk controls hint. */
export function NavigationOverlay({ editable = false }: NavigationOverlayProps) {
  // Read here, not in the viewers, so scene edits re-render only this small overlay.
  const { kind: sceneKind, detected: detectedKind } = useRoomNavigation();
  const noWallCollision = useScene((state) => planCollider(state.nodes as unknown as Record<string, NavNode | undefined>).showHint);
  const viewMode = useNavigation((s) => s.viewMode);
  const navMode = useNavigation((s) => s.navMode);
  const override = useNavigation((s) => s.sceneKindOverride);
  const setViewMode = useNavigation((s) => s.setViewMode);
  const setNavMode = useNavigation((s) => s.setNavMode);
  const setOverride = useNavigation((s) => s.setSceneKindOverride);

  return (
    <>
      <div className="pointer-events-auto absolute bottom-4 right-4 z-40 flex flex-col items-end gap-2" data-testid="navigation-overlay">
        {navMode === 'walk' && (
        <div className="pointer-events-none max-w-xs space-y-1 text-right" data-testid="walk-hint">
          <p className="rounded-md bg-black/70 px-3 py-1.5 text-xs text-white">
            Click to look around · WASD / arrows move · Shift sprint · Space jump · C crouch · 1/2/3 Splat/Mesh/Both · Esc exit
          </p>
          {noWallCollision && (
            <p role="status" className="rounded-md bg-amber-900/80 px-3 py-1.5 text-xs text-amber-100" data-testid="no-walls-hint">{NO_WALLS_HINT}</p>
          )}
        </div>
      )}
        <Segment label="View mode" testId="view-mode" value={viewMode} options={VIEW_MODES} onChange={setViewMode} />
        <Segment label="Navigation" testId="nav-mode" value={navMode} options={NAV_MODES} onChange={setNavMode} />
        {editable && (
          <Segment
            label="Scene kind"
            testId="scene-kind"
            value={sceneKind}
            options={[
              { id: 'interior', label: 'Interior', title: `Stay inside the room${override === null && detectedKind === 'interior' ? ' (auto)' : ''}` },
              { id: 'exterior', label: 'Exterior', title: `Free camera outside the building${override === null && detectedKind === 'exterior' ? ' (auto)' : ''}` },
            ]}
            onChange={(kind) => setOverride(kind === detectedKind ? null : kind)}
          />
        )}
      </div>
    </>
  );
}
