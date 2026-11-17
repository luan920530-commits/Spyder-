/** Silueta y movimiento compartidos por la reina y las arañas del enjambre. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCSpiderVisual = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TAU = Math.PI * 2, STANCE = .68;
  const ANGLES = [.42, 1.12, 2.02, 2.72];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const cycle = value => ((value % 1) + 1) % 1;
  const smooth = t => t * t * (3 - 2 * t);

  // El mismo recorrido que se usa para avanzar la fase se usa para el paso.
  // En apoyo el pie retrocede respecto al cuerpo exactamente lo que este avanza.
  function gaitCycleDistance(size) { return Math.max(1, Number(size) || 1) * 2.5; }

  /** Geometría pura en coordenadas del cuerpo: facilita comprobar apoyos y articulaciones. */
  function pose(options) {
    const o = options || {}, size = Math.max(1, Number(o.size) || 8);
    const phase = Number.isFinite(o.phase) ? o.phase : 0;
    const time = Number.isFinite(o.time) ? o.time : 0;
    const queen = !!o.queen, weaving = queen && !!o.weaving, massaging = !queen && !!o.massaging;
    const massagePhase = Number.isFinite(o.massagePhase) ? o.massagePhase : 0;
    const motion = clamp(Number.isFinite(o.motion) ? o.motion : (o.moving ? 1 : 0), 0, 1);
    const breathing = Math.sin(time * 1.15);
    const body = weaving
      ? { x: size * .035 * Math.sin(phase * .53), y: size * .025 * Math.sin(phase * .71), rotation: .035 * Math.sin(phase * .48) }
      : { x: size * (.018 * breathing + .018 * motion * Math.sin(phase * 2)),
          y: size * .045 * motion * Math.sin(phase * 2), rotation: .035 * motion * Math.sin(phase * 2 + .4) };
    const cosine = Math.cos(body.rotation), sine = Math.sin(body.rotation), legs = [];
    const reach = size * (queen ? 2.15 : 1.88);
    const stride = gaitCycleDistance(size) * STANCE;

    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const rootX = size * (.29 - i * .18), rootY = side * size * .17;
        const root = { x: body.x + rootX * cosine - rootY * sine, y: body.y + rootX * sine + rootY * cosine };
        const angle = side * ANGLES[i];
        let foot = { x: rootX + Math.cos(angle) * reach, y: rootY + Math.sin(angle) * reach };
        let lift = 0, tension = 0, stance = true;

        if (massaging && i === 0) {
          // Las dos patas delanteras alternan una presión breve sobre el nodo;
          // las otras seis sostienen el cuerpo, sin avanzar el ciclo de marcha.
          const pressure = .5 + .5 * Math.sin(massagePhase + (side > 0 ? Math.PI : 0));
          foot.x = size * (1.76 + .20 * pressure);
          foot.y = side * size * (.30 + .16 * (1 - pressure));
          lift = (1 - pressure) * .35; tension = pressure; stance = false;
        } else if (weaving && (i === 1 || i === 2)) {
          // Las patas centrales tiran de un hilo por turnos.
          const slot = side < 0 ? (i === 1 ? 0 : 2) : (i === 2 ? 1 : 3);
          const p = cycle(phase / TAU - slot / 4);
          if (p < .25) {
            const t = p / .25;
            tension = Math.sin(Math.PI * t) ** 2;
            foot.x -= Math.cos(angle) * size * .3 * tension;
            foot.y -= Math.sin(angle) * size * .3 * tension;
            lift = Math.sin(Math.PI * t) * .55;
            stance = false;
          }
        } else if (weaving) {
          // Las cuatro patas exteriores recolocan el apoyo en arcos suaves,
          // una por turno y al lado opuesto de la pata que tira del hilo.
          const slot = side > 0 ? (i === 3 ? 0 : 2) : (i === 0 ? 1 : 3);
          const p = cycle(phase / TAU - slot / 4 - .035);
          if (p < .17) {
            const t = p / .17, extension = Math.sin(Math.PI * t) ** 2;
            const sweep = Math.sin(TAU * t) * extension;
            foot.x += size * (Math.cos(angle) * .24 * extension - Math.sin(angle) * .055 * sweep);
            foot.y += size * (Math.sin(angle) * .24 * extension + Math.cos(angle) * .055 * sweep);
            lift = extension * .38; stance = false;
          }
        } else if (!queen) {
          // Dos grupos alternos de cuatro patas. El apoyo dura más que el
          // vuelo; incluso al frenar se conserva la posición longitudinal del
          // pie, mientras la altura se posa suavemente sobre la superficie.
          const group = (i + (side > 0 ? 1 : 0)) % 2;
          const p = cycle(phase / TAU + group * .5);
          if (p < STANCE) {
            foot.x += stride * (.5 - p / STANCE);
          } else {
            const t = (p - STANCE) / (1 - STANCE);
            foot.x += stride * (-.5 + smooth(t));
            lift = Math.sin(Math.PI * t) * motion;
            foot.y -= side * size * .2 * lift;
            stance = lift < .001;
          }
        }

        // Las rodillas siguen el pie en un abanico: las articulaciones no
        // oscilan independientemente ni atraviesan el cuerpo al dar un paso.
        const dx = foot.x - root.x, dy = foot.y - root.y;
        const distance = Math.max(.001, Math.hypot(dx, dy)), ux = dx / distance, uy = dy / distance;
        const footAngle = Math.atan2(Math.abs(dy), dx);
        const kneeAngle = footAngle + (Math.PI / 2 - footAngle) * .42;
        const kneeLength = clamp(distance * .68, size * .85, size * 1.5);
        const knee = { x: root.x + Math.cos(kneeAngle) * kneeLength,
          y: root.y + side * Math.sin(kneeAngle) * kneeLength };
        if (massaging && i > 0) {
          // Las patas de apoyo flexionan por turnos sin deslizar los pies.
          const flex = size * .12 * Math.sin(massagePhase * .55 + i * .8 + (side > 0 ? Math.PI * .7 : 0));
          knee.x -= uy * flex; knee.y += ux * flex;
        }
        const lowerX = foot.x - knee.x, lowerY = foot.y - knee.y;
        const ankle = { x: knee.x + lowerX * .6 - uy * side * size * .045,
          y: knee.y + lowerY * .6 + ux * side * size * .045 };
        legs.push({ side, index: i, angle, root, knee, ankle, foot, lift, tension, stance });
      }
    }
    return { body, legs };
  }

  function draw(ctx, options) {
    const o = Object.assign({ x: 0, y: 0, angle: 0, size: 8, color: '#bee8ff', core: null,
      phase: 0, moving: false, queen: false, weaving: false, time: 0 }, options || {});
    const size = Math.max(1, o.size), color = o.color, shape = pose(o);
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.angle);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = o.queen ? 7 : 4;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    if (o.queen && o.weaving) {
      let threadIndex = 0;
      for (const leg of shape.legs.filter(leg => leg.index === 1 || leg.index === 2)) {
        // Los extremos externos coinciden con la telaraña de la escena, no
        // giran con el cuerpo. La curva se tensa cuando la pata tira del hilo.
        const a = leg.side * ANGLES[leg.index], fallback = { x: Math.cos(a) * size * 4, y: Math.sin(a) * size * 4 };
        const anchor = o.threadAnchors?.[threadIndex++] || fallback;
        ctx.save(); ctx.shadowBlur = 2; ctx.strokeStyle = 'rgba(142,220,255,.44)'; ctx.lineWidth = .65;
        ctx.beginPath(); ctx.moveTo(leg.foot.x, leg.foot.y);
        ctx.quadraticCurveTo((leg.foot.x + anchor.x) / 2,
          (leg.foot.y + anchor.y) / 2 + leg.side * size * (.14 - .08 * leg.lift), anchor.x, anchor.y);
        ctx.stroke(); ctx.restore();
      }
    }
    const width = clamp(size * (o.queen ? .105 : .12), .85, 2.2);
    // Agrupar por lado y segmento evita decenas de sombras individuales por
    // frame cuando hay cinco arañas, conservando el grosor decreciente.
    for (const side of [-1, 1]) {
      const legs = shape.legs.filter(leg => leg.side === side);
      ctx.globalAlpha = side < 0 ? .78 : .95;
      for (const [from, to, scale] of [['root', 'knee', 1], ['knee', 'ankle', .76], ['ankle', 'foot', .52]]) {
        ctx.lineWidth = width * scale; ctx.beginPath();
        legs.forEach(leg => { ctx.moveTo(leg[from].x, leg[from].y); ctx.lineTo(leg[to].x, leg[to].y); });
        ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.beginPath();
      legs.forEach(leg => {
        const kr = Math.max(.65, size * .075), fr = Math.max(.55, size * .06);
        ctx.moveTo(leg.knee.x + kr, leg.knee.y); ctx.arc(leg.knee.x, leg.knee.y, kr, 0, TAU);
        ctx.moveTo(leg.foot.x + fr, leg.foot.y); ctx.arc(leg.foot.x, leg.foot.y, fr, 0, TAU);
      });
      ctx.fill(); ctx.shadowBlur = o.queen ? 7 : 4;
    }
    ctx.globalAlpha = 1;

    // Las patas quedan sobre la superficie; solo el cuerpo se balancea levemente.
    ctx.save(); ctx.translate(shape.body.x, shape.body.y); ctx.rotate(shape.body.rotation);
    const feel = Math.sin(o.time * 2.2 + o.phase * .25) * size * .035;
    const abdomenX = -size * (o.queen ? .85 : .72), rx = size * (o.queen ? .82 : .6), ry = size * (o.queen ? .62 : .46);
    const abdomen = ctx.createRadialGradient(abdomenX, 0, 0, abdomenX, 0, rx);
    abdomen.addColorStop(0, o.core || 'rgba(190,232,255,.35)');
    abdomen.addColorStop(.55, 'rgba(8,18,30,.95)'); abdomen.addColorStop(1, 'rgba(4,10,18,.98)');
    ctx.fillStyle = abdomen; ctx.beginPath(); ctx.ellipse(abdomenX, 0, rx, ry, 0, 0, TAU);
    ctx.fill(); ctx.lineWidth = o.queen ? 1.4 : 1; ctx.stroke();
    ctx.shadowBlur = 0;
    if (o.queen) {
      ctx.fillStyle = '#ff5ab4'; ctx.shadowColor = '#ff5ab4'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(abdomenX - size * .32, -size * .2); ctx.lineTo(abdomenX + size * .32, -size * .2);
      ctx.lineTo(abdomenX, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(abdomenX - size * .32, size * .2); ctx.lineTo(abdomenX + size * .32, size * .2);
      ctx.lineTo(abdomenX, 0); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(190,232,255,.35)'; ctx.lineWidth = .8;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.ellipse(abdomenX, 0, rx * i / 4.2, ry * i / 4.2, 0, 0, TAU); ctx.stroke();
      }
    }
    // La cabeza puede adelantarse al giro del cuerpo, siempre sobre su cuello.
    ctx.save(); ctx.translate(size * .18, 0);
    ctx.rotate(o.queen ? clamp(Number(o.headAngle) || 0, -.7, .7) : 0);
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = o.queen ? 7 : 4;
    ctx.lineWidth = o.queen ? 1.4 : 1;
    ctx.beginPath(); ctx.moveTo(size * .22, -size * .1); ctx.lineTo(size * .57, -size * .2 - feel);
    ctx.moveTo(size * .22, size * .1); ctx.lineTo(size * .57, size * .2 + feel); ctx.stroke();
    ctx.fillStyle = 'rgba(6,14,24,.98)'; ctx.beginPath();
    ctx.ellipse(0, 0, size * .36, size * .29, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    if (o.queen) {
      ctx.fillStyle = '#ff5ab4';
      [-1, 0, 1].forEach(offset => {
        ctx.beginPath(); ctx.moveTo(-size * .13, offset * size * .13 - size * .05);
        ctx.lineTo(-size * .13, offset * size * .13 + size * .05); ctx.lineTo(-size * .30, offset * size * .13); ctx.closePath(); ctx.fill();
      });
    }
    ctx.fillStyle = '#ffffff';
    [[.24, -.09], [.24, .09], [.16, -.16], [.16, .16]].forEach(([x, y], i) => {
      if (!o.queen && i > 1) return;
      ctx.beginPath(); ctx.arc(size * x, size * y, o.queen ? 1.6 : 1.1, 0, TAU); ctx.fill();
    });
    ctx.restore(); ctx.restore(); ctx.restore();
  }

  /** Onda visual para una orden real; no asigna trabajo ni registra datos. */
  function drawCommandWave(ctx, options) {
    const o = options || {}, progress = Math.min(1, Math.max(0, Number(o.progress) || 0));
    const radius = Math.max(1, Number(o.maxRadius) || 1) * (1 - Math.pow(1 - progress, 2));
    const alpha = (1 - progress) * .65;
    ctx.save(); ctx.shadowColor = '#ff5ab4'; ctx.shadowBlur = 9; ctx.lineWidth = 1.3;
    ctx.strokeStyle = `rgba(255,90,180,${alpha})`;
    ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(1, radius), 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.lineWidth = .7; ctx.strokeStyle = `rgba(160,225,255,${alpha * .55})`;
    ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(1, radius * .8), 0, Math.PI * 2); ctx.stroke();
    // Los puntos parten de la reina hacia las posiciones suministradas por el
    // enjambre real. Sin destinatarios solo se muestra la onda circular.
    ctx.fillStyle = `rgba(255,175,225,${(1 - progress) * .85})`;
    for (const target of o.targets || []) {
      if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
      const x = o.x + (target.x - o.x) * progress, y = o.y + (target.y - o.y) * progress;
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  return { draw, pose, gaitCycleDistance, drawCommandWave };
});
