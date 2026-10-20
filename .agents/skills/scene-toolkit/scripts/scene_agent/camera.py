"""Calibrated pinhole camera fit, fixed square pixels and image-centred principal point.

World coordinates: metres, Z up. Camera: +X right, +Y down, +Z forward.
Input initial estimate is mandatory; this is a local fit, not image understanding.
"""
import math


def project(points, position, rotvec, focal_px, size):
    import numpy as np
    from scipy.spatial.transform import Rotation
    points = np.asarray(points, dtype=float)
    q = (Rotation.from_rotvec(rotvec).as_matrix() @ (points-np.array(position)).T).T
    safe_z = np.maximum(q[:, 2], 1e-6)
    uv = q[:, :2] / safe_z[:, None] * focal_px + np.array(size)/2
    return uv, q[:, 2]


def fit_camera(data):
    import numpy as np
    from scipy.optimize import least_squares
    from scipy.spatial.transform import Rotation
    size = np.asarray(data["image_size"], dtype=float)
    points = np.asarray(data["world_points"], dtype=float)
    pixels = np.asarray(data["image_points"], dtype=float)
    if size.shape != (2,) or (size <= 0).any() or not np.isfinite(size).all():
        raise ValueError("image_size must contain two positive finite numbers")
    if points.ndim != 2 or points.shape[1] != 3 or pixels.shape != (len(points), 2):
        raise ValueError("Expected aligned Nx3 world_points and Nx2 image_points")
    if len(points) < 6 or not np.isfinite(points).all() or not np.isfinite(pixels).all():
        raise ValueError("At least six finite correspondences required")
    hold = data.get("holdout_indices", [])
    if any(type(i) is not int or i < 0 or i >= len(points) for i in hold) or len(set(hold)) != len(hold):
        raise ValueError("Invalid holdout_indices")
    train = np.array([i for i in range(len(points)) if i not in hold])
    if len(train) < 6 or np.linalg.matrix_rank(points[train]-points[train].mean(axis=0)) < 3:
        raise ValueError("Training requires six non-coplanar points; a single facade cannot solve this fit")
    initial = data["initial"]
    focal = float(initial["focal_px"])
    if not math.isfinite(focal) or focal <= 0:
        raise ValueError("initial.focal_px must be positive")
    x0 = np.array([*initial["position"], *initial["rotvec_world_to_camera"], math.log(focal)], dtype=float)
    if x0.shape != (7,) or not np.isfinite(x0).all():
        raise ValueError("Invalid initial camera")
    def residual(x):
        uv, z = project(points[train], x[:3], x[3:6], np.exp(x[6]), size)
        # Fixed-size depth penalty discourages fitting mirrored / behind-camera points.
        return np.concatenate([(uv-pixels[train]).ravel(), np.minimum(z-.01, 0)*1000])
    bounds = ([-np.inf]*6 + [math.log(size[0]*.1)], [np.inf]*6 + [math.log(size[0]*20)])
    result = least_squares(residual, x0, loss="soft_l1", f_scale=2, bounds=bounds, max_nfev=3000,
                           xtol=1e-12, ftol=1e-12, gtol=1e-12)
    x = result.x
    uv, depth = project(points, x[:3], x[3:6], np.exp(x[6]), size)
    errs = np.linalg.norm(uv-pixels, axis=1)
    rotation = Rotation.from_rotvec(x[3:6]).as_matrix()
    return {"converged": bool(result.success and (depth > 0).all()), "position_m": x[:3].tolist(),
            "rotvec_world_to_camera": x[3:6].tolist(), "world_to_camera_rotation": rotation.tolist(),
            "focal_px": float(np.exp(x[6])), "horizontal_fov_degrees": math.degrees(2*math.atan(size[0]/(2*np.exp(x[6])))),
            "image_size": size.tolist(), "training_rms_px": float(np.sqrt(np.mean(errs[train]**2))),
            "holdout_rms_px": float(np.sqrt(np.mean(errs[hold]**2))) if hold else None,
            "point_errors_px": errs.tolist(), "all_points_in_front": bool((depth > 0).all()),
            "limitations": ["Fixed image-centred principal point", "No lens distortion fit", "Local optimization; inspect overlay",
                            "Low reprojection error does not establish unseen geometry"]}
