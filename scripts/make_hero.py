import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SOURCE = Path("/Users/lxt/Documents/New project/project/part-window/dist/assets/real/scene30")
OUT = Path("assets/hero-frames")
COLORS = {1: (91, 231, 204), 2: (255, 145, 79), 7: (91, 231, 204)}


def load_js(name):
    raw = (SOURCE / name).read_text()
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def hull(points):
    points = sorted(set(points))
    if len(points) <= 2:
        return points

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo = []
    for p in points:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    hi = []
    for p in reversed(points):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def project(p, intr, crop):
    x, y, z = p
    if z <= 1e-5:
        return None
    return (
        intr["fx"] * x / z + intr["cx"] - crop[0],
        intr["fy"] * y / z + intr["cy"] - crop[1],
    )


scene = load_js("scene.js")
pred = load_js("prediction.js")
OUT.mkdir(parents=True, exist_ok=True)
for old_frame in OUT.glob("frame-*.jpg"):
    old_frame.unlink()
crop = scene["crop"]
axis = pred["axes"][0]
pivot = axis["pivot"]
direction = axis["direction"]
axis_points = []
for sign in (-1, 1):
    endpoint = [pivot[i] + sign * 0.16 * direction[i] for i in range(3)]
    axis_points.append(project(endpoint, scene["intrinsics"], crop))

try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 16)
    small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 13)
except OSError:
    font = small = ImageFont.load_default()

for frame_index, frame in enumerate(scene["frames"]):
    image = Image.open(SOURCE / Path(frame["rgb"]).name).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    grouped = {}
    for track_index, track in enumerate(pred["tracks"]):
        sample = track["samples"][frame_index]
        if sample is None:
            continue
        label = track["part"]
        if not label:
            continue
        grouped.setdefault(label, []).append((sample[3] - crop[0], sample[4] - crop[1]))
    for label, points in grouped.items():
        color = COLORS.get(label, (202, 255, 235))
        for x, y in points:
            draw.ellipse((x - 3.1, y - 3.1, x + 3.1, y + 3.1), fill=(*color, 255), outline=(7, 17, 16, 210), width=1)
    for track_index, track in enumerate(pred["tracks"]):
        label = track["part"]
        if not label:
            continue
        color = COLORS.get(label, (202, 255, 235))
        trail = []
        for t in range(max(0, frame_index - 13), frame_index + 1):
            sample = track["samples"][t]
            if sample is not None:
                trail.append((sample[3] - crop[0], sample[4] - crop[1]))
        if len(trail) > 1:
            draw.line(trail, fill=(*color, 225), width=3)
    if all(axis_points):
        a, b = axis_points
        px, py = project(pivot, scene["intrinsics"], crop)
        vx, vy = b[0] - a[0], b[1] - a[1]
        norm = max((vx * vx + vy * vy) ** 0.5, 1)
        ux, uy = vx / norm, vy / norm
        a = (px - ux * 145, py - uy * 145)
        b = (px + ux * 145, py + uy * 145)
        draw.line((a, b), fill=(6, 13, 13, 245), width=11)
        draw.line((a, b), fill=(255, 226, 120, 255), width=6)
        draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill=(255, 226, 120, 255), outline=(6, 13, 13, 255), width=3)
        label_x, label_y = max(14, px - 98), max(14, py - 53)
        draw.rounded_rectangle((label_x, label_y, label_x + 196, label_y + 32), radius=8, fill=(8, 16, 24, 220), outline=(255, 226, 120, 210), width=1)
        draw.text((label_x + 13, label_y + 8), "PREDICTED REVOLUTE AXIS", font=small, fill=(255, 239, 180, 255))
    result = Image.alpha_composite(image, overlay).convert("RGB")
    result.save(OUT / f"frame-{frame_index:04d}.jpg", quality=93, subsampling=0)

print(f"wrote {len(scene['frames'])} frames to {OUT}")
