'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useNavigation, viewModeLayers } from '@/lib/navigation/navigationStore';

/**
 * Splat view keeps the Pascal canvas mounted (walls still collide, items still pick) but fully transparent.
 * Fades the canvas element itself: a wrapper element would change the viewer's layout and pointer handling.
 */
export function PascalLayerFade() {
  const get = useThree((state) => state.get);
  const visible = useNavigation((state) => viewModeLayers(state.viewMode).pascal);
  useEffect(() => {
    const canvas = get().gl.domElement as HTMLCanvasElement;
    canvas.dataset.testid = 'pascal-layer';
    canvas.dataset.visible = String(visible);
    canvas.style.opacity = visible ? '1' : '0';
  }, [get, visible]);
  return null;
}
