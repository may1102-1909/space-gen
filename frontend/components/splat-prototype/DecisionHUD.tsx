'use client';

import React from 'react';
import {
  Activity,
  Layers,
  Box,
  Eye,
  AlertTriangle,
  CheckCircle2,
  FileCode,
  Sparkles,
} from 'lucide-react';

export type EvalOption = 'option_a' | 'option_b' | 'option_c' | 'option_d';

interface DecisionHUDProps {
  currentOption: EvalOption;
  onChangeOption: (opt: EvalOption) => void;
  fps: number;
  splatCount: number;
  format: string;
  isLoaded: boolean;
  itemDepthMode: 'front' | 'behind';
  onChangeDepthMode: (mode: 'front' | 'behind') => void;
  enableMasking: boolean;
  onToggleMasking: (enabled: boolean) => void;
  showOcclusionProxy: boolean;
  onToggleOcclusionProxy: (enabled: boolean) => void;
  itemType: 'chair' | 'sofa' | 'coffee_table';
  onChangeItemType: (type: 'chair' | 'sofa' | 'coffee_table') => void;
}

export const DecisionHUD: React.FC<DecisionHUDProps> = ({
  currentOption,
  onChangeOption,
  fps,
  splatCount,
  format,
  isLoaded,
  itemDepthMode,
  onChangeDepthMode,
  enableMasking,
  onToggleMasking,
  showOcclusionProxy,
  onToggleOcclusionProxy,
  itemType,
  onChangeItemType,
}) => {
  return (
    <div className="absolute top-4 left-4 z-20 flex flex-col gap-3 max-w-sm pointer-events-auto">
      {/* 1. Header & Live Metrics Card */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl p-4 shadow-2xl text-slate-100">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h3 className="font-semibold text-xs tracking-wider uppercase text-slate-200">
              Splat & Pascal Integration
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            PROTOTYPE
          </span>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-1">
          <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/50">
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <Activity className="w-3 h-3 text-emerald-400" />
              <span>FPS</span>
            </div>
            <div className="text-base font-mono font-bold text-emerald-400 mt-0.5">
              {currentOption === 'option_c' && isLoaded ? fps : '—'}
            </div>
          </div>

          <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/50">
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <Box className="w-3 h-3 text-cyan-400" />
              <span>Splats</span>
            </div>
            <div className="text-sm font-mono font-bold text-cyan-300 mt-1">
              {isLoaded ? splatCount.toLocaleString() : 'Loading…'}
            </div>
          </div>

          <div className="bg-slate-800/60 p-2 rounded-lg border border-slate-700/50">
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <FileCode className="w-3 h-3 text-purple-400" />
              <span>Format</span>
            </div>
            <div className="text-[11px] font-mono font-semibold text-purple-300 truncate mt-1" title={format}>
              {format || '.sog'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Architecture Candidates Evaluation Selector */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl p-4 shadow-2xl text-slate-100 flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          Evaluate Architecture Candidates
        </label>

        <div className="grid grid-cols-1 gap-1.5 mt-1 text-xs">
          <button
            onClick={() => onChangeOption('option_c')}
            className={`flex items-start gap-2.5 p-2 rounded-lg border text-left transition-all ${
              currentOption === 'option_c'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
                : 'bg-slate-800/40 border-slate-700/50 text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-xs flex items-center gap-1.5">
                (c) Dual-Canvas Synced (Recommended)
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                Spark WebGL2 background + Pascal WebGPU foreground. .sog support, OBB masking. FPS above is measured live.
              </p>
            </div>
          </button>

          <button
            onClick={() => onChangeOption('option_a')}
            className={`flex items-start gap-2.5 p-2 rounded-lg border text-left transition-all ${
              currentOption === 'option_a'
                ? 'bg-red-950/60 border-red-500/80 text-red-200'
                : 'bg-slate-800/40 border-slate-700/50 text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-xs">(a) Spark inside WebGPURenderer</div>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                Attempts Spark on a three/webgpu WebGPURenderer in this browser and shows the actual result.
              </p>
            </div>
          </button>

          <button
            onClick={() => onChangeOption('option_b')}
            className={`flex items-start gap-2.5 p-2 rounded-lg border text-left transition-all ${
              currentOption === 'option_b'
                ? 'bg-amber-950/60 border-amber-500/80 text-amber-200'
                : 'bg-slate-800/40 border-slate-700/50 text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-xs">(b) Force Pascal to WebGL + Spark</div>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                Attempts Spark on WebGPURenderer with forceWebGL: true and shows the actual result.
              </p>
            </div>
          </button>

          <button
            onClick={() => onChangeOption('option_d')}
            className={`flex items-start gap-2.5 p-2 rounded-lg border text-left transition-all ${
              currentOption === 'option_d'
                ? 'bg-purple-950/60 border-purple-500/80 text-purple-200'
                : 'bg-slate-800/40 border-slate-700/50 text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <FileCode className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-xs">(d) Native WebGPU Splatting</div>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                Shared depth buffer, but no open-source .sog decoder in WGSL; requires custom radix compute sorter.
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* 3. Interactive Depth, Occlusion & Masking Controls */}
      {currentOption === 'option_c' && (
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl p-4 shadow-2xl text-slate-100 flex flex-col gap-3">
          <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            Interactive Depth & Masking Verification
          </label>

          {/* Depth Position Switch */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400">GLB Item Depth Placement</span>
            <div className="grid grid-cols-2 gap-1.5 bg-slate-800/60 p-1 rounded-lg border border-slate-700/50">
              <button
                onClick={() => onChangeDepthMode('front')}
                className={`py-1 px-2 rounded text-xs font-medium transition-colors ${
                  itemDepthMode === 'front'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                In Front (Room)
              </button>
              <button
                onClick={() => onChangeDepthMode('behind')}
                className={`py-1 px-2 rounded text-xs font-medium transition-colors ${
                  itemDepthMode === 'behind'
                    ? 'bg-amber-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Behind Scan Wall
              </button>
            </div>
          </div>

          {/* Model Selector */}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
            <span className="text-slate-400">Item Model:</span>
            <select
              value={itemType}
              onChange={(e) => onChangeItemType(e.target.value as any)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
            >
              <option value="chair">Modern Chair</option>
              <option value="sofa">Lounge Sofa</option>
              <option value="coffee_table">Coffee Table</option>
            </select>
          </div>

          {/* Depth Occlusion Proxy Toggle */}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
            <div>
              <span className="text-slate-200 font-medium">Depth Occlusion Proxy</span>
              <p className="text-[10px] text-slate-400 leading-tight">
                colorWrite: false, depthWrite: true
              </p>
            </div>
            <button
              onClick={() => onToggleOcclusionProxy(!showOcclusionProxy)}
              className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors ${
                showOcclusionProxy ? 'bg-cyan-600 justify-end' : 'bg-slate-700 justify-start'
              }`}
            >
              <span className="w-4 h-4 bg-white rounded-full shadow" />
            </button>
          </div>

          {/* OBB Crop Volume Masking Toggle */}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
            <div>
              <span className="text-slate-200 font-medium">Per-Region OBB Masking</span>
              <p className="text-[10px] text-slate-400 leading-tight">
                SplatEdit SDF Box (opacity: 0)
              </p>
            </div>
            <button
              onClick={() => onToggleMasking(!enableMasking)}
              className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors ${
                enableMasking ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'
              }`}
            >
              <span className="w-4 h-4 bg-white rounded-full shadow" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
