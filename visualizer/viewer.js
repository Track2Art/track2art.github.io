(() => {
  "use strict";
  const P = window.PART_PREDICTION,
    D = window.PART_SCENE,
    canvas = document.querySelector("canvas"),
    ctx = canvas.getContext("2d");
  const detail = document.querySelector(".detail"),
    slider = document.querySelector("#time"),
    output = document.querySelector("output");
  if (!D) {
    detail.textContent = "Data failed to load. Please reopen the page.";
    detail.classList.add("error");
    return;
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [cx, cy, cw, ch] = D.crop,
    K = D.intrinsics,
    C = D.center,
    N = D.frames.length;
  let W = 900,
    H = 520,
    frame = 0,
    mode = 0,
    morph = 0,
    selection = 0,
    flow = true,
    playing = false,
    ready = false,
    last = 0,
    elapsed = 0;
  const partIds = Object.keys(D.parts)
      .map(Number)
      .sort((a, b) => a - b),
    predPartIds = Object.keys(P.parts)
      .map(Number)
      .sort((a, b) => a - b),
    maxPart = Math.max(0, ...partIds, ...predPartIds);
  const displayParts =
    realId === "scene30" ? { 1: "Base", 2: "Lid" } : { 1: "Body", 2: "Door" };
  const predictionPart = (part) =>
    realId === "scene30" ? (part === 1 ? 2 : part === 2 ? 1 : part) : part;
  document
    .querySelectorAll("[data-object]")
    .forEach((link) =>
      link.classList.toggle("active", link.dataset.object === realId),
    );
  document.querySelector("#part-buttons").innerHTML = Array.from(
    { length: maxPart },
    (_, i) => `<button data-part="${i + 1}" aria-pressed="false"></button>`,
  ).join("");
  let yaw = 0,
    pitch = 0,
    viewYaw = 0,
    viewPitch = 0,
    drag = null,
    hits = [],
    cached = -1,
    mask = null,
    dim = Array(maxPart + 1).fill(1);
  const contextAlpha = window.TRACK2ART_VIEWER_CONFIG?.contextAlpha ?? 0.52;
  const imgs = [],
    imagePromises = [],
    surfaces = partIds.map(() => document.createElement("canvas"));
  surfaces.forEach((c) => {
    c.width = cw;
    c.height = ch;
  });
  const tracks = D.tracks,
    frames = D.frames;
  slider.max = N - 1;
  function selectionUI() {
    document
      .querySelectorAll("[data-part]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", Number(b.dataset.part) === selection),
      );
    const axisNote = P.axes.length
      ? "Yellow: confidence-filtered predicted axis"
      : "No joint axis passed the confidence threshold";
    detail.textContent = selection
      ? `${displayParts[selection]} · ${flow ? "CoTracker tracks shown" : "Tracks hidden"} · Other parts dimmed`
      : mode === 3
        ? `${Object.values(displayParts).join(" / ")} · ${axisNote} · Gray: unassigned`
        : "Click the object to select a part. Drag to orbit in 4D.";
  }
  function select(part) {
    selection = part;
    selectionUI();
  }
  function setMode(m) {
    if ((mode === 3) !== (m === 3)) selection = 0;
    mode = m;
    document.querySelectorAll("[data-part]").forEach((b) => {
      if (+b.dataset.part) {
        const label = displayParts[b.dataset.part];
        b.hidden = !label;
        b.textContent = label || "";
      }
    });
    selectionUI();
    if (reduced) morph = m;
    document
      .querySelectorAll("[data-mode]")
      .forEach((b) => b.setAttribute("aria-pressed", +b.dataset.mode === m));
    document.querySelector(".tag").textContent = [
      "PRIMARY CAMERA · RGB",
      "DEPTH RECONSTRUCTION · RGBD",
      "TEMPORAL · 4D POINT CLOUD",
      "TRACK2ART · PART SEG + AXIS",
    ][m];
    document.querySelector(".hint").textContent = m
      ? "Drag to orbit · Click to select a part"
      : "Click a part to view CoTracker tracks";
    document.querySelector("#orbit").hidden = !m;
    canvas.style.cursor = m ? "grab" : "crosshair";
  }
  setMode(0);
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) => (b.onclick = () => setMode(+b.dataset.mode)));
  document
    .querySelectorAll("[data-part]")
    .forEach((b) => (b.onclick = () => select(+b.dataset.part)));
  document.querySelector("#flow").onclick = (e) => {
    flow = !flow;
    e.currentTarget.textContent = `Point flow · ${flow ? "ON" : "OFF"}`;
    e.currentTarget.setAttribute("aria-pressed", flow);
    selectionUI();
  };
  function playUI() {
    document.querySelector("#play").textContent = playing ? "Ⅱ" : "▶";
    document
      .querySelector("#play")
      .setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  document.querySelector("#play").onclick = () => {
    if (ready) {
      playing = !playing;
      playUI();
    }
  };
  slider.oninput = () => {
    const next = +slider.value;
    playing = false;
    playUI();
    loadImage(next).then(() => {
      frame = next;
      cached = -1;
    });
    elapsed = 0;
  };
  document.querySelector("#home").onclick = () => {
    yaw = pitch = 0;
  };
  document.querySelectorAll("[data-orbit]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = b.dataset.orbit;
        yaw += d === "left" ? 0.15 : d === "right" ? -0.15 : 0;
        pitch = Math.max(
          -1,
          Math.min(1, pitch + (d === "up" ? 0.12 : d === "down" ? -0.12 : 0)),
        );
      }),
  );
  new ResizeObserver(() => {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    const d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = W * d;
    canvas.height = H * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }).observe(canvas);
  function layout() {
    const scale = Math.min(W / cw, H / ch);
    return { scale, x: (W - cw * scale) / 2, y: (H - ch * scale) / 2 };
  }
  function project(x, y, z) {
    const a = viewYaw * Math.min(1, morph),
      b = viewPitch * Math.min(1, morph);
    x -= C[0];
    y -= C[1];
    z -= C[2];
    const xx = x * Math.cos(a) + z * Math.sin(a),
      zz = -x * Math.sin(a) + z * Math.cos(a),
      yy = y * Math.cos(b) - zz * Math.sin(b);
    z = y * Math.sin(b) + zz * Math.cos(b) + C[2];
    x = xx + C[0];
    y = yy + C[1];
    const l = layout();
    return [
      l.x + ((K.fx * x) / z + K.cx - cx) * l.scale,
      l.y + ((-K.fy * y) / z + K.cy - cy) * l.scale,
      z,
    ];
  }
  function maskAt(x, y) {
    const l = layout(),
      u = Math.floor((x - l.x) / l.scale),
      v = Math.floor((y - l.y) / l.scale);
    return u >= 0 && u < cw && v >= 0 && v < ch ? mask[v * cw + u] : 0;
  }
  canvas.onpointerdown = (e) => {
    if (!ready || drag) return;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5)
      drag.moved = true;
    if (mode && drag.moved) {
      yaw -= (e.clientX - drag.lx) * 0.006;
      pitch = Math.max(-1, Math.min(1, pitch - (e.clientY - drag.ly) * 0.005));
      canvas.style.cursor = "grabbing";
    }
    drag.lx = e.clientX;
    drag.ly = e.clientY;
  };
  canvas.onpointerup = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved) {
      const r = canvas.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      let part = 0;
      if (morph < 0.15) part = maskAt(x, y);
      if (!part) {
        let best = 100;
        for (const p of hits) {
          const distance = (p[0] - x) ** 2 + (p[1] - y) ** 2;
          if (distance < best) {
            best = distance;
            part = p[3];
          }
        }
      }
      select(part === selection ? 0 : part);
    }
    drag = null;
    canvas.style.cursor = mode ? "grab" : "crosshair";
  };
  canvas.onpointercancel = () => {
    drag = null;
    canvas.style.cursor = mode ? "grab" : "crosshair";
  };
  function loadImage(i) {
    if (imagePromises[i]) return imagePromises[i];
    imagePromises[i] = new Promise((resolve, reject) => {
      const img = new Image();
      imgs[i] = img;
      img.onload = resolve;
      img.onerror = () => reject(new Error(frames[i].rgb));
      img.src = frames[i].rgb;
    });
    return imagePromises[i];
  }
  function prepareFrame() {
    if (cached === frame || !imgs[frame]?.complete) return;
    cached = frame;
    mask = new Uint8Array(cw * ch);
    const runs = frames[frame].mask;
    let offset = 0;
    for (let i = 0; i < runs.length; i += 2) {
      mask.fill(runs[i], offset, offset + runs[i + 1]);
      offset += runs[i + 1];
    }
    surfaces.forEach((c, j) => {
      const s = c.getContext("2d");
      s.clearRect(0, 0, cw, ch);
      s.drawImage(imgs[frame], 0, 0);
      const pixels = s.getImageData(0, 0, cw, ch);
      for (let i = 0; i < mask.length; i++)
        pixels.data[i * 4 + 3] = mask[i] === j + 1 ? 255 : 0;
      s.putImageData(pixels, 0, 0);
    });
  }
  function draw(now) {
    if (!canvas.isConnected) return;
    const dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;
    requestAnimationFrame(draw);
    if (!ready) return;
    if (playing) {
      elapsed += dt * D.fps;
      if (elapsed >= 1) {
        const next = (frame + Math.floor(elapsed)) % N;
        loadImage(next).then(() => {
          frame = next;
          cached = -1;
        });
        elapsed %= 1;
      }
    }
    const ease = reduced ? 1 : 1 - Math.exp(-dt * 9);
    morph += (mode - morph) * ease;
    viewYaw += (yaw - viewYaw) * ease;
    viewPitch += (pitch - viewPitch) * ease;
    dim = dim.map(
      (v, i) =>
        v + ((!selection || selection === i ? 1 : contextAlpha) - v) * ease,
    );
    prepareFrame();
    ctx.clearRect(0, 0, W, H);
    const l = layout(),
      spatial = Math.min(1, morph),
      fusion = 0;
    ctx.globalAlpha = (1 - spatial) * dim[0];
    ctx.drawImage(imgs[frame], l.x, l.y, cw * l.scale, ch * l.scale);
    for (const part of partIds) {
      ctx.globalAlpha = (1 - spatial) * (dim[part] - dim[0]);
      if (ctx.globalAlpha > 0)
        ctx.drawImage(surfaces[part - 1], l.x, l.y, cw * l.scale, ch * l.scale);
    }
    ctx.globalAlpha = 1;
    hits = [];
    if (mode === 0) {
      const raw = frames[frame].points;
      for (let i = 0; i < raw.length; i += 8) {
        if (raw[i + 7]) continue;
        const part = predictionPart(P.labels[frame][i / 8]);
        if (!part) continue;
        const p = project(raw[i], raw[i + 1], raw[i + 2]);
        if (p[2] <= 0.05) continue;
        hits.push([...p, part]);
        if (selection !== part) continue;
        const color = part === 1 ? "95,188,255" : "238,154,91";
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = `rgb(${color})`;
        const size = Math.max(4, l.scale * 5.2);
        ctx.fillRect(p[0] - size / 2, p[1] - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }
    if (spatial > 0.001) {
      const raw = frames[frame].points,
        points = [];
      for (let i = 0; i < raw.length; i += 8) {
        const view = raw[i + 7];
        if (view) continue;
        const p = project(raw[i], raw[i + 1], raw[i + 2]);
        if (p[2] <= 0.05) continue;
        const part =
          mode === 3 ? predictionPart(P.labels[frame][i / 8]) : raw[i + 6];
        const palette = [
            [113, 124, 137],
            [95, 188, 255],
            [238, 154, 91],
            [169, 122, 255],
            [255, 210, 94],
          ],
          blend = Math.max(0, Math.min(1, morph - 2)),
          color = palette[part] || palette[0];
        points.push([
          ...p,
          part,
          ...color.map((v, j) => raw[i + 3 + j] * (1 - blend) + v * blend),
          view,
        ]);
      }
      points.sort((a, b) => b[2] - a[2]);
      for (const p of points) {
        const alpha = spatial * (p[7] ? fusion : 1) * dim[p[3]];
        ctx.globalAlpha = alpha;
        const chosen = selection === p[3],
          r = chosen ? Math.min(255, p[4] * 0.65 + 55) : p[4],
          g = chosen ? Math.min(255, p[5] * 0.65 + 90) : p[5],
          b = chosen ? Math.min(255, p[6] * 0.65 + 75) : p[6];
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        const size = l.scale * (3.2 - fusion * 1.5);
        ctx.fillRect(p[0] - size / 2, p[1] - size / 2, size, size);
        if (alpha > 0.06) hits.push(p);
      }
    }
    ctx.globalAlpha = 1;
    if (selection && flow) {
      for (const tr of mode === 3 || mode === 0 ? P.tracks : tracks) {
        if (predictionPart(tr.part) !== selection || (tr.view && fusion < 0.3))
          continue;
        const current = tr.samples[frame];
        if (!current) continue;
        ctx.beginPath();
        let open = false;
        for (let j = Math.max(0, frame - 12); j <= frame; j++) {
          const s = tr.samples[j];
          if (!s) {
            open = false;
            continue;
          }
          const p = project(s[0], s[1], s[2]);
          if (p[2] < 0.05) {
            open = false;
            continue;
          }
          if (tr.view === 0) {
            const ux = l.x + (s[3] - cx) * l.scale,
              uy = l.y + (s[4] - cy) * l.scale;
            p[0] = ux * (1 - spatial) + p[0] * spatial;
            p[1] = uy * (1 - spatial) + p[1] * spatial;
          }
          open ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
          open = true;
        }
        ctx.globalAlpha = tr.view ? fusion : 0.85;
        ctx.strokeStyle =
          ["#e8fff8", "#78d9ff", "#9bffd0", "#c7a1ff"][selection] || "#ffe078";
        ctx.lineWidth = 1.3;
        ctx.stroke();
        let p = project(...current.slice(0, 3));
        if (tr.view === 0) {
          p[0] =
            (l.x + (current[3] - cx) * l.scale) * (1 - spatial) +
            p[0] * spatial;
          p[1] =
            (l.y + (current[4] - cy) * l.scale) * (1 - spatial) +
            p[1] * spatial;
        }
        ctx.fillStyle = "#e8fff8";
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (mode === 3) {
      for (const axis of P.axes) {
        const ends = [-0.24, 0.24].map((k) =>
          project(...axis.pivot.map((v, i) => v + k * axis.direction[i])),
        );
        const pivot = project(...axis.pivot);
        ctx.strokeStyle = "#ffe078";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ends[0][0], ends[0][1]);
        ctx.lineTo(ends[1][0], ends[1][1]);
        ctx.stroke();
        ctx.fillStyle = "#fff2b3";
        ctx.beginPath();
        ctx.arc(pivot[0], pivot[1], 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "12px system-ui";
        const confidence = axis.confidence ?? axis.probability;
        ctx.fillText(
          `Pred. ${axis.type} axis · conf. ${confidence.toFixed(2)}`,
          Math.max(12, Math.min(W - 290, pivot[0] + 12)),
          Math.max(75, Math.min(H - 40, pivot[1] - 14)),
        );
      }
    }
    slider.value = frame;
    output.textContent = `${frames[frame].time.toFixed(2)} s · ${frame + 1} / ${N}`;
  }
  requestAnimationFrame(draw);
  loadImage(0)
    .then(() => {
      ready = true;
      playing = !reduced;
      playUI();
      selectionUI();
      const prefetch = () =>
        frames.forEach((_, i) => loadImage(i).catch(() => {}));
      window.requestIdleCallback
        ? window.requestIdleCallback(prefetch)
        : setTimeout(prefetch, 250);
    })
    .catch((e) => {
      detail.textContent = `Image failed to load: ${e.message}`;
      detail.classList.add("error");
    });
})();
