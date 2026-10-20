'use client';

import React, { useState } from 'react';
import {
  SAMPLE_ROOM_SCAN_MANIFEST,
  convertScanToEditableNodes,
  RawScanManifest,
} from '@/lib/pascal/scanConverter';
import {
  Sparkles,
  Box,
  Layers,
  Crop,
  CheckCircle2,
  X,
  UploadCloud,
  FileCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScanToEditableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConverted?: (result: any) => void;
}

export function ScanToEditableModal({
  isOpen,
  onClose,
  onConverted,
}: ScanToEditableModalProps) {
  const [eraseSplats, setEraseSplats] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<'studio' | 'loft'>('studio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRunConversion = () => {
    setIsProcessing(true);
    setSuccessInfo(null);

    setTimeout(() => {
      try {
        const result = convertScanToEditableNodes(SAMPLE_ROOM_SCAN_MANIFEST, {
          eraseUnderlyingSplats: eraseSplats,
        });

        setIsProcessing(false);
        setSuccessInfo(
          `Extracted ${result.wallCount} walls, 1 floor slab, and ${result.itemCount} editable 3D furniture meshes with ${result.exclusionBoxCount} splat erasure masks!`
        );

        if (onConverted) onConverted(result);

        setTimeout(() => {
          onClose();
        }, 1400);
      } catch (err: any) {
        setIsProcessing(false);
        console.error('Scan conversion failed:', err);
      }
    }, 400);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-2xl p-6 text-text-primary flex flex-col gap-5 select-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center text-accent">
                <Sparkles size={16} />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Convert Scan to Editable Space</h3>
                <p className="text-xs text-text-muted">
                  Transform static 3D Gaussians into parametric BIM & movable 3D meshes
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Preset Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary">Scan Source</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSelectedPreset('studio')}
                className={`flex flex-col text-left p-3 rounded-xl border transition-all ${
                  selectedPreset === 'studio'
                    ? 'bg-accent/10 border-accent text-accent-light shadow-sm'
                    : 'bg-surface-elevated/40 border-border hover:bg-surface-elevated'
                }`}
              >
                <span className="font-medium text-xs">Studio Room Scan</span>
                <span className="text-[10px] text-text-muted mt-1">
                  8m × 6m · 5 detected items · 1 door & window
                </span>
              </button>

              <button
                onClick={() => setSelectedPreset('loft')}
                className={`flex flex-col text-left p-3 rounded-xl border transition-all ${
                  selectedPreset === 'loft'
                    ? 'bg-accent/10 border-accent text-accent-light shadow-sm'
                    : 'bg-surface-elevated/40 border-border hover:bg-surface-elevated'
                }`}
              >
                <span className="font-medium text-xs">Custom Upload (.splat / .ply)</span>
                <span className="text-[10px] text-text-muted mt-1">
                  Upload walkthrough scan for automatic segmentation
                </span>
              </button>
            </div>
          </div>

          {/* Extraction Manifest Preview */}
          <div className="p-3.5 rounded-xl bg-surface-elevated/40 border border-border/60 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-medium text-text-secondary">
              <FileCheck size={14} className="text-emerald-400" />
              <span>Detected Architectural Elements:</span>
            </div>
            <ul className="grid grid-cols-2 gap-1.5 text-[11px] text-text-muted pl-5 list-disc">
              <li>4 Connected Wall nodes</li>
              <li>1 Hardwood Floor Slab</li>
              <li>1 Entrance Door (South)</li>
              <li>1 Panorama Window (North)</li>
              <li>1 Boucle Sofa (3-Seater)</li>
              <li>1 Walnut Coffee Table</li>
              <li>1 Oak Dining Table</li>
              <li>2 Velvet Dining Chairs</li>
            </ul>
          </div>

          {/* SuperSplat Erasure Option */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-surface-elevated/30 border border-border/50 cursor-pointer hover:bg-surface-elevated/50 transition-colors">
            <input
              type="checkbox"
              checked={eraseSplats}
              onChange={(e) => setEraseSplats(e.target.checked)}
              className="mt-0.5 rounded border-border text-accent focus:ring-accent"
            />
            <div className="text-xs">
              <div className="font-medium flex items-center gap-1.5">
                <Crop size={13} className="text-amber-400" />
                <span>Mask Underlying Scan Gaussians (SuperSplat Erasure)</span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                Automatically masks out the raw Gaussian splats inside each furniture bounding box so replacing or moving items doesn&apos;t double-render over the original scan.
              </p>
            </div>
          </label>

          {/* Status Alert */}
          {successInfo && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>{successInfo}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={handleRunConversion}
              disabled={isProcessing}
              className="px-5 py-2 rounded-xl text-xs font-medium bg-accent hover:bg-accent-light text-white shadow-lg shadow-accent/25 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {isProcessing ? (
                <span>Extracting Geometry...</span>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>Extract Editable Walls & Furniture</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default ScanToEditableModal;
