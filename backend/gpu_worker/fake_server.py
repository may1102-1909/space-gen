"""GPU_WORKER_MODE=fake: the real worker app on the CPU pipeline (numpy renderer, geometric pseudo-masks).

Started by services/gpu_dispatch.py as a child process, so the CPU-heavy pipeline never starves the API
server's GIL. `python -m gpu_worker.fake_server <port> <work_root>` with GPU_WORKER_TOKEN set; the process
exits when its stdin closes (i.e. when the backend that started it goes away).
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

from fastapi import FastAPI


def create_fake_app(token: str, work_root: Path) -> FastAPI:
    from gpu_worker.render import NumpyRenderer
    from gpu_worker.server import create_app
    from gpu_worker.synthetic import GeometricMaskDetector

    renderer = NumpyRenderer()
    return create_app(
        token,
        work_root,
        detector_factory=lambda splat: GeometricMaskDetector(splat, renderer),
        renderer_factory=lambda: renderer,
        pipeline_kwargs={"view_size": (128, 96), "target_triangles": 5000},
    )


if __name__ == "__main__":
    import uvicorn

    port, root = int(sys.argv[1]), Path(sys.argv[2])
    # Build the app (imports open3d/cv2) before watching stdin: watching first saw an instant EOF on Windows.
    app = create_fake_app(os.environ["GPU_WORKER_TOKEN"], root)

    def exit_with_parent():
        sys.stdin.buffer.read()
        print("fake GPU worker: backend went away, exiting", file=sys.stderr, flush=True)
        os._exit(0)

    threading.Thread(target=exit_with_parent, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
