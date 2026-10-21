/**
 * ADR 001 candidates (a) and (b), attempted for real in the browser: mount Spark on a
 * three/webgpu WebGPURenderer (optionally forceWebGL) and render a scan. 'webgl-control' runs the
 * same harness on a classic THREE.WebGLRenderer (candidate (c)'s splat layer) so an empty result
 * cannot be a harness artifact. Whatever is thrown is reported verbatim; nothing is simulated.
 */
export type RendererCandidate = 'webgpu' | 'webgpu-force-webgl' | 'webgl-control';

export interface CandidateAttempt {
  candidate: RendererCandidate;
  ok: boolean;
  /** Steps that completed, in order, including which backend three/webgpu selected. */
  steps: string[];
  error?: string;
}

export async function attemptSparkOnWebGPURenderer(candidate: RendererCandidate, scanUrl: string): Promise<CandidateAttempt> {
  const THREE = await import('three');
  const { WebGPURenderer } = await import('three/webgpu');
  const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
  const steps: string[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  let renderer: { render(scene: unknown, camera: unknown): void; dispose(): void } | null = null;
  // three/webgpu reports incompatible materials via console.error rather than throwing; keep them.
  const loggedErrors = new Set<string>();
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    loggedErrors.add(args.map(String).join(' ').slice(0, 200));
    originalError(...args);
  };
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    steps.push(`navigator.gpu adapter: ${gpu ? ((await gpu.requestAdapter()) ? 'available' : 'none') : 'navigator.gpu missing'}`);
    let sparkHost: unknown;
    if (candidate === 'webgl-control') {
      const webgl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
      renderer = webgl;
      sparkHost = webgl;
      steps.push('THREE.WebGLRenderer created');
    } else {
      const webgpu = new WebGPURenderer({ canvas, antialias: false, alpha: true, forceWebGL: candidate === 'webgpu-force-webgl' });
      renderer = webgpu;
      sparkHost = webgpu;
      await webgpu.init();
      const backend = (webgpu.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPUBackend' : 'WebGLBackend';
      steps.push(`WebGPURenderer.init() ok (${backend})`);
    }
    const spark = new SparkRenderer({ renderer: sparkHost });
    steps.push('new SparkRenderer({ renderer }) ok');
    const scene = new THREE.Scene();
    scene.add(spark);
    const mesh = new SplatMesh({ url: scanUrl });
    await mesh.initialized;
    scene.add(mesh);
    steps.push(`SplatMesh loaded (${mesh.numSplats} splats)`);
    // Same viewpoint as the editor's scan focus; the scan's front face is in view from here.
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 1.6, 5);
    camera.lookAt(0, 1, 0);
    // A frame that "returns" may still be empty, and Spark sorts asynchronously, so render up to 60
    // frames (30 s cap, for software GL) and count the pixels actually drawn, read back in the same
    // task as the render. On hardware the WebGLRenderer control draws within ~13 frames.
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d', { willReadFrequently: true })!;
    let drawn = 0;
    let frames = 0;
    const deadline = performance.now() + 30000;
    while (drawn === 0 && frames < 60 && performance.now() < deadline) {
      renderer.render(scene, camera);
      frames += 1;
      context.clearRect(0, 0, probe.width, probe.height);
      context.drawImage(canvas, 0, 0);
      const data = context.getImageData(0, 0, probe.width, probe.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) drawn += 1;
      if (drawn === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    steps.push(`renderer.render(scene, camera) x${frames} returned; pixels drawn: ${drawn} of ${probe.width * probe.height}`);
    for (const message of loggedErrors) steps.push(`console.error: ${message}`);
    return { candidate, ok: drawn > 0, steps, error: drawn > 0 ? undefined : `No exception, but ${frames} rendered frames drew nothing` };
  } catch (error) {
    const e = error as Error;
    return { candidate, ok: false, steps, error: `${e?.name ?? 'Error'}: ${e?.message ?? String(error)}` };
  } finally {
    console.error = originalError;
    renderer?.dispose();
  }
}
