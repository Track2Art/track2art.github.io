"""Build the website oven scene from the final postprocessed real-data result."""
import json
import pickle
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT.parent / "data/track2art_real_new_20260831/extracted/ofen_hand_close"
RESULTS = ROOT.parent / "outputs/paper_experiments/real_0831_oven_final_v1/postprocessed"
ASSET_ID = "scene32-mv"
ASSETS = ROOT / f"visualizer/assets/real/{ASSET_ID}"
FRAME_STEP = 3
MAX_TRACKS_PER_SLOT_PER_VIEW = 80
MAX_DENSE_POINTS_PER_VIEW = 700
VIEW_INDEX = 1


def fit_world_to_camera(tracks, intrinsics):
    fx, fy, cx, cy = intrinsics
    world_points, camera_points = [], []
    for track in tracks:
        if track["view_index"] != VIEW_INDEX:
            continue
        for sample in track["samples"]:
            if not sample or not sample.get("visible") or not sample.get("depth_valid"):
                continue
            depth, uv, world = sample.get("selected_depth_m"), sample.get("uv"), sample.get("xyz_world")
            if depth is None or uv is None or world is None:
                continue
            u, v = uv
            world_points.append(world)
            camera_points.append([(u - cx) / fx * depth, (cy - v) / fy * depth, depth])
            if len(world_points) == 10000:
                break
        if len(world_points) == 10000:
            break
    world_points, camera_points = np.asarray(world_points), np.asarray(camera_points)
    keep = np.ones(len(world_points), dtype=bool)
    for _ in range(5):
        source_center, target_center = world_points[keep].mean(0), camera_points[keep].mean(0)
        u, _, vt = np.linalg.svd((world_points[keep] - source_center).T @ (camera_points[keep] - target_center))
        transform = vt.T @ u.T
        translation = target_center - transform @ source_center
        errors = np.linalg.norm(world_points @ transform.T + translation - camera_points, axis=1)
        keep = errors < np.quantile(errors, .85)
    return transform, translation, float(np.median(errors))


