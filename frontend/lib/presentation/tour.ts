import type { Vector3, Viewpoint } from '@/lib/contracts';

export interface TourState {
  index: number;
  playing: boolean;
}

export interface CameraPose {
  position: Vector3;
  target: Vector3;
}

export const AUTOPLAY_INTERVAL_MS = 5000;
export const TRANSITION_SECONDS = 1.4;

/** Steps to the next/previous viewpoint, wrapping at both ends. An empty tour stays at index 0. */
export function stepTour(state: TourState, count: number, direction: 1 | -1): TourState {
  if (count <= 0) return { ...state, index: 0 };
  return { ...state, index: (((state.index + direction) % count) + count) % count };
}

export function jumpTo(state: TourState, count: number, index: number): TourState {
  return { ...state, index: count <= 0 ? 0 : Math.min(Math.max(Math.trunc(index), 0), count - 1) };
}

/** Auto-play only makes sense with something to move between. */
export function togglePlay(state: TourState, count: number): TourState {
  return { ...state, playing: count > 1 && !state.playing };
}

export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

const mix = (a: Vector3, b: Vector3, t: number): Vector3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Camera pose `t` (0..1, eased) of the way from `from` to `to`. */
export function lerpPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const e = easeInOut(t);
  return { position: mix(from.position, to.position, e), target: mix(from.target, to.target, e) };
}

export function poseOf(viewpoint: Viewpoint): CameraPose {
  return { position: viewpoint.position, target: viewpoint.target };
}
