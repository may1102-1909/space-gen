'use client';

import React from 'react';
import { useScene, AnyNodeId } from '@pascal-app/core';
import { useViewer } from '@pascal-app/viewer';
import { formatDimensions, scaleSourceOf } from '@/lib/measurement/accuracy';
import {
  Armchair,
  Box,
  Image as ImageIcon,
  X,
  Sparkles,
  ArrowRightLeft,
  FileCode,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChatAttachmentBarProps {
  attachedFile: {
    type: 'image' | 'glb';
    dataUrl: string;
    name: string;
    size?: number;
  } | null;
  onClearAttachment: () => void;
  onQuickReplace?: (targetId: string) => void;
}

export function ChatAttachmentBar({
  attachedFile,
  onClearAttachment,
  onQuickReplace,
}: ChatAttachmentBarProps) {
  const selectedIds = useViewer((state) => state.selection.selectedIds);
  const nodes = useScene((state) => state.nodes);

  const selectedNodeId = selectedIds[0] || null;
  const selectedNode = selectedNodeId ? (nodes[selectedNodeId as AnyNodeId] as unknown as { id: string; type: string; name?: string; dimensions?: [number, number, number] } | undefined) : null;
  const isItem = selectedNode?.type === 'item';

  const dims = selectedNode?.dimensions;
  const scanNode = Object.values(nodes).find((n: any) => n?.type === 'scan');
  // Asset dimensions are product specs; anything else came from the scan and is an estimate.
  const dimsFormatted = !dims
    ? null
    : selectedNode?.asset?.dimensions
      ? `${dims[0].toFixed(2)}m × ${dims[1].toFixed(2)}m × ${dims[2].toFixed(2)}m`
      : formatDimensions(dims, scaleSourceOf(scanNode as any));

  if (!attachedFile && !selectedNode) return null;

  return (
    <div className="px-3 py-2 border-t border-border bg-surface-elevated/40 backdrop-blur-sm flex flex-col gap-1.5 text-xs">
      {/* 1. Selected 3D Object Context Pill */}
      {selectedNode && (
        <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface/80 border border-border/70 text-text-secondary">
          <div className="flex items-center gap-2 truncate">
            <div className="p-1 rounded-md bg-accent/15 text-accent shrink-0">
              {isItem ? <Armchair size={12} /> : <Box size={12} />}
            </div>
            <div className="truncate">
              <span className="font-medium text-text-primary text-[11px] mr-1.5">
                {selectedNode.name || selectedNode.id}
              </span>
              {dimsFormatted && (
                <span className="text-[10px] text-text-muted font-mono">
                  ({dimsFormatted})
                </span>
              )}
            </div>
          </div>

          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-elevated text-accent border border-accent/20">
            Selected
          </span>
        </div>
      )}

      {/* 2. Attached Reference Photo / 3D Asset Preview */}
      {attachedFile && (
        <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface/80 border border-accent/30 text-text-primary">
          <div className="flex items-center gap-2 truncate">
            {attachedFile.type === 'image' ? (
              <img
                src={attachedFile.dataUrl}
                alt="Attachment"
                className="w-7 h-7 rounded object-cover border border-border shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                <FileCode size={14} />
              </div>
            )}
            <div className="truncate">
              <div className="font-medium text-[11px] truncate">{attachedFile.name}</div>
              <span className="text-[9px] text-text-muted font-mono">
                {attachedFile.type === 'image' ? 'Reference Photo' : '3D GLB Model'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isItem && attachedFile.type === 'image' && onQuickReplace && (
              <button
                onClick={() => onQuickReplace(selectedNodeId!)}
                title="Replace selected 3D item with this photo"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-white hover:bg-accent-light text-[10px] font-medium shadow-sm transition-all"
              >
                <ArrowRightLeft size={10} />
                <span>Swap In</span>
              </button>
            )}

            <button
              onClick={onClearAttachment}
              className="p-1 rounded-md text-text-muted hover:text-red-400 hover:bg-surface-elevated transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatAttachmentBar;
