---
name: react-typescript-expert
description: Engineering standards for modern React 19, Next.js App Router, TypeScript strict mode, state management, and performance.
---

# React and TypeScript Engineering Skill

<role>
You are a staff frontend engineer. Your goal is to guide high-performance, strictly typed React 19 and Next.js App Router development, preventing hydration bugs, memory leaks, and unnecessary re-renders.
</role>

---

## When to Use

Activate this skill:
- **Writing or refactoring React components**: Next.js App Router (Server vs. Client components).
- **Managing state**: Zustand, React context, or local reducer patterns.
- **Handling TypeScript definitions**: Creating strict interfaces, discriminated unions, and avoiding `any`.
- **Integrating 3D or browser-only components**: Embedding Canvas, WebGL, or splat viewers safely without SSR hydration errors.
- **Auditing frontend performance**: Eliminating re-render storms and memory leaks in hooks.

---

## Core Engineering Rules

### 1. Client vs. Server Component Boundaries
- **Default to Server Components**: Keep data fetching, secrets, and heavy dependencies on the server.
- **Push `'use client'` to the leaf**: Never mark an entire page as `'use client'` just because a single button or modal needs state.
- **Dynamic Imports for WebGL/Canvas**:
  ```tsx
  import dynamic from 'next/dynamic';
  
  const SpatialViewer = dynamic(
    () => import('@/components/SpatialViewer'),
    { ssr: false, loading: () => <ViewerSkeleton /> }
  );
  ```

### 2. React 19 & Hook Hygiene
- **Strict Cleanup in `useEffect`**: Always return a cleanup function when binding events, intervals, or abort controllers:
  ```tsx
  useEffect(() => {
    const controller = new AbortController();
    fetchData({ signal: controller.signal });
    return () => controller.abort();
  }, [fetchData]);
  ```
- **Zustand Selector Discipline**: Always select specific slices to avoid rerendering the entire tree:
  ```tsx
  // ✅ Good: Only re-renders when activeTool changes
  const activeTool = useDesignStore((s) => s.activeTool);
  
  // ❌ Bad: Re-renders on any store change
  const { activeTool, setTool, objects } = useDesignStore();
  ```

### 3. Strict TypeScript Practices
- **No Implicit or Explicit `any`**:
  ```typescript
  // ❌ Bad
  const handleEvent = (data: any) => { ... }
  
  // ✅ Good (Discriminated Union)
  type SpatialEvent =
    | { type: 'SELECT_OBJECT'; id: string; position: [number, number, number] }
    | { type: 'DESELECT_OBJECT' }
    | { type: 'TRANSFORM'; id: string; matrix: number[] };
  ```
- **Readonly & Immutability**:
  Use `Readonly<T>` or `readonly` arrays for props that should not be mutated.

### 4. Hydration Safety
- Avoid accessing `window`, `document`, or `localStorage` during initial render.
- Use an `isMounted` state or `useEffect` before rendering client-specific details:
  ```tsx
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  ```

---

## Verification Runbook

1. **Verify TypeScript Compilation**:
   ```powershell
   cd frontend
   npx tsc --noEmit
   ```
2. **Verify Linting & Formatting**:
   ```powershell
   cd frontend
   npm run lint
   ```
3. **Inspect for Console Warnings**:
   Check for React hydration mismatch warnings or unhandled promise rejections in browser devtools.
