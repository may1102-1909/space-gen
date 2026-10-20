'use client';

import React, { useState } from 'react';
import { useScene } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { SAMPLE_ROOM_SCAN_MANIFEST, RawScanObject } from '@/lib/pascal/scanConverter';
import { addExclusionVolumeToScan } from '@/lib/splat/splatCropManager';
import { Box, Sparkles, Eraser, RefreshCw, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScanSegmentationOverlayProps {
  onReplaceWithAI?: (object: RawScanObject) => void;
}

export function ScanSegmentationOverlay({ onReplaceWithAI }: ScanSegmentationOverlayProps) {
  const showScans = useViewer((state) => state.showScans);
  const nodes = useScene((state) => state.nodes);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [extractedObjectIds, setExtractedObjectIds] = useState<Set<string>>(new Set());

  if (!showScans) return null;

  // Find scan node
  const scanNode = Object.values(nodes).find((n) => n?.type === 'scan');
  if (!scanNode || !scanNode.visible) return null;

  const detectedObjects = SAMPLE_ROOM_SCAN_MANIFEST.detectedObjects;

  const handleExtractSingle = (obj: RawScanObject) => {
    const scene = useScene.getState();
    const levelId = Object.values(scene.nodes).find((n) => n?.type === 'level')?.id || 'level_main';
    const itemId = `item_${obj.category}_extracted_${Date.now()}`;

    // 1. Create editable Pascal item node
    (scene.createNode as any)(
      {
        type: 'item',
        id: itemId,
        name: obj.label,
        category: obj.category,
        position: obj.center,
        rotation: obj.rotation || [0, 0, 0],
        scale: [1, 1, 1],
        dimensions: obj.dimensions,
        modelUrl: obj.modelUrl || `/samples/models/${obj.category === 'sofa' ? 'sofa.glb' : obj.category === 'chair' ? 'chair.glb' : 'coffee_table.glb'}`,
        asset: {
          id: `asset_${itemId}`,
          category: obj.category,
          name: obj.label,
          thumbnail: '',
          source: 'library',
          src: obj.modelUrl || `/samples/models/${obj.category === 'sofa' ? 'sofa.glb' : obj.category === 'chair' ? 'chair.glb' : 'coffee_table.glb'}`,
          dimensions: obj.dimensions,
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
      levelId
    );

    // 2. Add SuperSplat exclusion volume
    addExclusionVolumeToScan(scanNode.id, {
      id: `box_erase_${obj.id}`,
      type: 'box',
      center: obj.center,
      size: [obj.dimensions[0] * 1.05, obj.dimensions[1] * 1.05, obj.dimensions[2] * 1.05],
      rotation: obj.rotation,
      mode: 'exclude',
      label: `Erased ${obj.label}`,
    });

    setExtractedObjectIds((prev) => new Set(prev).add(obj.id));
  };

  const handleEraseOnly = (obj: RawScanObject) => {
    addExclusionVolumeToScan(scanNode.id, {
      id: `box_erase_manual_${obj.id}`,
      type: 'box',
      center: obj.center,
      size: [obj.dimensions[0] * 1.05, obj.dimensions[1] * 1.05, obj.dimensions[2] * 1.05],
      rotation: obj.rotation,
      mode: 'exclude',
      label: `Erased ${obj.label}`,
    });
    setExtractedObjectIds((prev) => new Set(prev).add(obj.id));
  };

  return (
    <div className="absolute bottom-5 left-6 z-20 pointer-events-auto flex flex-col gap-2 max-w-sm">
      <div className="flex items-center gap-2 p-2 rounded-xl bg-surface/90 border border-border backdrop-blur-md shadow-lg text-xs">
        <Sparkles size={14} className="text-emerald-400" />
        <span className="font-semibold text-text-primary">Detected Scan Objects:</span>
        <span className="text-text-muted text-[11px] font-mono">
          ({detectedObjects.length - extractedObjectIds.size} un-extracted)
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {detectedObjects.map((obj) => {
          const isExtracted = extractedObjectIds.has(obj.id);
          const isHovered = hoveredObjectId === obj.id;

          return (
            <motion.div
              key={obj.id}
              onMouseEnter={() => setHoveredObjectId(obj.id)}
              onMouseLeave={() => setHoveredObjectId(null)}
              className={`p-2.5 rounded-xl border backdrop-blur-md transition-all ${
                isExtracted
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-xs'
                  : isHovered
                  ? 'bg-surface-elevated/95 border-accent shadow-lg shadow-accent/10 text-text-primary'
                  : 'bg-surface/80 border-border/80 text-text-secondary'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium truncate">{obj.label}</span>
                {isExtracted ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                    <Check size={11} /> Extracted & Masked
                  </span>
                ) : (
                  <span className="text-[10px] text-text-muted font-mono">
                    {Math.round(obj.confidence * 100)}% conf
                  </span>
                )}
              </div>

              {!isExtracted && isHovered && (
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
                  <button
                    onClick={() => handleExtractSingle(obj)}
                    className="flex-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-accent text-white hover:bg-accent-light transition-colors flex items-center justify-center gap-1"
                  >
                    <Box size={10} />
                    <span>Extract Mesh</span>
                  </button>

                  <button
                    onClick={() => handleEraseOnly(obj)}
                    className="px-2 py-1 rounded-lg text-[10px] font-medium bg-surface hover:bg-red-500/15 text-text-muted hover:text-red-400 border border-border transition-colors flex items-center gap-1"
                  >
                    <Eraser size={10} />
                    <span>Erase Splat</span>
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default ScanSegmentationOverlay;
