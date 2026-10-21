import React from 'react'

export function VariantGallery({ variants, onSelect }: { variants: Array<{ style: string, image: string, description: string }>, onSelect?: (v: { style: string, image: string, description: string }) => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {variants.map((v, i) => (
        <div key={i} onClick={() => onSelect?.(v)} className="w-48 shrink-0 rounded-xl border border-border overflow-hidden bg-surface hover:border-accent transition-colors cursor-pointer group">
          <div className="aspect-square relative overflow-hidden">
            <img src={v.image} alt={v.style} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          </div>
          <div className="p-3">
            <h4 className="text-sm font-semibold mb-1">{v.style}</h4>
            <p className="text-xs text-text-secondary line-clamp-2">{v.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
