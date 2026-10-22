# GPU worker setup (Colab)

Importing a `.ply` splat runs: upload → room structure (local) → **separate objects (GPU worker)** → ready. The objects stage sends the scan to a GPU worker, which renders it from virtual cameras inside the room, segments it with OWLv2/Grounding DINO + SAM 2, and meshes every object (ADR 002). The editor then gets one Pascal item per object (its own GLB, measured size, placement) plus a mask that hides the object's original splats. Items are selectable, movable, resizable and replaceable like any other item; one undo removes them all.

## Modes

Set in `backend/.env` (untracked; never commit the URL or token):

| `GPU_WORKER_MODE` | What the objects stage does |
| :--- | :--- |
| `off` (default) | Skipped; the import stops after the room structure, as before. |
| `colab` | Uploads the scan to the worker at `GPU_WORKER_URL` with `GPU_WORKER_TOKEN`. |
| `fake` | Runs the same worker app and pipeline on the CPU in a local child process (`gpu_worker/fake_server.py`; numpy renderer, geometric masks instead of SAM), started on first use and stopped with the backend. For development and CI with small synthetic scans; real scans are far too slow and are not segmented semantically. |

## Run it with Colab

1. Make sure the worker code is on GitHub: the notebook clones `BRANCH` (default `main`) of `REPO_URL`. Until this work is merged, set `BRANCH` in cell 1 to the branch that contains it.
2. Open `notebooks/gpu_worker.ipynb` in Colab (File → Open notebook → GitHub, or upload the file).
3. Runtime → Change runtime type → **T4 GPU** → Save.
4. Run cell **1** (checks the GPU, clones the repo), cell **2** (installs the worker deps, 3–5 min) and cell **5** (starts the worker and a Cloudflare quick tunnel). Cells 3 and 4 are optional checks.
5. Cell 5 prints exactly two lines:
   ```
   GPU_WORKER_URL=https://<random-words>.trycloudflare.com
   GPU_WORKER_TOKEN=<random token>
   ```
6. Put them in `backend/.env` together with the mode:
   ```
   GPU_WORKER_MODE=colab
   GPU_WORKER_URL=https://<random-words>.trycloudflare.com
   GPU_WORKER_TOKEN=<random token>
   ```
7. Restart the backend from the `backend/` directory (settings are read at start-up): `python -m uvicorn main:app --port 8000`.
8. In the editor: **Convert Scan** → choose the `.ply` → **Upload & convert**. The dialog shows the objects stage live, e.g. `Uploading 340/700 MB`, `Segmenting on GPU… (detect 12/48)`, `Downloading 7/12 meshes`. When it closes, the objects are in the scene panel under *Furniture*, and the project autosaves.

Keep the Colab tab open while you work. Each run of cell 5 creates a **new** URL (quick tunnels are throwaway), and Colab disconnects idle runtimes; then repeat steps 4–7.

## When something goes wrong

The objects stage never waits forever: a dead worker, an expired tunnel, a rejected token or a job running longer than 2 hours ends the stage with a message in the dialog. The room structure is kept. The dialog then offers:

- **Retry objects** — re-runs the stage (`POST /api/room-structure/conversions/{jobId}/objects/retry`). The upload resumes: chunks the worker already has are not sent again, and a finished upload is reused.
- **Continue without objects** — keeps the room and the scan as one splat.

| Message | Fix |
| :--- | :--- |
| `Cannot reach the GPU worker … tunnel has probably expired` | The notebook stopped or cell 5 was re-run. Re-run cell 5, copy the new `GPU_WORKER_URL`, restart the backend, retry. |
| `The GPU worker rejected the token` | `GPU_WORKER_TOKEN` in `backend/.env` does not match the notebook's. |
| `GPU_WORKER_MODE=colab needs GPU_WORKER_URL and GPU_WORKER_TOKEN` | Add both lines to `backend/.env` and restart. |
| `The GPU worker failed: …` | The pipeline raised on the worker; the Colab cell output has the traceback. |
| `Separating objects needs a .ply scan` | `.sog`/`.spz` imports keep the scan as one splat; export a `.ply` instead. |

## How the upload works

Cloudflare quick tunnels reject request bodies over ~100 MB and scans are ~700 MB, so the backend uploads in chunks (`backend/gpu_worker/client.py`, worker side in `server.py`):

1. `POST /uploads {size, sha256, chunkSize}` → `{uploadId, chunks, received, complete}`. Asking again with the same file returns the same upload (resume).
2. `PUT /uploads/{id}/chunks/{n}` with 32 MB of raw bytes and `X-Chunk-Sha256`; a wrong hash or size is rejected and the chunk is retried (up to 4 times with backoff on network/5xx errors).
3. `POST /uploads/{id}/complete` assembles the chunks and checks the whole-file sha256.
4. `POST /jobs {uploadId, interpretation, scanToScene}` starts segmentation with the room structure, so virtual cameras are placed inside the room in the scene frame (Y-up, metres, floor y = 0).

Every request carries `Authorization: Bearer <token>`. The backend polls `GET /jobs/{id}` with backoff (2 s → 15 s), downloads each object GLB and shell texture, and stores them in the project asset store under content-hash names (`/api/projects/{id}/assets/<sha256>.glb|.png`). A summary is written to `backend/data/projects/<id>/objects/<jobId>.json`.

## What is and is not verified

- Verified on this Windows machine (CPU): chunked upload, resume, hash and size checks, auth (`backend/tests/test_gpu_dispatch.py`); the dispatch state machine for success, worker offline, bad token, timeout, worker failure, retry and artefact-name confinement; the full import → objects → Pascal items → move → save → reload flow in Playwright with `GPU_WORKER_MODE=fake`.
- **Not verified:** a real Colab GPU run, a real Cloudflare tunnel, upload speed of a 700 MB scan, and segmentation quality on real scans (see ADR 002 §9).
- Shell textures: the baked floor texture is applied to the Pascal slab when you click *Build editable room*; wall textures are stored but not applied yet (Pascal's wall `material` is a legacy field and the wall face ↔ interior mapping is unverified).
