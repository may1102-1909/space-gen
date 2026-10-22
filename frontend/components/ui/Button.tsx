import React from 'react'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }

export function Button({ children, variant = 'primary', className = '', ...props }: ButtonProps) {
  const base = "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
  const variants = {
    primary: "bg-accent hover:bg-indigo-600 text-white",
    secondary: "bg-surface-elevated hover:bg-border text-text-primary",
    ghost: "hover:bg-surface-elevated text-text-secondary hover:text-text-primary"
  }
  
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}
