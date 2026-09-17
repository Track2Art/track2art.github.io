"""Render the oven hero with Track2Art overlays and a slow-motion opening segment."""
import json, shutil, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "visualizer/assets/real/scene32"
COLORS = {1: "#54c7ff", 2: "#ff9f55", 3: "#75ddb0"}

def load_js(name):
    text = (ASSETS / name).read_text()
    return json.loads(text[text.index("=") + 1:].rstrip(" ;\n"))

def project(point, intrinsics, crop):
    x, y, z = point[:3]
    return None if z <= 0 else (intrinsics["fx"] * x / z + intrinsics["cx"] - crop[0], intrinsics["cy"] - intrinsics["fy"] * y / z - crop[1])

def render_frame(scene, prediction, index, output):
    image = Image.open(ROOT / "visualizer" / scene["frames"][index]["rgb"]).convert("RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    for track in prediction["tracks"]:
        samples, color, trail = track["samples"], COLORS.get(track["part"], "#c9d6d2"), []
        for trail_index in range(max(0, index - 12), index + 1):
            sample = samples[trail_index]
            if sample: trail.append((sample[3] - scene["crop"][0], sample[4] - scene["crop"][1]))
        if len(trail) > 1: draw.line(trail, fill=color + "b8", width=2)
        if trail:
            x, y = trail[-1]
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=color + "ee", outline="#f5fffbdd", width=1)
    axis = prediction["axes"][0]
    pivot, direction = axis["pivot"], axis["direction"]
    endpoints = [project([pivot[j] + sign * .24 * direction[j] for j in range(3)], scene["intrinsics"], scene["crop"]) for sign in (-1, 1)]
    pivot_2d = project(pivot, scene["intrinsics"], scene["crop"])
    if all(endpoints) and pivot_2d:
        draw.line(endpoints, fill="#ffdd68ee", width=4)
        x, y = pivot_2d
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill="#fff0a8ff", outline="#17201fff", width=2)
    image.save(output, quality=91)

def main():
    scene, prediction = load_js("scene.js"), load_js("prediction.js")
    with tempfile.TemporaryDirectory(prefix="track2art-hero-") as directory:
        directory = Path(directory); rendered, timeline = directory / "rendered", directory / "timeline"
        rendered.mkdir(); timeline.mkdir()
        for index in range(len(scene["frames"])): render_frame(scene, prediction, index, rendered / f"frame-{index:03}.jpg")
        output_index = 0
        for index in range(len(scene["frames"])):
            repeats = 1 if index < 10 or index > 38 else (2 if index % 4 else 3)
            for _ in range(repeats):
                shutil.copy2(rendered / f"frame-{index:03}.jpg", timeline / f"frame-{output_index:04}.jpg"); output_index += 1
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "30", "-i", str(timeline / "frame-%04d.jpg"), "-vf", "crop=676:380:0:100,scale=1280:720:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(ROOT / "assets/hero-track2art.mp4")], check=True)
        print(f"Rendered {output_index} frames ({output_index / 30:.2f}s)")

if __name__ == "__main__": main()
