'use client';

import React from 'react';
import { useSpaceGenStore } from '@/lib/store';
import {
  Sparkles,
  Check,
  X,
  CheckCheck,
  Armchair,
  Box,
  Compass,
  Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function AIPlacementPreview() {
  const candidatePlacements = useSpaceGenStore((state) => state.candidatePlacements);
  const acceptCandidatePlacement = useSpaceGenStore((state) => state.acceptCandidatePlacement);
  const rejectCandidatePlacement = useSpaceGenStore((state) => state.rejectCandidatePlacement);
  const acceptAllCandidatePlacements = useSpaceGenStore(
    (state) => state.acceptAllCandidatePlacements
  );
  const clearCandidatePlacements = useSpaceGenStore((state) => state.clearCandidatePlacements);

  if (candidatePlacements.length === 0) return null;

  return (
    <div className="absolute top-20 right-6 z-30 flex flex-col gap-2 max-w-sm pointer-events-auto">
      {/* Header Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="p-3 rounded-2xl bg-surface/95 border border-accent/40 backdrop-blur-xl shadow-2xl flex flex-col gap-2"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-accent text-white shadow-sm shadow-accent/30">
              <Sparkles size={14} />
            </div>
            <div>
              <h3 className="font-semibold text-xs leading-tight text-text-primary">
                Smart Placement Proposal
              </h3>
              <p className="text-[10px] text-text-muted font-mono">
                {candidatePlacements.length} candidate(s) ready to commit
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={acceptAllCandidatePlacements}
              title="Accept all proposed placements into the scene graph"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-[11px] font-semibold transition-all shadow-md shadow-accent/20"
            >
              <CheckCheck size={13} />
              <span>Accept All</span>
            </button>
            <button
              onClick={clearCandidatePlacements}
              title="Dismiss all"
              className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-muted hover:text-red-400 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Candidate List Cards */}
        <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto pr-1">
          <AnimatePresence>
            {candidatePlacements.map((candidate) => {
              const [px, , pz] = candidate.position;
              return (
                <motion.div
                  key={candidate.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="p-2 rounded-xl bg-surface-elevated/80 border border-border/80 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-md bg-accent/10 text-accent shrink-0">
                      <Armchair size={12} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[11px] truncate text-text-primary">
                        {candidate.name}
                      </div>
                      <div className="text-[10px] text-text-muted font-mono truncate">
                        Pos: [{px.toFixed(2)}, {pz.toFixed(2)}]m • {candidate.reasoning}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => acceptCandidatePlacement(candidate.id)}
                      title="Keep this placement"
                      className="p-1 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => rejectCandidatePlacement(candidate.id)}
                      title="Reject this placement"
                      className="p-1 rounded-md hover:bg-surface text-text-muted hover:text-red-400 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

export default AIPlacementPreview;
