(() => {
  const D = window.PARTNET_OBJECT,
    c = document.querySelector("canvas"),
    g = c.getContext("2d");
  const slider = document.querySelector("#time"),
    out = document.querySelector("output"),
    legend = document.querySelector(".legend"),
    tag = document.querySelector(".tag"),
    hint = document.querySelector(".hint"),
    home = document.querySelector("#home");
  let W = 900,
    H = 560,
    f = 0,
    last = 0,
    playing = true,
    viewRot = [1, 0, 0, 0, 1, 0, 0, 0, 1],
    orbitTravel = 0,
    panX = 0,
    panY = 0,
    zoom = D.initialZoom || 1,
    drag = null,
    selected = 0,
    mode = 0,
    morph = 0,
    hits = [],
    ready = false;
  const palette = [
      "#7e8b9d",
      "#ffad5c",
      "#55c7ff",
      "#64dfac",
      "#eb82bd",
      "#b79cff",
      "#f4d563",
      "#66c7c0",
    ],
    images = [],
    imagePromises = [],
    rotation = D.displayRotation || 0,
    contextAlpha = window.TRACK2ART_VIEWER_CONFIG?.contextAlpha ?? 0.52;
  const viewKey = `track2art:view:depth-reversed-v1:${D.id}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(viewKey));
    if (saved && saved.viewRot?.length === 9) {
      viewRot = saved.viewRot;
      orbitTravel = saved.orbitTravel || 0;
      panX = saved.panX || 0;
      panY = saved.panY || 0;
      zoom = saved.zoom || 1;
    }
  } catch {}
  function saveView() {
    try {
      sessionStorage.setItem(
        viewKey,
        JSON.stringify({ viewRot, orbitTravel, panX, panY, zoom }),
      );
    } catch {}
  }
  function resetView() {
    viewRot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    orbitTravel = 0;
    panX = 0;
    panY = 0;
    zoom = D.initialZoom || 1;
    saveView();
  }
  document
    .querySelectorAll("[data-object]")
    .forEach((link) =>
      link.classList.toggle("active", link.dataset.object === id),
    );
  slider.max = D.frames.length - 1;
  for (const p of D.parts) {
    const b = document.createElement("button");
    b.dataset.part = p;
    b.textContent = `Part ${p}`;
    b.setAttribute("aria-pressed", "false");
    document.querySelector(".controls").insertBefore(b, home);
    b.onclick = () => select(p);
  }
  function select(p) {
    selected = selected === p ? 0 : p;
    document
      .querySelectorAll("[data-part]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", +b.dataset.part === selected),
      );
    legend.textContent = selected
      ? `Part ${selected} · CoTracker flow · other parts dimmed`
      : `${D.parts.length} predicted parts · Track2Art shows part assignments and confidence-filtered axes`;
  }
  document.querySelector('[data-part="0"]').onclick = () => select(0);
  function setMode(m) {
    if ((mode === 0) !== (m === 0)) resetView();
    mode = m;
    document
      .querySelectorAll("[data-mode]")
      .forEach((b) => b.setAttribute("aria-pressed", +b.dataset.mode === m));
    tag.textContent = [
      "PRIMARY CAMERA · RGB",
      "CURRENT FRAME · MULTIVIEW RGBD",
      "CURRENT FRAME · THREE-VIEW 4D",
      "TRACK2ART · PART SEG + AXIS",
    ][m];
    hint.textContent = m
      ? "Drag to orbit · Control + drag to pan · scroll to zoom"
      : "Calibrated primary view · click a predicted part";
    home.hidden = !m;
    c.style.cursor = m ? "grab" : "crosshair";
  }
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) => (b.onclick = () => setMode(+b.dataset.mode)));
  home.onclick = resetView;
  document.querySelector("#play").onclick = (e) => {
    playing = !playing;
    e.currentTarget.textContent = playing ? "Ⅱ" : "▶";
  };
  slider.oninput = () => {
    const next = +slider.value;
    playing = false;
    loadImage(next).then(() => (f = next));
  };
  new ResizeObserver(() => {
    W = c.clientWidth;
    H = c.clientHeight;
    const d = Math.min(devicePixelRatio || 1, 2);
    c.width = W * d;
    c.height = H * d;
    g.setTransform(d, 0, 0, d, 0, 0);
  }).observe(c);
  function imageLayout() {
    const [, , cw, ch] = D.crop,
      quarter = Math.abs(rotation) === 90,
      rw = quarter ? ch : cw,
      rh = quarter ? cw : ch,
      s = Math.min(W / rw, H / rh);
    return { x: (W - rw * s) / 2, y: (H - rh * s) / 2, s };
  }
  function displayPixel(u, v, lay) {
    const x = u - D.crop[0],
      y = v - D.crop[1],
      cw = D.crop[2],
      ch = D.crop[3];
    if (rotation === -90) return [lay.x + y * lay.s, lay.y + (cw - x) * lay.s];
    if (rotation === 90) return [lay.x + (ch - y) * lay.s, lay.y + x * lay.s];
    return [lay.x + x * lay.s, lay.y + y * lay.s];
  }
  function drawRgb(image, lay) {
    g.save();
    if (rotation === -90) {
      g.translate(lay.x, lay.y + D.crop[2] * lay.s);
      g.rotate(-Math.PI / 2);
    } else if (rotation === 90) {
      g.translate(lay.x + D.crop[3] * lay.s, lay.y);
      g.rotate(Math.PI / 2);
    } else g.translate(lay.x, lay.y);
    g.drawImage(image, 0, 0, D.crop[2] * lay.s, D.crop[3] * lay.s);
    g.restore();
  }
  function cameraPoint(world, fi) {
    const M = D.cameraPoses[fi],
      a = [world[0] - M[0][3], world[1] - M[1][3], world[2] - M[2][3]];
    return [
      a[0] * M[0][0] + a[1] * M[1][0] + a[2] * M[2][0],
      a[0] * M[0][1] + a[1] * M[1][1] + a[2] * M[2][1],
      a[0] * M[0][2] + a[1] * M[1][2] + a[2] * M[2][2],
    ];
  }
  function matMul(a, b) {
    const r = Array(9).fill(0);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        for (let k = 0; k < 3; k++) r[y * 3 + x] += a[y * 3 + k] * b[k * 3 + x];
    return r;
  }
  function matVec(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }
  function normalize(v) {
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }
  function orthonormalize(m) {
    const x = normalize([m[0], m[3], m[6]]),
      rawY = [m[1], m[4], m[7]],
      dot = x[0] * rawY[0] + x[1] * rawY[1] + x[2] * rawY[2],
      y = normalize(rawY.map((v, i) => v - dot * x[i])),
      z = [
        x[1] * y[2] - x[2] * y[1],
        x[2] * y[0] - x[0] * y[2],
        x[0] * y[1] - x[1] * y[0],
      ];
    return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  }
  function rotateView(screenDx, screenDy) {
    let dx = screenDx,
      dy = screenDy;
    if (rotation === -90) [dx, dy] = [-screenDy, screenDx];
    else if (rotation === 90) [dx, dy] = [screenDy, -screenDx];
    const ax = dy * 0.007,
      ay = dx * 0.007,
      cx = Math.cos(ax),
      sx = Math.sin(ax),
      cy = Math.cos(ay),
      sy = Math.sin(ay),
      rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx],
      ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
    viewRot = orthonormalize(matMul(rx, matMul(ry, viewRot)));
    orbitTravel = Math.min(80, orbitTravel + Math.hypot(screenDx, screenDy));
  }
  // Accepted display convention: reflect camera-relative depth before orbit and depth sorting.
  // Apply the same transform to points, flow and predicted axes; RGB retains its source projection.
  function P(world, fi, lay) {
    let p = cameraPoint(world, fi),
      o = cameraPoint(D.center, fi),
      q = matVec(viewRot, [
        p[0] - o[0],
        p[1] - o[1],
        (mode === 0 ? 1 : -1) * (p[2] - o[2]),
      ]),
      x = q[0] + o[0],
      y = q[1] + o[1],
      z = q[2] + o[2];
    const K = D.intrinsics,
      projectionDepth = mode === 0 ? z : o[2],
      u = (K.fx * x) / projectionDepth + K.cx,
      v = K.cy - (K.fy * y) / projectionDepth,
      screen = displayPixel(u, v, lay),
      cu = (K.fx * o[0]) / o[2] + K.cx,
      cv = K.cy - (K.fy * o[1]) / o[2],
      center = displayPixel(cu, cv, lay);
    return [
      center[0] + (screen[0] - center[0]) * zoom + panX,
      center[1] + (screen[1] - center[1]) * zoom + panY,
      z,
    ];
  }
  c.onpointerdown = (e) => {
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      moved: false,
      action: e.ctrlKey ? "pan" : "orbit",
    };
    c.setPointerCapture(e.pointerId);
    if (mode) c.style.cursor = drag.action === "pan" ? "move" : "grabbing";
  };
  c.onpointermove = (e) => {
    if (!drag || drag.id !== e.pointerId || !mode) return;
    const dx = e.clientX - drag.lx,
      dy = e.clientY - drag.ly;
    if (Math.abs(dx) + Math.abs(dy) > 0.25) drag.moved = true;
    if (drag.action === "pan") {
      panX += dx;
      panY += dy;
    } else rotateView(dx, dy);
    drag.lx = e.clientX;
    drag.ly = e.clientY;
  };
  c.onpointerup = (e) => {
    if (!drag) return;
    if (!drag.moved) {
      const r = c.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      let q = 0,
        best = 144;
      for (const p of hits) {
        const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
        if (d < best) {
          best = d;
          q = p[3];
        }
      }
      if (q) select(q);
      else if (!mode) {
        playing = !playing;
        document.querySelector("#play").textContent = playing ? "Ⅱ" : "▶";
      }
    } else saveView();
    drag = null;
    c.style.cursor = mode ? "grab" : "crosshair";
  };
  c.oncontextmenu = (e) => e.preventDefault();
  c.addEventListener(
    "wheel",
    (e) => {
      if (!mode) return;
      e.preventDefault();
      const before = zoom;
      zoom = Math.max(0.3, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0015)));
      const r = c.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top,
        ratio = zoom / before;
      panX = x - W / 2 - (x - W / 2 - panX) * ratio;
      panY = y - H / 2 - (y - H / 2 - panY) * ratio;
      saveView();
    },
    { passive: false },
  );
  function draw(t) {
    requestAnimationFrame(draw);
    const dt = Math.min((t - last) / 1000 || 0, 0.05);
    last = t;
    if (!ready) return;
    if (playing) f = (f + dt * D.fps) % D.frames.length;
    const ease = 1 - Math.exp(-dt * 8);
    morph += (mode - morph) * ease;
    g.clearRect(0, 0, W, H);
    const fi = Math.floor(f),
      frame = D.frames[fi],
      spatial = Math.min(1, morph),
      fusion = Math.min(1, Math.max(0, morph - 1)),
      pred = Math.min(1, Math.max(0, morph - 2)),
      lay = imageLayout();
    if (!images[fi]?.complete) {
      loadImage(fi);
      return;
    }
    g.globalAlpha = mode === 0 ? (selected ? contextAlpha : 1) : 1 - spatial;
    drawRgb(images[fi], lay);
    g.globalAlpha = 1;
    hits = [];
    const pts = [];
    for (let i = 0; i < frame.points.length; i += 8) {
      const view = frame.points[i + 7],
        part = frame.points[i + 6];
      if (mode === 0 && view !== 1) continue;
      if (mode > 1 && view !== 1 && fusion < 0.001) continue;
      const p = P(frame.points.slice(i, i + 3), fi, lay);
      if (p[2] > 0.01)
        pts.push([
          ...p,
          part,
          frame.points[i + 3],
          frame.points[i + 4],
          frame.points[i + 5],
          view,
        ]);
    }
    pts.sort((a, b) => b[2] - a[2]);
    for (const p of pts) {
      const viewAlpha = p[7] === 1 ? 1 : mode === 1 ? 0.55 : fusion;
      if (p[3] && viewAlpha > 0.2) hits.push(p);
      if (mode === 0 && !selected) continue;
      if (mode === 0 && p[3] !== selected) continue;
      const dim = selected && p[3] !== selected ? contextAlpha : 1;
      g.globalAlpha = (mode === 0 ? 1 : spatial) * viewAlpha * dim;
      g.fillStyle =
        (pred || mode === 0) && p[3]
          ? palette[p[3] % palette.length]
          : `rgb(${p[4]},${p[5]},${p[6]})`;
      const s =
        mode === 0
          ? Math.max(2.4, 3.15 * lay.s)
          : selected === p[3]
            ? Math.max(3.6, 1.2 * lay.s)
            : Math.max(2.7, 0.95 * lay.s);
      g.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
    }
    g.globalAlpha = 1;
    if (selected) {
      for (const tr of D.tracks) {
        if (tr.part !== selected) continue;
        g.beginPath();
        let open = false;
        for (let j = Math.max(0, fi - 15); j <= fi; j++) {
          const s = tr.samples[j];
          if (!s) {
            open = false;
            continue;
          }
          const p = P(s, fi, lay);
          open ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
          open = true;
        }
        g.strokeStyle = "#dffff4";
        g.lineWidth = 1.2;
        g.stroke();
      }
    }
    if (mode === 3) {
      for (const a of D.axes) {
        const len = D.extent * 0.32,
          e = [-len, len].map((k) =>
            P(
              a.pivot.map((v, i) => v + k * a.direction[i]),
              fi,
              lay,
            ),
          ),
          p = P(a.pivot, fi, lay);
        g.strokeStyle = "#ffe16d";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(e[0][0], e[0][1]);
        g.lineTo(e[1][0], e[1][1]);
        g.stroke();
        g.fillStyle = "#fff1ad";
        g.beginPath();
        g.arc(p[0], p[1], 4, 0, Math.PI * 2);
        g.fill();
        g.font = "12px system-ui";
        g.fillText(
          `Pred. ${a.type} axis · conf. ${(a.confidence ?? 0).toFixed(2)}`,
          Math.max(12, Math.min(W - 250, p[0] + 10)),
          Math.max(65, Math.min(H - 25, p[1] - 12)),
        );
      }
    }
    slider.value = fi;
    out.textContent = `${frame.time.toFixed(2)} s · ${fi + 1} / ${D.frames.length}`;
  }
  function loadImage(i) {
    if (imagePromises[i]) return imagePromises[i];
    imagePromises[i] = new Promise((ok, no) => {
      const im = new Image();
      images[i] = im;
      im.onload = ok;
      im.onerror = no;
      im.src = D.frames[i].rgb;
    });
    return imagePromises[i];
  }
  loadImage(0)
    .then(() => {
      ready = true;
      legend.textContent = `${D.parts.length} predicted parts · 4D uses synchronized views`;
      requestAnimationFrame(draw);
      const prefetch = () =>
        D.frames.forEach((_, i) => loadImage(i).catch(() => {}));
      window.requestIdleCallback
        ? window.requestIdleCallback(prefetch)
        : setTimeout(prefetch, 250);
    })
    .catch(() => (legend.textContent = "RGB frame failed to load"));
})();
