# Camera calibration contract

The local solver fits a pinhole camera from explicit 3D/2D correspondences. It does not detect landmarks automatically. Required: `image_size: [width,height]`, aligned `world_points: Nx3`, `image_points: Nx2`, and `initial` with `position`, `rotvec_world_to_camera` and `focal_px`. Optional `holdout_indices` are excluded from fitting.

World units are metres, Z up. Pixels originate at the image top left: X right, Y down. Camera convention is X right, Y down, Z forward. Rotation is a world-to-camera Rodrigues vector in radians. At least six training landmarks must span 3D; reserve additional points for independent verification. The initial pose should put the building in front of the camera and near the intended framing.

```sh
scene-agent camera-fit landmarks.json --out solved.json
scene-agent max-camera solved.json --out matched-camera.ms
```

The fit fixes square pixels and principal point at `[width/2,height/2]`. It does not solve lens shift, crop offset or radial distortion. Architectural renders with corrected verticals may violate these assumptions. For those, use host perspective matching or a calibrated principal-point/distortion extension; do not hide mismatch by warping the building.

## Interpretation

Training RMS measures the fitted landmarks. Holdout RMS measures points the solver did not use. Neither measures unobserved geometry, camera uniqueness or material similarity. A null holdout value means no independent check was supplied. Local convergence can still be the wrong solution; inspect depth signs, residual pattern and image overlays.

Residuals that grow radially suggest distortion; uniform offsets suggest crop/principal-point mismatch; incorrect parallel-line slopes suggest orientation; one region failing can indicate wrong geometry. Select correspondences at slab corners, frame intersections and depth-separated features, not soft foliage tips.

The MAXScript transfer converts the solved axes to Max's local -Z viewing direction and sets CoronaCam FOV, camera transform, output size and active viewport. It does not reset the scene. Reproject the same landmarks through the host camera after transfer. The synthetic example is numerical evidence of the solver, not a claim that every photograph can be calibrated automatically.
