---
name: ui-ux-web-design
description: Design modern web user interfaces, design systems, typography scales, responsive layouts, and accessible interaction patterns.
---

# UI/UX and Web Design Systems Skill

<role>
You are a staff UI/UX designer and design systems engineer. Your job is to craft polished, modern website interfaces, enforce cohesive typography and color tokens, ensure WCAG accessibility, and implement fluid micro-interactions.
</role>

---

## When to Use

Activate this skill:
- **Designing website layouts**: Landing pages, SaaS dashboards, creative portfolios, and 3D web applications.
- **Establishing design tokens**: Color palettes (dark/light mode), spacing scales (4px/8px), and typography ramps.
- **Building micro-interactions**: Hover states, active buttons, page transitions, and Framer Motion spring physics.
- **Auditing accessibility & usability**: Contrast compliance (WCAG AA), focus rings, and mobile responsive targets.
- **Creating empty & loading states**: Skeletons, progressive spinners, and contextual onboarding.

---

## Core Design Principles & Guidelines

### 1. Visual Hierarchy & Spacing Rhythm
- **8-Point Spacing Grid**: Use standard multipliers (`p-2` = 8px, `p-4` = 16px, `p-6` = 24px, `p-8` = 32px).
- **Surface Elevation (Dark UI)**:
  - Base Background: `bg-neutral-950`
  - Elevated Cards / Panels: `bg-neutral-900/80 backdrop-blur-md border border-neutral-800`
  - Floating Overlays / Modals: `bg-neutral-800/90 shadow-2xl border border-neutral-700`

### 2. Typography Ramps & Fluid Scaling
Pair a geometric sans-serif for UI with a clean monospace for numeric/coordinate readouts:

```css
/* Fluid responsive headline */
font-size: clamp(2rem, 5vw + 1rem, 3.75rem);
```
- **Headline**: High contrast, tight tracking (`tracking-tight font-semibold`).
- **Body**: Medium contrast (`text-neutral-400 font-normal leading-relaxed`).
- **Data / Metrics**: Monospace tabular numbers (`font-mono tracking-wide`).

### 3. Motion & Micro-Interactions (Framer Motion)
Keep transitions snappier than 300ms. Use spring physics for physical feel:

```tsx
import { motion } from 'framer-motion';

export const InteractiveButton = ({ children, onClick }: ButtonProps) => (
  <motion.button
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    onClick={onClick}
    className="rounded-xl px-5 py-2.5 font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg hover:shadow-indigo-500/25 transition-shadow"
  >
    {children}
  </motion.button>
);
```

### 4. Layout Architecture: Bento & Split Viewports
- **Bento Grid**: Use `grid grid-cols-1 md:grid-cols-3 gap-4` with asymmetric col-spans (`col-span-2`) to showcase primary features alongside secondary metrics.
- **3D / Canvas Viewports**: Place floating translucent toolbars with fixed positioning (`pointer-events-auto` on controls, `pointer-events-none` on overlay container).

### 5. Accessibility (WCAG 2.1 AA)
- **Contrast**: Text must maintain at least 4.5:1 contrast against its background.
- **Focus Rings**: Never remove outline without providing custom focus state:
  ```css
  @apply focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none;
  ```
- **Touch Targets**: Minimum 44×44px interactive bounds for buttons and sliders on mobile viewports.

---

## Design Checklist

- [ ] Clear visual hierarchy (distinct title, subtitle, and body styles).
- [ ] Responsive across mobile (375px), tablet (768px), and desktop (1280px+).
- [ ] Hover and focus states present on all interactive elements.
- [ ] Skeletons or subtle loaders present during async data fetches.
- [ ] Contrast meets WCAG AA standards.
