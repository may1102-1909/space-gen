# Room-structure accuracy

SpaceGen shows dimensions it got from a scan as estimates: `≈ 2.35 m (±4 cm est.)`. The `±` comes from a measured error table, one row per `scaleSource`. This page covers how that table is built and what real data it still needs.

## Status

The shipped table (`frontend/lib/measurement/errorTable.json`, `"basis": "synthetic"`) comes from synthetic rooms only. The synthetic scale errors per `scaleSource` are **assumptions** (see `SCALE_FACTORS` in `backend/tests/synthetic_rooms.py`), so the `±` values are placeholders until real rooms are measured. The scene panel's size labels name the basis in their tooltip.

## Data needed

Collect at least 3 real rooms for **each** `scaleSource` you want a credible number for (9 rooms covers all three). For each room:

- A scan through the normal capture flow (`.ply` splat, optionally COLMAP `points3D.txt`).
- The `scaleSource` the scan really has: `none` (no metric anchor), `user_measurement` (calibrated with the in-app scale tool from one measured distance), `sensor` (LiDAR/depth).
- A laser distance meter (±2 mm class) measurement of every interior wall length, face to face at about 1 m height, listed in order around the room.
- Floor-to-ceiling height, measured in at least 2 spots (record the mean).
- Width, height and sill (floor to bottom edge, 0 for doors) of each door/window, inside the frame. The offset (wall start corner to opening **center**) is optional.
- A mix of rooms: at least one non-rectangular room and one cluttered room.

## Reference-room format

One directory per room under `backend/data/accuracy/rooms/<room-id>/`, holding `reference.json` plus the scan files it references. The model is `backend/models/reference_room.py` (`ReferenceRoom`, schemaVersion `1.0`). Lengths are metres.

```json
{
  "schemaVersion": "1.0",
  "id": "living-room-2026-10",
  "groundTruthSource": "laser",
  "instrument": "Bosch GLM 50",
  "measuredAt": "2026-10-21",
  "scan": { "path": "scan.ply", "format": "ply", "colmapPoints": "points3D.txt", "scaleSource": "user_measurement" },
  "ceilingHeight": 2.61,
  "walls": [
    { "id": "north", "length": 4.12 },
    { "id": "east", "length": 3.55 },
    { "id": "south", "length": 4.11 },
    { "id": "west", "length": 3.56 }
  ],
  "openings": [
    { "id": "door", "wall": "south", "kind": "door", "width": 0.82, "height": 2.04, "sill": 0.0 },
    { "id": "window", "wall": "north", "kind": "window", "width": 1.21, "height": 1.18, "sill": 0.92, "offset": 2.05 }
  ]
}
```

`scan.format` is `ply` (splat) or `colmap_points3d`. `scan.upHint` is optional. Walls may be listed clockwise or counter-clockwise from any corner.

**`backend/data/accuracy/` is not gitignored yet.** Real scans and reports should stay out of git; add `backend/data/accuracy/` to `.gitignore`.

### Apple RoomPlan

`backend/services/roomplan_import.py` converts a `CapturedRoom` JSON export (walls, doors, windows, openings; iOS 17 `parentIdentifier` links openings to walls) to a `ReferenceRoom` tagged `groundTruthSource: "roomplan"`. RoomPlan is itself a LiDAR estimate, so treat those rooms as a secondary reference, not laser ground truth. The importer is untested against a real export. USDZ import is a TODO.

## Running

From `backend/`:

```
python -m scripts.accuracy_report                              # real rooms in data/accuracy/rooms
python -m scripts.accuracy_report --synthetic                  # add the synthetic set (runs in CI with no data)
python -m scripts.accuracy_report --synthetic --frontend-table # also rewrite the frontend error table
```

Outputs `accuracy_report.json` and `accuracy_report.md` in `data/accuracy/reports/` (`--out-dir` to change). Once real rooms exist, regenerate the frontend table from real rooms only (without `--synthetic`) so `basis` becomes `real`.

## Method

1. Run `extract_room_structure` on each scan.
2. Match walls: with equal counts, take the cyclic shift and direction that minimise total length error, with a penalty when a reference opening has no recovered opening of the same kind on the mapped wall (this breaks rectangle symmetry). With unequal counts, match greedily by length within 25%.
3. Match openings one-to-one on the mapped wall by kind, then by width + height (+ offset when given).
4. Report mean/max absolute error in cm and in % of the true value, per metric (wall_length, ceiling_height, opening_width, opening_height, opening_sill) and per `scaleSource`, plus wall/opening match counts.
5. Error table: per `scaleSource`, `relativePct` = the **max** relative error over the length metrics (sill excluded, since a door's true sill is 0). The UI shows `±max(1 cm, value × relativePct)`. Max, not mean: with a handful of rooms the mean understates what a user can hit.
