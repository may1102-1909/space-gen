'use client';

import React, { useState, useCallback } from 'react';
import { SplatBackgroundCanvas, SplatCameraState } from './SplatBackgroundCanvas';
import { PascalForegroundOverlay } from './PascalForegroundOverlay';
import { DecisionHUD, EvalOption } from './DecisionHUD';

export function SplatPrototypeView() {
  const [currentOption, setCurrentOption] = useState<EvalOption>('option_c');
  const [cameraState, setCameraState] = useState<SplatCameraState | null>(null);

  // Metrics
  const [fps, setFps] = useState(60);
  const [splatCount, setSplatCount] = useState(161576);
  const [format, setFormat] = useState('pcsogszip (.sog)');
  const [isLoaded, setIsLoaded] = useState(false);

  // Verification Controls
  const [itemDepthMode, setItemDepthMode] = useState<'front' | 'behind'>('front');
  const [enableMasking, setEnableMasking] = useState(false);
  const [showOcclusionProxy, setShowOcclusionProxy] = useState(true);
  const [itemType, setItemType] = useState<'chair' | 'sofa' | 'coffee_table'>('chair');

  const handleMetricsUpdate = useCallback(
    (metrics: { fps: number; splatCount: number; format: string; isLoaded: boolean }) => {
      setFps(metrics.fps);
      setSplatCount(metrics.splatCount);
      setFormat(metrics.format);
      setIsLoaded(metrics.isLoaded);
    },
    []
  );

  const getCanvasRenderMode = (): 'synced' | 'unsupported_webgpu' | 'forced_webgl_fail' => {
    if (currentOption === 'option_a') return 'unsupported_webgpu';
    if (currentOption === 'option_b') return 'forced_webgl_fail';
    return 'synced';
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-slate-950 select-none">
      {/* 1. Underlying WebGL2 Gaussian Splat Canvas (Option C) */}
      <SplatBackgroundCanvas
        cameraState={cameraState}
        enableMasking={enableMasking}
        maskPosition={[0, -0.6, itemDepthMode === 'front' ? 0.2 : -2.5]}
        maskSize={[1.4, 1.2, 1.4]}
        onMetricsUpdate={handleMetricsUpdate}
        renderMode={getCanvasRenderMode()}
      />

      {/* 2. Foreground Pascal / WebGPU 3D Scene Layer */}
      {currentOption === 'option_c' && (
        <PascalForegroundOverlay
          onCameraSync={setCameraState}
          itemDepthMode={itemDepthMode}
          showOcclusionProxy={showOcclusionProxy}
          itemType={itemType}
        />
      )}

      {/* 3. Option D Interactive Exploration Info */}
      {currentOption === 'option_d' && (
        <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none">
          <div className="max-w-xl bg-slate-900/95 border border-purple-500/60 rounded-xl p-6 shadow-2xl text-slate-200 pointer-events-auto">
            <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wider mb-2">
              (d) Native WebGPU Gaussian Splatting Analysis
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              Native WebGPU splatting merges splat instances and Pascal mesh nodes into a single
              Three.js `WebGPURenderer` pipeline, enabling a truly unified hardware depth buffer.
            </p>
            <div className="space-y-2 text-xs bg-slate-800/80 p-3 rounded-lg border border-slate-700/60">
              <div className="flex items-start gap-2">
                <span className="text-red-400 font-bold shrink-0">✗</span>
                <span>
                  <strong>No Open-Source .sog/.spz WGSL Decoder:</strong> WebP texture codebook
                  decompression is not available in WGSL and requires complex client-side SIMD WASM decoding.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-red-400 font-bold shrink-0">✗</span>
                <span>
                  <strong>Compute Shader Sort Compatibility:</strong> Radix GPU sorting on 1.5M+
                  splats via WebGPU compute workgroups lacks universal Android/iOS hardware support.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 font-bold shrink-0">✓</span>
                <span>
                  <strong>Optimal Long-Term Architecture:</strong> When Three.js standardizes a
                  TSL SplatNode in upcoming releases, migration will be seamless.
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setCurrentOption('option_c')}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                Return to Recommended Dual-Canvas (c)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Telemetry and Interactive Decision HUD */}
      <DecisionHUD
        currentOption={currentOption}
        onChangeOption={setCurrentOption}
        fps={fps}
        splatCount={splatCount}
        format={format}
        isLoaded={isLoaded}
        itemDepthMode={itemDepthMode}
        onChangeDepthMode={setItemDepthMode}
        enableMasking={enableMasking}
        onToggleMasking={setEnableMasking}
        showOcclusionProxy={showOcclusionProxy}
        onToggleOcclusionProxy={setShowOcclusionProxy}
        itemType={itemType}
        onChangeItemType={setItemType}
      />

      {/* 5. Minimalistic Viewport Instruction Footer */}
      <div className="absolute bottom-4 right-4 z-10 bg-slate-900/80 backdrop-blur border border-slate-800 px-3 py-1.5 rounded-lg text-[11px] text-slate-400 font-mono pointer-events-none">
        Drag to Orbit • Right-click to Pan • Scroll to Zoom
      </div>
    </div>
  );
}
