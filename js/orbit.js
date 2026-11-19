/** Cámara de la red. Las coordenadas XYZ son una vista del layout, no datos del alumno. */
(function (root, factory) {
  const api = factory(); root.NCOrbit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const PI = Math.PI, TURN = PI * 2, STEP = PI / 12, DISTANCE = 3.4;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  function surface(u, v) {
    const lon = (u - .5) * TURN, lat = (clamp(v, 0, 1) - .5) * PI, c = Math.cos(lat);
    return { x: c * Math.sin(lon), y: Math.sin(lat), z: c * Math.cos(lon) };
  }
  function camera() {
    let yaw = 0, pitch = 0, zoom = 1, enabled = false, cached;
    return {
      get enabled() { return enabled; }, get zoom() { return zoom; },
      toggle() { enabled = !enabled; },
      turn(dx, dy) {
        yaw = Math.atan2(Math.sin(yaw + dx), Math.cos(yaw + dx));
        pitch = clamp(pitch + dy, -PI * .47, PI * .47); cached = null;
      },
      magnify(step) { zoom = clamp(Math.round((zoom + step) * 10) / 10, .7, 1.3); cached = null; },
      reset() { yaw = pitch = 0; zoom = 1; cached = null; },
      frame(w, h) {
        if (cached && cached.w === w && cached.h === h) return cached;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const radius = Math.min(w, h) * .32 * zoom, cx = w * .54, centerY = h * .51;
        const projectInto = (p, out) => {
          const x = p.x * cy + p.z * sy, z1 = p.z * cy - p.x * sy;
          const y = p.y * cp + z1 * sp, z = z1 * cp - p.y * sp, scale = DISTANCE / (DISTANCE - z);
          out.x = cx + x * radius * scale; out.y = centerY + y * radius * scale; out.z = z; out.scale = scale;
          return out;
        };
        const project = p => projectInto(p, {});
        cached = { w, h, cx, cy: centerY, rim: radius * DISTANCE / Math.sqrt(DISTANCE ** 2 - 1),
          project, projectInto, at: (u, v) => project(surface(u, v)) };
        return cached;
      }
    };
  }
  // Meridianos y paralelos ilustrativos; se distinguen los tramos detrás del globo.
  const grid = [];
  for (let m = 0; m < 12; m++) grid.push(Array.from({ length: 33 }, (_, i) => surface(m / 12, i / 32)));
  for (let l = 1; l < 8; l++) grid.push(Array.from({ length: 65 }, (_, i) => surface(i / 64, l / 8)));
  let gridFrame, gridLines;
  function drawGlobe(ctx, frame) {
    const { cx, cy, rim } = frame;
    const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, rim * 1.06);
    haze.addColorStop(0, 'rgba(10,50,67,.10)'); haze.addColorStop(.88, 'rgba(22,107,141,.09)');
    haze.addColorStop(.945, 'rgba(47,176,209,.15)'); haze.addColorStop(1, 'rgba(10,53,70,0)');
    ctx.fillStyle = haze; ctx.fillRect(cx-rim*1.06, cy-rim*1.06, rim*2.12, rim*2.12);
    if (gridFrame !== frame) { gridFrame = frame; gridLines = grid.map(line => line.map(frame.project)); }
    for (const front of [false, true]) {
      ctx.beginPath(); ctx.lineWidth = front ? .85 : .55; ctx.strokeStyle = front ? 'rgba(89,203,228,.26)' : 'rgba(89,203,228,.08)';
      for (const line of gridLines) for (let i = 1; i < line.length; i++) {
        const a = line[i-1], b = line[i];
        if ((a.z + b.z > 2 / DISTANCE) === front) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, rim, 0, TURN); ctx.strokeStyle = 'rgba(105,216,240,.44)'; ctx.stroke();
  }

  function bind(stage, cam, changed) {
    const doc = stage.ownerDocument, toggle = doc.getElementById('btn-orbit'), controls = doc.getElementById('orbit-controls');
    const zoomLabel = doc.getElementById('orbit-zoom'), help = doc.getElementById('swarm-help');
    const guide = doc.getElementById('orbit-guide');
    let drag = null, swallow = false;
    const isControl = target => target.closest?.('button,input,select,textarea,a,.arena-tools,#node-inspector,#graph-fallback');
    function cancel() {
      if (!drag) return;
      const { id } = drag; drag = null;
      if (stage.hasPointerCapture?.(id)) stage.releasePointerCapture(id);
      stage.classList.remove('orbit-dragging');
    }
    function refresh() {
      toggle.setAttribute('aria-pressed', String(cam.enabled)); controls.hidden = !cam.enabled;
      stage.classList.toggle('orbit-on', cam.enabled); zoomLabel.textContent = `${Math.round(cam.zoom * 100)} %`;
      controls.querySelector('[data-orbit-key="+"]').disabled = cam.zoom >= 1.3;
      controls.querySelector('[data-orbit-key="-"]').disabled = cam.zoom <= .7;
      changed();
    }
    function keyAction(key) {
      if (!cam.enabled) return false;
      switch (key) {
        case 'ArrowLeft': cam.turn(-STEP, 0); break;
        case 'ArrowRight': cam.turn(STEP, 0); break;
        case 'ArrowUp': cam.turn(0, -STEP); break;
        case 'ArrowDown': cam.turn(0, STEP); break;
        case '+': case '=': cam.magnify(.1); break;
        case '-': cam.magnify(-.1); break;
        case 'Home': cam.reset(); break;
        default: return false;
      }
      refresh(); return true;
    }
    toggle.addEventListener('click', () => {
      cancel(); swallow = false; cam.toggle();
      guide.hidden = !cam.enabled; help.hidden = cam.enabled;
      stage.setAttribute('aria-describedby', cam.enabled ? guide.id : help.id);
      refresh(); if (cam.enabled) stage.focus({ preventScroll: true });
    });
    controls.addEventListener('click', e => { const b = e.target.closest('[data-orbit-key]'); if (b) keyAction(b.dataset.orbitKey); });
    stage.addEventListener('keydown', e => {
      if ((e.target === stage || e.target.closest?.('#neural-svg')) && !e.ctrlKey && !e.metaKey && !e.altKey && keyAction(e.key)) e.preventDefault();
    });
    stage.addEventListener('pointerdown', e => {
      if (!cam.enabled || drag || e.isPrimary === false || e.button !== 0 || isControl(e.target)) return;
      swallow = false; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });
    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if ((!drag.moved && Math.hypot(dx, dy) < 5) || (!dx && !dy)) return;
      if (!drag.moved) {
        // Hasta cruzar el umbral el clic pertenece al nodo. Después se captura
        // en el escenario estable aunque D3 reordene o retire el nodo inicial.
        drag.moved = true; swallow = true; stage.classList.add('orbit-dragging');
        try { stage.setPointerCapture?.(e.pointerId); } catch (_) { /* Puntero ya retirado. */ }
      }
      drag.x = e.clientX; drag.y = e.clientY;
      const k = PI / Math.max(120, Math.min(stage.clientWidth, stage.clientHeight) * .75);
      cam.turn(dx * k, dy * k); changed();
    }
    doc.addEventListener('pointermove', move, { capture: true, passive: true });
    doc.addEventListener('pointerup', e => { if (drag?.id === e.pointerId) { move(e); cancel(); } }, true);
    doc.addEventListener('pointercancel', e => { if (drag?.id === e.pointerId) cancel(); }, true);
    stage.addEventListener('lostpointercapture', e => { if (e.target === stage && drag?.id === e.pointerId) cancel(); });
    // En captura, antes de los listeners D3 del nodo y del despacho del fondo.
    stage.addEventListener('click', e => {
      if (swallow && e.detail !== 0 && !isControl(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
      swallow = false;
    }, true);
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancel(); });
    doc.defaultView.addEventListener('blur', cancel);
    return { reset() { cancel(); swallow = false; cam.reset(); refresh(); } };
  }
  return { surface, camera, drawGlobe, bind };
});
