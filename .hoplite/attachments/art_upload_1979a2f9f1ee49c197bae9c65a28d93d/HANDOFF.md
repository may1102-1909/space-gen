# Ellips (repo: space-gen) — Handoff, 2026-10-23

Read this first, then `CLAUDE.md`, `.claude/skills/khasky-awesome-agents-md/AGENTS.md` and `.claude/skills/ponytail/AGENTS.md` (coding rules), `PRODUCT.md`, `DESIGN.md` and `docs/design/ui-redesign-plan.md`. Repo `D:\space-gen\space-gen`, origin `github.com/tanishq-sol/space-gen`. GitHub CLI: `"/c/Program Files/GitHub CLI/gh.exe"` (logged in as tanishqrameshsolanki-collab).

## Owner rules (do not change without asking)

- Product name is **Ellips** in everything users see. Internal identifiers (`useSpaceGenStore`, repo, backend) stay as they are.
- Light theme only, white + navy palette, subtle Apple-style Liquid Glass. Glass only on floating controls (toolbar, panels, palette, dialogs), 88% white fill (needed for 4.5:1 text over dark scan pixels). Navy only for the one primary action per view (Share, Apply). System UI font; Hanken Grotesk 600 only for projects header and share title. Must not look AI-made.
- `/` stays the blank editor for now.
- Workflow: upload a splat (.ply/.sog/.spz) → room structure (walls/slabs) → GPU worker on Colab segments every object and meshes it (GLB) → Pascal items. Architects get editable walls/slabs + measurements/drawings; no IFC export.
- GPU work runs on Colab, not locally (laptop RTX 3050 4 GB; no torch install).
- Commits/PRs carry **no AI attribution** (no Co-Authored-By naming an AI, no session links, no "Generated with").
- Never commit secrets. `backend/.env` (gitignored) holds `GPU_WORKER_MODE=colab`, `GPU_WORKER_URL`, `GPU_WORKER_TOKEN`.
- Read real CI logs before fixing anything; check CI after every push. Never weaken a test.
- Subagents: backend work on Opus, everything else on Sonnet.
- Owner wants ONE branch: `main`. Use a short-lived branch only when CI must run first (CI triggers on `main`, `feat/**`, `fix/**` and PRs to main — NOT `design/**`), merge the same day, then delete it.

## State of `main` (6837a35, CI green on all 8 jobs)

