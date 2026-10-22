"""Splat renderers behind one interface.

- render(splat, cam, features) -> RenderOut: alpha-composited features (default RGB), expected depth, alpha.
- contributions(splat, cam, pixel_labels, n_labels) -> (N, n_labels): per Gaussian, the summed
  blending weight w_ip = alpha_ip * T_ip over the pixels carrying each label. This is the quantity
  FlashSplat's closed-form assignment needs; on gsplat it is the gradient of sum(render * onehot)
  w.r.t. per-Gaussian features, because alpha blending is linear in the features.

NumpyRenderer runs anywhere (tests, CPU smoke runs). GsplatRenderer needs CUDA + gsplat.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

import numpy as np

from gpu_worker.splat import Splat
from services.object_detection.geometry import CameraView


@dataclass
class RenderOut:
    features: np.ndarray  # (H, W, D)
    depth: np.ndarray  # (H, W) expected depth in scene meters, 0 where empty
    alpha: np.ndarray  # (H, W)


class Renderer(Protocol):
    def render(self, splat: Splat, cam: CameraView, features: Optional[np.ndarray] = None) -> RenderOut: ...

    def contributions(self, splat: Splat, cam: CameraView, pixel_labels: np.ndarray, n_labels: int) -> np.ndarray: ...


@dataclass
class _Fragments:
    pix: np.ndarray
    gid: np.ndarray
    w: np.ndarray
    z: np.ndarray


class NumpyRenderer:
    """Front-to-back alpha compositing of projected Gaussians.

    shortcut: isotropic screen footprint from the mean scale (no covariance projection) and a
    radius cap; exact enough for roughly isotropic synthetic splats, use GsplatRenderer for real scenes.
    """

    def __init__(self, max_radius: int = 10, near: float = 0.05):
        self.max_radius = max_radius
        self.near = near
        self._cache: tuple = (None, None, None)

    def _fragments(self, splat: Splat, cam: CameraView) -> _Fragments:
        if self._cache[0] is splat and self._cache[1] is cam:
            return self._cache[2]
        uv, z = cam.project(splat.means)
        sigma = splat.scales.mean(axis=1) * cam.K[0, 0] / np.maximum(z, 1e-6)
        sigma = np.maximum(sigma, 0.5)
        radius = np.minimum(np.ceil(3 * sigma), self.max_radius).astype(int)
        keep = (
            (z > self.near)
            & (uv[:, 0] > -radius)
            & (uv[:, 0] < cam.width + radius)
            & (uv[:, 1] > -radius)
            & (uv[:, 1] < cam.height + radius)
        )
        pix, gid, w, zz = [], [], [], []
        for r in np.unique(radius[keep]):
            g = np.nonzero(keep & (radius == r))[0]
            off = np.arange(-r, r + 1)
            ox, oy = np.meshgrid(off, off)
            px = np.floor(uv[g, 0])[:, None] + ox.ravel()[None]
            py = np.floor(uv[g, 1])[:, None] + oy.ravel()[None]
            d2 = (px + 0.5 - uv[g, 0][:, None]) ** 2 + (py + 0.5 - uv[g, 1][:, None]) ** 2
            a = np.minimum(splat.opacities[g][:, None] * np.exp(-0.5 * d2 / sigma[g][:, None] ** 2), 0.99)
            ok = (a > 1 / 255) & (px >= 0) & (px < cam.width) & (py >= 0) & (py < cam.height)
            pix.append((py * cam.width + px)[ok].astype(np.int64))
            gid.append(np.broadcast_to(g[:, None], ok.shape)[ok])
            w.append(a[ok])
            zz.append(np.broadcast_to(z[g][:, None], ok.shape)[ok])
        if pix:
            pix, gid, a, zz = (np.concatenate(x) for x in (pix, gid, w, zz))
        else:
            pix, gid, a, zz = (np.zeros(0, int), np.zeros(0, int), np.zeros(0), np.zeros(0))
        order = np.lexsort((zz, pix))
        pix, gid, a, zz = pix[order], gid[order], a[order], zz[order]
        # transmittance before each fragment = exp(sum of log(1 - a) of earlier fragments of the same pixel)
        la = np.log1p(-a)
        csum = np.cumsum(la) - la
        start = np.r_[0, np.nonzero(np.diff(pix))[0] + 1] if len(pix) else np.zeros(0, int)
        group_start = np.repeat(csum[start], np.diff(np.r_[start, len(pix)])) if len(pix) else csum
        frag = _Fragments(pix, gid, a * np.exp(csum - group_start), zz)
        self._cache = (splat, cam, frag)
        return frag

    def render(self, splat: Splat, cam: CameraView, features: Optional[np.ndarray] = None) -> RenderOut:
        feats = splat.colors if features is None else features
        f = self._fragments(splat, cam)
        hw = cam.width * cam.height
        out = np.zeros((hw, feats.shape[1]))
        np.add.at(out, f.pix, f.w[:, None] * feats[f.gid])
        alpha = np.bincount(f.pix, f.w, minlength=hw)
        depth = np.bincount(f.pix, f.w * f.z, minlength=hw) / np.maximum(alpha, 1e-9)
        shape = (cam.height, cam.width)
        return RenderOut(out.reshape(*shape, -1), depth.reshape(shape), alpha.reshape(shape))

    def contributions(self, splat: Splat, cam: CameraView, pixel_labels: np.ndarray, n_labels: int) -> np.ndarray:
        f = self._fragments(splat, cam)
        out = np.zeros((len(splat), n_labels))
        np.add.at(out, (f.gid, pixel_labels.reshape(-1)[f.pix]), f.w)
        return out


class GsplatRenderer:
    """CUDA path via gsplat (Apache-2.0). Not exercised by the CPU test suite."""

    def __init__(self, device: str = "cuda"):
        import torch
        from gsplat import rasterization

        self.torch, self.rasterization, self.device = torch, rasterization, device
        self._key, self._tensors = None, None

    def _t(self, splat: Splat):
        if self._key is not splat:
            t = self.torch
            f32 = dict(device=self.device, dtype=t.float32)
            self._tensors = (
                t.as_tensor(splat.means, **f32),
                t.as_tensor(splat.quats, **f32),
                t.as_tensor(splat.scales, **f32),
                t.as_tensor(splat.opacities, **f32),
            )
            self._key = splat
        return self._tensors

    def _cam(self, cam: CameraView):
        t = self.torch
        if cam.depth_scale != 1.0:
            raise ValueError("virtual cameras must be metric (depth_scale == 1)")
        view = np.eye(4)
        view[:3, :3], view[:3, 3] = cam.R, cam.t
        f32 = dict(device=self.device, dtype=t.float32)
        return t.as_tensor(view, **f32)[None], t.as_tensor(cam.K, **f32)[None]

    def render(self, splat: Splat, cam: CameraView, features: Optional[np.ndarray] = None) -> RenderOut:
        means, quats, scales, opac = self._t(splat)
        viewmats, Ks = self._cam(cam)
        feats = self.torch.as_tensor(splat.colors if features is None else features, device=self.device).float()
        with self.torch.no_grad():
            img, alpha, _ = self.rasterization(
                means, quats, scales, opac, feats, viewmats, Ks, cam.width, cam.height, render_mode="RGB+ED"
            )
        img = img[0].cpu().numpy()
        return RenderOut(img[..., :-1], img[..., -1], alpha[0, ..., 0].cpu().numpy())

    def contributions(self, splat: Splat, cam: CameraView, pixel_labels: np.ndarray, n_labels: int) -> np.ndarray:
        t = self.torch
        means, quats, scales, opac = self._t(splat)
        viewmats, Ks = self._cam(cam)
        feats = t.zeros((len(splat), n_labels), device=self.device, requires_grad=True)
        img, _, _ = self.rasterization(means, quats, scales, opac, feats, viewmats, Ks, cam.width, cam.height)
        onehot = t.nn.functional.one_hot(t.as_tensor(pixel_labels, device=self.device).long(), n_labels).float()
        (img[0] * onehot).sum().backward()
        return feats.grad.cpu().numpy()


def get_renderer(name: str = "auto") -> Renderer:
    if name in ("auto", "gsplat"):
        try:
            import torch

            if torch.cuda.is_available():
                return GsplatRenderer()
        except ImportError:
            pass
        if name == "gsplat":
            raise RuntimeError("gsplat renderer needs torch with CUDA and the gsplat package")
    return NumpyRenderer()
