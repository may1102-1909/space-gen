# SpaceGen AI — Claude Code Instructions

This is the SpaceGen AI platform: an AI-native spatial design tool that turns physical environments into persistent, conversationally editable digital twins (Capture → Reconstruct → Understand → Select → Ask → Generate → Validate → Explore → Compare → Present).

## Agent Skills

Four skill packs are installed under `.claude/skills/`. Load the narrowest matching skill before acting on a related task.

### MengTo/Skills — Web design, 3D, games, UI workflows
Path: `.claude/skills/MengTo-Skills/agent-skills/`
177 SKILL.md files covering:
- **3D rendering** — ultra-realistic water, underwater god rays, virtual tours, sky effects, falling leaves, four seasons, high-res textures and models, Retina rendering
- **Web design** — video-to-superprompt, HTML-to-interaction-prompts, full-page capture, daily UI inspiration
- **Game/combat VFX** — fire, smoke, ice, lightning, energy effects; combat animation and polish
- **Illustration** — 14 SVG styles (flat, halftone, isometric, one-line, vintage emblem, etc.)
- **Codex workflows** — audit/verify/explain/grade, build-daily-inspiration-sites

### alton47/threejs-skills — Three.js implementation
Path: `.claude/skills/alton47-threejs-skills/skills/`
14 SKILL.md files covering: core renderer setup, geometry, PBR materials, lighting, cameras, animation loops, custom GLSL shaders, post-processing, physics, React Three Fiber, WebXR, performance profiling.

### prorenderbureau/scene-agent-skills — Architectural rendering
Path: `.claude/skills/prorenderbureau-scene-skills/skills/`
20 SKILL.md files covering: 16 render style recipes, camera matching, Corona scene prep, plan-to-IFC tools, modeling detail profiles (low/high/very-high), materials, lighting, delivery workflows.

### jaccen/Awesome-Gaussian-Skills — 3D Gaussian Splatting
Path: `.claude/skills/jaccen-gaussian-skills/`
19 SKILL.md files covering: 3DGS methods catalog (976 methods), NeRF→3DGS porting, experiment design, bug pattern detection, multi-dimension method comparison.

### DietrichGebert/ponytail — Lazy senior dev discipline
Path: `.claude/skills/ponytail/skills/`
5 SKILL.md files — load `ponytail/SKILL.md` as default for any coding task:
- **ponytail** — core: YAGNI, stdlib-first, no unrequested abstractions, shortest working diff
- **ponytail-audit** — audit existing code for over-engineering and complexity debt
- **ponytail-debt** — track and pay down tech debt with smallest safe diffs
- **ponytail-gain** — measure code simplification gains before/after
- **ponytail-review** — review PRs with the laziest-senior-dev lens

## Agent Rulesets

@.claude/skills/khasky-awesome-agents-md/AGENTS.md

@.claude/skills/ponytail/AGENTS.md
