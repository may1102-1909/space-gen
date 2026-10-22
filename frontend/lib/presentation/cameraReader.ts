import type { Vector3 } from '@/lib/contracts';

export interface CameraReading {
  position: Vector3;
  target: Vector3;
  fov: number;
}

type Reader = () => CameraReading;
let reader: Reader | null = null;

/** The mounted editor viewport registers itself so UI outside the canvas can save the current camera. */
export function registerCameraReader(next: Reader): () => void {
  reader = next;
  return () => {
    if (reader === next) reader = null;
  };
}

export function readCamera(): CameraReading | null {
  return reader ? reader() : null;
}
