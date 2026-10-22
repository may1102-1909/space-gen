'use client';

import { useEffect, useState } from 'react';
import { setScanAlignment } from '@/lib/pascal/scanNodes';
import type { Matrix4, Vector3 } from '@/lib/contracts/primitives';
import {
  applyMetricAlignment,
  floorAlignmentFromPoints,
  multiplyMatrix4,
  transformPoint,
} from '@/lib/pascal/scanAlignment';
import { RotateCw, RotateCcw, Check, Sparkles } from 'lucide-react';

type Stage = 'floor' | 'scale' | 'wall';

interface ScanAlignmentToolProps {
  scanId: string | null;
  scanToScene: Matrix4;
  scanPointFromScenePoint: (point: Vector3) => Vector3;
  onPickModeChange: (enabled: boolean) => void;
  onPointHandlerChange: (handler: ((point: Vector3) => void) | null) => void;
  onClose?: () => void;
}

/** Interactive scan alignment. Each completed phase is one undoable Pascal metadata update. */
export function ScanAlignmentTool({
  scanId,
  scanToScene,
  scanPointFromScenePoint,
  onPickModeChange,
  onPointHandlerChange,
  onClose,
}: ScanAlignmentToolProps) {
  const [stage, setStage] = useState<Stage>('floor');
  const [points, setPoints] = useState<Vector3[]>([]);
  const [distance, setDistance] = useState('1.00');
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState('');
  const [isPicking, setIsPicking] = useState(false);

  const stageLabel = stage === 'floor'
    ? 'Pick 3 or more floor points'
    : stage === 'scale'
      ? 'Pick 2 endpoints of a known distance'
      : 'Pick 2 points along a wall to square up';

  const applyFloor = (ptsToUse = points) => {
    if (!scanId) return;
    if (ptsToUse.length < 3) {
      setError('Pick at least 3 points on the floor.');
      return;
    }
    try {
      const matrix = floorAlignmentFromPoints(ptsToUse);
      setScanAlignment(scanId, matrix);
      setLastAction(`Floor leveled from ${ptsToUse.length} points and moved to y = 0.`);
      setStage('scale');
      setPoints([]);
      setError('');
      setIsPicking(false);
      onPickModeChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not align floor.');
    }
  };

  const applyScale = (ptsToUse = points) => {
    if (!scanId) return;
    if (ptsToUse.length < 2) {
      setError('Pick 2 reference endpoints first.');
      return;
    }
    const meters = Number(distance);
    if (!Number.isFinite(meters) || meters <= 0) {
      setError('Enter a valid measured distance in meters (> 0).');
      return;
    }
    try {
      const matrix = applyMetricAlignment(scanToScene, [ptsToUse[0], ptsToUse[1]], meters, 0);
      setScanAlignment(scanId, matrix, 'user_measurement');
      setLastAction(`Scale calibrated to ${meters} m.`);
      setStage('wall');
      setPoints([]);
      setError('');
      setIsPicking(false);
      onPickModeChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not calibrate scale.');
    }
  };

  const applyWallSquare = (ptsToUse = points) => {
    if (!scanId) return;
    if (ptsToUse.length < 2) {
      setError('Pick 2 points along a wall to square it up.');
      return;
    }
    try {
      const sceneA = transformPoint(scanToScene, ptsToUse[0]);
      const sceneB = transformPoint(scanToScene, ptsToUse[1]);
      const angle = Math.atan2(sceneB[2] - sceneA[2], sceneB[0] - sceneA[0]);
      const target = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
      const yaw = target - angle;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const rotate: Matrix4 = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
      setScanAlignment(scanId, multiplyMatrix4(rotate, scanToScene));
      setLastAction('Wall squared to the nearest scene axis.');
      setPoints([]);
      setError('');
      setIsPicking(false);
      onPickModeChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not square wall.');
    }
  };

  const rotateAboutY = (angleDegrees: number) => {
    if (!scanId) return;
    const rad = (angleDegrees * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const rotate: Matrix4 = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    setScanAlignment(scanId, multiplyMatrix4(rotate, scanToScene));
    setLastAction(`Rotated scan ${angleDegrees > 0 ? '+' : ''}${angleDegrees}° about Y.`);
  };

  const addPoint = (scenePoint: Vector3) => {
    if (!scanId) return;
    const scanPoint = scanPointFromScenePoint(scenePoint);
    const next = [...points, scanPoint];
    setPoints(next);
    setError('');

    if (stage === 'floor') {
      if (next.length === 3) {
        // Auto-fit 3 points by default, but user can clear or pick more
        applyFloor(next);
      }
    } else if (stage === 'scale') {
      if (next.length === 2) {
        const meters = Number(distance);
        if (Number.isFinite(meters) && meters > 0) {
          applyScale(next);
        }
      }
    } else if (stage === 'wall') {
      if (next.length === 2) {
        applyWallSquare(next);
      }
    }
  };

  useEffect(() => {
    onPointHandlerChange(addPoint);
    return () => onPointHandlerChange(null);
  });

  const changeStage = (next: Stage) => {
    setStage(next);
    setPoints([]);
    setError('');
  };

  return (
    <aside className="absolute bottom-4 right-4 z-20 w-80 rounded-xl border border-border bg-surface/95 p-4 text-text-primary shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles size={14} className="text-accent" />
            Align room scan
          </h2>
          <p className="mt-1 text-xs text-text-muted">Click points directly on the scan. Undo each completed step with Ctrl+Z.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onPickModeChange(false);
            setIsPicking(false);
            onClose?.();
          }}
          aria-label="Close scan alignment"
          className="rounded px-1.5 py-0.5 text-text-muted hover:text-text-primary"
        >×</button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1">
        {(['floor', 'scale', 'wall'] as Stage[]).map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => changeStage(item)}
            className={`rounded-md px-2 py-1.5 text-[11px] font-medium capitalize transition-all ${
              stage === item ? 'bg-accent text-white shadow-sm' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs font-medium text-text-primary">{stageLabel}</p>

      {stage === 'floor' && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-text-muted leading-relaxed">
            Click 3 or more points on the floor to fit a plane, orient +Y upward, and set floor elevation to y = 0.
          </p>
          {points.length >= 3 && (
            <button
              type="button"
              onClick={() => applyFloor()}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Check size={13} />
              Fit Floor Plane ({points.length} points)
            </button>
          )}
        </div>
      )}

      {stage === 'scale' && (
        <div className="mt-2 space-y-2">
          <label className="block text-[11px] text-text-muted">
            Real distance between points (meters)
            <input
              aria-label="Real distance in meters"
              type="number"
              min="0.001"
              step="0.01"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              placeholder="e.g. 1.00"
            />
          </label>
          {points.length === 2 && (
            <button
              type="button"
              onClick={() => applyScale()}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Check size={13} />
              Apply Scale ({distance} m)
            </button>
          )}
        </div>
      )}

      {stage === 'wall' && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-text-muted leading-relaxed">
            Pick 2 points along a straight wall to square the room to the nearest cardinal axis.
          </p>
          {points.length === 2 && (
            <button
              type="button"
              onClick={() => applyWallSquare()}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Check size={13} />
              Square Up Wall
            </button>
          )}
          <div className="pt-2 border-t border-border/60">
            <span className="text-[10px] uppercase font-semibold text-text-muted tracking-wider">Quick Step Rotation</span>
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => rotateAboutY(90)}
                className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-surface-elevated hover:bg-surface-elevated/80 text-xs font-medium text-text-secondary hover:text-text-primary border border-border"
              >
                <RotateCw size={12} />
                +90° Y
              </button>
              <button
                type="button"
                onClick={() => rotateAboutY(-90)}
                className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-surface-elevated hover:bg-surface-elevated/80 text-xs font-medium text-text-secondary hover:text-text-primary border border-border"
              >
                <RotateCcw size={12} />
                -90° Y
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-text-muted pt-2 border-t border-border/50">
        <span>{points.length} point{points.length === 1 ? '' : 's'} selected</span>
        {points.length > 0 && (
          <button type="button" onClick={() => setPoints([])} className="hover:text-text-primary font-medium">Clear</button>
        )}
      </div>

      {error && <p role="alert" className="mt-2 text-xs text-red-400 font-medium">{error}</p>}
      {!error && lastAction && <p className="mt-2 text-xs text-emerald-400 font-medium">{lastAction}</p>}
      {!scanId && <p className="mt-2 text-xs text-amber-300 font-medium">Load a scan before aligning.</p>}

      <button
        type="button"
        disabled={!scanId}
        onClick={() => {
          const next = !isPicking;
          setIsPicking(next);
          onPickModeChange(next);
        }}
        className={`mt-3 w-full rounded-md px-3 py-2 text-xs font-semibold text-white transition-all disabled:opacity-40 ${
          isPicking ? 'bg-amber-600 hover:bg-amber-500' : 'bg-accent hover:bg-accent/90'
        }`}
      >
        {isPicking ? 'Stop picking in viewport' : 'Start picking in viewport'}
      </button>
    </aside>
  );
}
