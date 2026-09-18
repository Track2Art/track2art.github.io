"""Build compact project-page assets from final PartNet predictions."""

import json
import shutil
from pathlib import Path

import numpy as np


PAGE = Path(__file__).resolve().parents[1]
ROOT = PAGE.parent
SOURCE = ROOT / "project/part-window/dist/assets/partnet-rgbd"
INFERENCE = ROOT / "outputs/paper_experiments/partnet_final_best_visuals_v1/inference"
OUTPUT = PAGE / "visualizer/assets/partnet-rgbd"
OBJECTS = ("102018", "10620", "12552", "24931", "10638", "45146")
AXIS_OVERRIDES = {
    # The source viewer predates the final joint-type checkpoint.
    "24931": {
        "type": "prismatic",
        "direction": [
            0.040262629548332436,
            0.9983021275005218,
            -0.04209255147630795,
        ],
        "confidence": 0.9997931122779846,
    },
}


def load_js(path):
    text = path.read_text()
    return json.loads(text[text.index("=") + 1 :].rstrip(" ;\n"))


def compact_object(object_id):
    data = load_js(SOURCE / object_id / "data.js")
    inference_path = INFERENCE / f"partnet_{object_id}" / "joint_inference.json"
    inference = json.loads(inference_path.read_text()) if inference_path.exists() else None
    old_count = len(data["frames"])
    indices = np.unique(np.linspace(0, old_count - 1, min(72, old_count), dtype=int)).tolist()

    frames = []
    out_dir = OUTPUT / object_id
    out_dir.mkdir(parents=True, exist_ok=True)
    for new_index, old_index in enumerate(indices):
        frame = data["frames"][old_index]
        points = np.asarray(frame["points"]).reshape(-1, 8)
        if len(points) > 1800:
            points = points[np.linspace(0, len(points) - 1, 1800, dtype=int)]
        rgb_name = f"rgb-{new_index:03}.webp"
        shutil.copy2(SOURCE / object_id / Path(frame["rgb"]).name, out_dir / rgb_name)
        frames.append({"time": frame["time"], "rgb": f"assets/partnet-rgbd/{object_id}/{rgb_name}", "points": points.ravel().tolist()})

    data["frames"] = frames
    data["cameraPoses"] = [data["cameraPoses"][i] for i in indices]
    data["tracks"] = [{**track, "samples": [track["samples"][i] for i in indices]} for track in data["tracks"]]
    data["fps"] *= len(indices) / old_count
    if inference:
        slots = inference["active_slots"]
        data["parts"] = list(range(1, len(slots) + 1))
        data["axes"] = []
        for edge in inference["selected_edges"]:
            confidence = float(edge.get("joint_confidence", 0.0))
            if confidence < .65 or float(edge.get("edge_probability", 0.0)) < .95:
                continue
            data["axes"].append({
                "pivot": edge["axis_line_point_world"],
                "direction": edge["axis_world"],
                "type": edge["joint_type"],
                "parent": slots.index(edge["parent_slot_id"]) + 1,
                "child": slots.index(edge["child_slot_id"]) + 1,
                "confidence": confidence,
            })
    elif object_id in AXIS_OVERRIDES:
        override = AXIS_OVERRIDES[object_id]
        data["axes"] = [{**axis, **override} for axis in data["axes"]]

    payload = json.dumps(data, separators=(",", ":"), allow_nan=False)
    (out_dir / "data.js").write_text(f"window.PARTNET_OBJECT={payload};\n")
    print(json.dumps({"id": object_id, "frames": len(frames), "parts": len(data["parts"]), "axes": len(data["axes"]), "sizeMB": round(len(payload) / 1e6, 2)}))


if __name__ == "__main__":
    for item in OBJECTS:
        compact_object(item)
