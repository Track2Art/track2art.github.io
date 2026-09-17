"""Build compact, unified project-page assets for selected LightWheel results."""

import json
import re
import shutil
import subprocess
from pathlib import Path


PAGE = Path(__file__).resolve().parents[1]
ROOT = PAGE.parent
EXPERIMENT = ROOT / "outputs/paper_experiments/lightwheel_fusion_a5_v1/qualitative"
OUTPUT = PAGE / "visualizer/assets/lightwheel"
OBJECTS = {
    "microwave053": ROOT / "outputs/recordings/microwave053",
    "refrigerator038": ROOT / "outputs/recordings_refrigerators_staged/refrigerator038",
}


def load_embedded_data(object_id):
    text = (EXPERIMENT / f"viewers/{object_id}/viewer.html").read_text()
    match = re.search(r"const DATA = (\{.*?\});\s*\n", text, re.S)
    if not match:
        raise RuntimeError(f"Cannot find embedded viewer data for {object_id}")
    return json.loads(match.group(1))


def load_ply(path):
    lines = path.read_text().splitlines()
    start = lines.index("end_header") + 1
    points = []
    for line in lines[start:]:
        x, y, z, part = line.split()[:4]
        points.extend((round(float(x), 4), round(float(y), 4), round(float(z), 4),
                       132, 160, 174, 0, 1))
    return points


def build(object_id, recording):
    embedded = load_embedded_data(object_id)
    episode = json.loads((recording / "episode.json").read_text())
    inference = json.loads((EXPERIMENT / f"inference/{object_id}/joint_inference.json").read_text())
    manifest_path = ROOT / f"outputs/reart_sequences/lightwheel_{'microwaves' if object_id.startswith('microwave') else 'refrigerators'}_open/{object_id}/reart_sequence_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    out = OUTPUT / object_id
    out.mkdir(parents=True, exist_ok=True)

    frames = []
    camera_poses = []
    source_indices = []
    for item in manifest["frames"]:
        source_index = item["local_frame_index"] * manifest["frame_stride"]
        source_indices.append(source_index)
        source = recording / episode["frames"][source_index]["rgb_path"]
        name = f"rgb-{item['local_frame_index']:03}.jpg"
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82",
                        str(source), "--out", str(out / name)], check=True,
                       stdout=subprocess.DEVNULL)
        frames.append({
            "time": episode["frames"][source_index]["timestamp_s"],
            "rgb": f"assets/lightwheel/{object_id}/{name}",
            "points": load_ply(Path(item["output_path"])),
        })
        camera_poses.append(episode["frames"][source_index]["camera_pose"])

    tracks = []
    for track in embedded["tracks"]:
        by_frame = {sample["frame_index"]: sample["xyz"] for sample in track["samples"]}
        tracks.append({
            "part": int(track["pred_cluster"]),
            "samples": [by_frame.get(index) for index in source_indices],
        })
    for frame_index, frame in enumerate(frames):
        for track in tracks:
            sample = track["samples"][frame_index]
            if sample:
                frame["points"].extend((*[round(value, 4) for value in sample],
                                        220, 235, 238, track["part"], 1))

    axes = []
    active = inference.get("active_slots", [])
    for edge in inference.get("selected_edges", []):
        edge_probability = float(edge.get("edge_probability", 0))
        observability = float(edge.get("axis_observability", edge.get("observability_score", 0)))
        if edge_probability < .95 or observability < .70:
            continue
        axes.append({
            "pivot": edge["axis_line_point_world"],
            "direction": edge["axis_world"],
            "type": edge["joint_type"],
            "parent": active.index(edge["parent_slot_id"]) + 1 if edge["parent_slot_id"] in active else 0,
            "child": active.index(edge["child_slot_id"]) + 1 if edge["child_slot_id"] in active else 0,
            "confidence": edge_probability,
        })

    lower, upper = embedded["scene_bounds"]["lower"], embedded["scene_bounds"]["upper"]
    payload = {
        "id": f"lightwheel_{object_id}",
        "fps": 15 / manifest["frame_stride"],
        "crop": [0, 0, 640, 480],
        "width": 640,
        "height": 480,
        "intrinsics": episode["camera_intrinsics"],
        "frames": frames,
        "cameraPoses": camera_poses,
        "tracks": tracks,
        "parts": sorted({track["part"] for track in tracks}),
        "axes": axes,
        "center": [(a + b) / 2 for a, b in zip(lower, upper)],
        "extent": max(b - a for a, b in zip(lower, upper)),
        "displayRotation": 0,
        "initialZoom": 2.15,
    }
    (out / "data.js").write_text("window.PARTNET_OBJECT=" + json.dumps(payload, separators=(",", ":")) + ";\n")
    print(object_id, len(frames), "frames", len(payload["parts"]), "parts", len(axes), "axes")


if __name__ == "__main__":
    for key, value in OBJECTS.items():
        build(key, value)