Everything from roadmap T01–T18, N1 splat import, N2 GPU worker, N3 objects → Pascal items, N6 drawings, walkthrough viewer, Colab dispatch, plus today:
- Next.js 16.4.3 (fixed critical RCE advisories; `npm audit` 0 vulnerabilities).
- UI redesign phases 0–2 (PR #11): PRODUCT.md, DESIGN.md, mock in `docs/design/mock/`, light tokens + `.glass`/`.glass-clear` with reduced-transparency / increased-contrast fallbacks, Ellips rename, AI tells removed.
- Codex's auto-level for scans loaded without the room-structure service + Flip button (`frontend/lib/scan/autoLevel.ts`); skipped for the pre-aligned sample scan.
- Notebook fix: cell 4 finds the uploaded file in the working directory.

## Backend: first real end-to-end run DONE (2026-10-24)

`test scene.ply` (707 MB) → local backend → room structure (ceiling ≈ 2.63 m, outline found) → chunked upload to a Colab T4 worker (~5 min) → GPU segmentation (48 views; first ~12 min is model download/gsplat compile) → 24 objects meshed → meshes downloaded. Total ≈ 28.5 min, status "Room ready to review".
- Meshes + summary table + objects.json + room_structure.json saved in `D:\space-gen\ellips-meshes\test-scene-2026-10-24\` (24 GLBs, 7.8 MB). Project in backend: `backend/data/projects/425508aa52ce4cf3a998e9eba0d0055a`.
- Quality: big items plausible (tv 1.47 m, sofa 1.77 m, chair 0.56×0.58×0.75 m); 4 noise clusters (2–13 cm). Fixed by a 20 cm minimum before meshing. Still to improve: low detector confidence (0.27–0.51), some objects placed below the floor (y ≈ -0.4), label mix-ups (rug/armchair). Next: confidence threshold, floor clamp, label sanity checks, N5 review UI.
- Bugs found and fixed on branch `fix/backend-large-scans` (ef17d00, b13f888): asset upload limit was 100 MB (now 2 GiB); backend tests read the developer's `backend/.env` and dispatched real Colab jobs (tests/conftest.py forces the worker off); noise filter. MERGED: main = b13f888 (CI green; one unrelated project-conflict e2e flake passed on rerun).

### Running the GPU worker without the notebook (Colab CLI)

`colab` CLI (google-colab-cli 0.7.5) is installed and logged in (`C:\Users\Ramesh\AppData\Local\Programs\Python\Python315\Scripts\colab.exe`). Free tier allows one GPU runtime (disconnect the browser notebook first). Recipe used:
1. `colab new --gpu T4 -s ellips-worker`
2. ONE long `colab exec -s ellips-worker -f worker_all.py --timeout 15000 --env GPU_WORKER_TOKEN=<token>` that clones main, `pip install -r requirements-gpu-worker.txt`, installs cloudflared, starts `gpu_worker.server.create_app` on :8800 + `cloudflared tunnel`, prints `URL=…`, then loops `time.sleep(60)`. The exec must stay open: a session with no running exec is reclaimed within minutes and the tunnel dies (HTTP 530).
3. Write `GPU_WORKER_MODE=colab`, `GPU_WORKER_URL`, `GPU_WORKER_TOKEN` into `backend/.env` (never print the token), restart backend (`python -m uvicorn main:app --port 8000` in backend/).
4. `colab stop -s ellips-worker` when done (compute units).

## In progress

1. **UI Phase 3 (editor shell)** — branch `design/ui-phase-3` (worktree `.claude/worktrees/agent-ad617970089331ca9`), merged with main and pushed as `feat/ui-phase-3` (a3b2983) for CI. Full-bleed viewport, floating glass toolbar with More menu (All projects, Review scan, Drawings, Present, Export-disabled), collapsible Scene/Ask panels, bottom tool palette + "More tools" overflow, compact bottom sheet, one navy (Share). Local: typecheck/lint/vitest clean, e2e 23/24 per full run (`interpretation-review` timed out under load twice; passes alone 2/2). Screenshots in `docs/design/phase3/shots/`. **CI run 40011149774 FAILED — do not merge yet.** Real regressions under software GL: `architectural-editing.spec.ts:36` and `drawings.spec.ts:10` hit the 5-min timeout; `interpretation-review.spec.ts:11` expects the wall measurement label "≈ 6.0 m (±14 cm est.)" but gets "" (label likely hidden/covered by the new floating panels or not rendered). Download the playwright-report artifact (`gh run download 40011149774`) and look at the traces before changing anything; never loosen the tests.

## Repo clean-up (owner asked; partly done)

Done: Codex WIP committed/merged; `marketing/` renders (372 MB) and `docs/ellips-launch-film.md` moved to `D:\space-gen\ellips-marketing\`; full skill clones moved to `D:\space-gen\skill-sources\`; main checkout back on `main`.

Waiting for the owner's explicit OK (deletes were blocked by the safety classifier):
- Remove worktrees `agent-a5c188a7014d0b967`, `agent-a93d91201d3f4307e`, `agent-ada833d00a7544142` (all merged) and `agent-ad617970089331ca9` after Phase 3 merges.
- Delete local branches: `codex/ellips-animated-launch-film`, `design/ui-phase-0-1`, `design/ui-phase-2`, `design/ui-phase-3` (after merge), `feat/scan-auto-level`, `fix/ci-e2e`, `fix/ci-green`, `fix/next-security`, `fix/notebook-upload-path`, all `worktree-agent-*`.
- Delete remote branches (all merged or superseded): `design/ui-phase-2`, `feat/interpretation-review` (superseded by ADR 003), `feat/object-detection-3d`, `feat/placement-validator`, `feat/room-structure`, `feat/splat-masking`, `feat/scan-auto-level`, `fix/ci-e2e`, `fix/ci-green`, `fix/next-security`, `fix/notebook-upload-path`, `hoplite/phigaleia-cf793096`, `hoplite/skill-packs-4`, `integration/phase2-5`, `may`.
- Delete old files (owner chose delete): `implementation_plan.md`, `master-prompt-ai-3d-design-platform.md`, `SpaceGen_Colab_GPU_Backend.ipynb`, `scripts/update_notebook.py` (only edits that notebook). KEEP `PROJECT_RULES.md`, `GSD-STYLE.md`, `.agent/`, `.agents/`, `.gemini/`, `.gsd/`, `adapters/`, `.planning/` (owner uses Codex, Antigravity/Gemini and GSD).
- Then: commit the 7 design skills in `.claude/skills/` (frontend-design, taste-skill, ui-ux-pro-max, impeccable, vercel-web-design-guidelines, vercel-react-best-practices, apple-design-skill; currently untracked), update README to Ellips with a folder map.

## Next work after that (owner's backlog)

- UI phases 4–6 (import dialog, interpretation review, projects page, walkthrough HUD, share page; measurement dimension-line signature + the one "objects lift out of the scan" motion; review with apple-design / impeccable / vercel skills, FPS check with glass over the splat).
- Fix whatever the first real Colab run shows (speed, upload over tunnel, mesh quality) — backend, Opus.
- Wall textures from the scan (generated but not applied; Pascal wall material is legacy).
- N5 object review (split/merge/relabel) and remove the fake "Detected Scan Objects" list.
- `.sog`/`.spz` → convert to .ply before Colab so they get object splitting.
- Competitor-inspired (Real Horizons teardown in github.com/tanishqrameshsolanki-collab/aop-assignment1, `reverse-engineering/realhorizons/`; learn patterns only, never copy code): scale check, visitor measuring on share links, guided setup, splat clean-up, share-link controls.

## Gotchas

- `npm run build:e2e` bakes `NEXT_PUBLIC_API_URL` from `E2E_API_PORT`; build and test with the same port.
- CI e2e runs on SwiftShader (~0.5 fps): tests wait on frames, not fixed timeouts; 5 shards.
- `walkthrough.spec.ts:100` (camera restore after Esc) has flaked once locally; passed on rerun and in CI.
- Stale `frontend/.next/dev` types can make local `tsc` report errors in `.next/`; they are not code errors (CI starts clean).
- Skills load from the session's start folder: start Claude Code in `D:\space-gen\space-gen` (or keep the junctions in `D:\space-gen\.claude\skills`).
