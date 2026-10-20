'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const SplatPrototypeView = dynamic(
  () =>
    import('@/components/splat-prototype/SplatPrototypeView').then(
      (mod) => mod.SplatPrototypeView
    ),
  {
    ssr: false,
    loading: () => (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-300 gap-3">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono tracking-wider">
          Initializing Splat Rendering Decision Prototype...
        </span>
      </div>
    ),
  }
);

export default function SplatPrototypePage() {
  return (
    <main className="w-screen h-screen overflow-hidden bg-slate-950">
      <SplatPrototypeView />
    </main>
  );
}