def main():
    metadata = json.loads((DATA / "metadata.json").read_text())
    source = json.loads((RESULTS / "viewers/oven_hand_close/viewer_tracks.json").read_text())
    inference = json.loads((RESULTS / "oven_hand_close/joint_inference.json").read_text())
    camera_intrinsics = metadata["intrinsics"][VIEW_INDEX]
    fx, fy, cx, cy = camera_intrinsics[0][0], camera_intrinsics[1][1], camera_intrinsics[0][2], camera_intrinsics[1][2]
    transform, translation, fit_error = fit_world_to_camera(source["tracks"], (fx, fy, cx, cy))
    camera_to_world = pickle.loads((DATA / "calibrate.pkl").read_bytes())
    assignments = dict(zip(inference["track_ids"], inference["track_slot_assignments"]))
    candidates = {(slot, view): [] for slot in (5, 7) for view in range(3)}
    for track in source["tracks"]:
        slot = assignments.get(track["track_id"])
        key = (slot, track["view_index"])
        if key in candidates:
            candidates[key].append(track)
    selected = []
    for (slot, view), tracks in candidates.items():
        tracks.sort(key=lambda track: track["track_quality"].get("visible_ratio", 0), reverse=True)
        selected.extend((slot, view, track) for track in tracks[:MAX_TRACKS_PER_SLOT_PER_VIEW])

    frame_indices = list(range(0, metadata["frame_num"], FRAME_STEP))
    ASSETS.mkdir(parents=True, exist_ok=True)
    frames, labels = [], []
    for output_index, source_index in enumerate(frame_indices):
        image = Image.open(DATA / f"color/{VIEW_INDEX}/{source_index}.png").convert("RGB")
        image.save(ASSETS / f"rgb-{output_index:03}.webp", "WEBP", quality=82, method=6)
        points, frame_labels = [], []
        for view in range(3):
            seeds, seed_labels = [], []
            for slot, track_view, track in selected:
                if track_view != view:
                    continue
                sample = track["samples"][source_index]
                if not sample or not sample.get("visible") or not sample.get("depth_valid"):
                    continue
                seeds.append(sample["xyz_world"])
                seed_labels.append(1 if slot == 5 else 2)
            if not seeds:
                continue

            depth = np.load(DATA / f"depth/{view}/{source_index}.npy").astype(np.float32) / 1000
            color_image = np.asarray(Image.open(DATA / f"color/{view}/{source_index}.png").convert("RGB"))
            yy, xx = np.mgrid[0:depth.shape[0]:4, 0:depth.shape[1]:4]
            z = depth[yy, xx]
            valid = (z > .15) & (z < 2.5)
            xx, yy, z = xx[valid], yy[valid], z[valid]
            K = np.asarray(metadata["intrinsics"][view])
            camera = np.column_stack(((xx - K[0, 2]) / K[0, 0] * z,
                                      (yy - K[1, 2]) / K[1, 1] * z, z,
                                      np.ones_like(z)))
            world = (camera_to_world[view] @ camera.T).T[:, :3]
            squared_distance = ((world[:, None, :] - np.asarray(seeds)[None, :, :]) ** 2).sum(axis=2)
            nearest = squared_distance.argmin(axis=1)
            distance = np.sqrt(squared_distance[np.arange(len(world)), nearest])
            keep = np.flatnonzero(distance < .045)
            if len(keep) > MAX_DENSE_POINTS_PER_VIEW:
                keep = keep[np.linspace(0, len(keep) - 1, MAX_DENSE_POINTS_PER_VIEW, dtype=int)]
            display_view = 0 if view == VIEW_INDEX else view + 1
            for dense_index in keep:
                part = seed_labels[nearest[dense_index]]
                point = transform @ world[dense_index] + translation
                rgb = color_image[yy[dense_index], xx[dense_index]].tolist()
                points.extend([*point.tolist(), *rgb, part, display_view])
                frame_labels.append(part)
        frames.append({"sourceFrame": source_index, "time": source_index / metadata["fps"],
                       "rgb": f"assets/real/{ASSET_ID}/rgb-{output_index:03}.webp",
                       "mask": [0, 848 * 480], "points": points})
        labels.append(frame_labels)

    web_tracks = []
    for slot, view, track in selected:
        samples = []
        for source_index in frame_indices:
            sample = track["samples"][source_index]
            if not sample or not sample.get("visible") or not sample.get("depth_valid"):
                samples.append(None)
                continue
            point = transform @ np.asarray(sample["xyz_world"]) + translation
            samples.append([*point.tolist(), *sample["uv"]])
        display_view = 0 if view == VIEW_INDEX else view + 1
        web_tracks.append({"id": track["track_id"], "part": 1 if slot == 5 else 2, "view": display_view, "samples": samples})

    all_points = np.asarray([point[:3] for frame in frames for point in np.asarray(frame["points"]).reshape(-1, 8)])
    scene = {"id": ASSET_ID, "name": "Oven · Hand close · Multiview preview", "category": "Oven", "fps": metadata["fps"] / FRAME_STEP,
             "crop": [0, 0, 848, 480], "intrinsics": {"fx": fx, "fy": fy, "cx": cx, "cy": cy},
             "center": np.median(all_points, axis=0).tolist(), "parts": {"1": "Predicted Slot 5", "2": "Predicted Slot 7"},
             "frames": frames, "tracks": web_tracks}
    edge = inference["selected_edges"][0]
    direction = transform @ np.asarray(edge["axis_world"])
    pivot = transform @ np.asarray(edge["axis_line_point_world"]) + translation
    prediction = {"parts": scene["parts"], "labels": labels, "tracks": web_tracks,
                  "axes": [{"pivot": pivot.tolist(), "direction": direction.tolist(), "type": edge["joint_type"],
                            "parent": 1, "child": 2, "probability": edge["edge_probability"],
                            "confidence": edge["joint_confidence"]}],
                  "source": "final postprocessed oven_hand_close", "propagationRadiusM": 0.03}
    (ASSETS / "scene.js").write_text("window.PART_SCENE=" + json.dumps(scene, separators=(",", ":")) + ";\n")
    (ASSETS / "prediction.js").write_text("window.PART_PREDICTION=" + json.dumps(prediction, separators=(",", ":")) + ";\n")
    print(f"Built {len(frames)} frames and {len(web_tracks)} tracks; frame-fit median {fit_error * 1000:.2f} mm")


if __name__ == "__main__":
    main()
