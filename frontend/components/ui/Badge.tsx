import React from 'react'

export function Badge({ children, variant = 'default' }: { children: React.ReactNode, variant?: 'default' | 'success' | 'warning' }) {
  const variants = {
    default: "bg-surface-elevated text-text-secondary border-border",
    success: "bg-success/20 text-success border-success/30",
    warning: "bg-warning/20 text-warning border-warning/30",
  }
  
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold border ${variants[variant]}`}>
      {children}
    </span>
  )
}
