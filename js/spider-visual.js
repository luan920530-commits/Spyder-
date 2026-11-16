/** Silueta compartida para la reina visual y las arañas que procesan documentos. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCSpiderVisual = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function draw(ctx, options) {
    const o = Object.assign({ x: 0, y: 0, angle: 0, size: 8, color: '#bee8ff', core: null,
      phase: 0, moving: false, queen: false, time: 0 }, options || {});
    const size = Math.max(1, o.size), color = o.color;
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.angle);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = o.queen ? 10 : 6;
    ctx.strokeStyle = color; ctx.lineWidth = o.queen ? 1.8 : 1.1;
    const baseAngles = [.6, 1.2, 1.9, 2.5], length = size * (o.queen ? 2.25 : 1.9);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const swing = o.moving ? Math.sin(o.phase + i * Math.PI / 2 + (side > 0 ? Math.PI : 0)) :
          Math.sin(o.time * 1.6 + i * 1.3 + side) * .22;
        const angle = side * (baseAngles[i] + swing * .24);
        const rootX = size * (.22 - i * .13), rootY = side * size * .16;
        const footX = rootX + Math.cos(angle) * length, footY = rootY + Math.sin(angle) * length;
        const kneeAngle = angle + (side * Math.PI / 2 - angle) * .45;
        const kneeLength = length * (.58 + (o.moving ? Math.max(0, swing) * .08 : 0));
        const kneeX = rootX + Math.cos(kneeAngle) * kneeLength, kneeY = rootY + Math.sin(kneeAngle) * kneeLength;
        ctx.beginPath(); ctx.moveTo(rootX, rootY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
        ctx.fillStyle = color; ctx.fillRect(kneeX - .9, kneeY - .9, 1.8, 1.8);
      }
    }
    // Palpos y dos segmentos de cuerpo con un núcleo luminoso al transportar datos.
    ctx.beginPath(); ctx.moveTo(size * .4, -size * .1); ctx.lineTo(size * .75, -size * .2);
    ctx.moveTo(size * .4, size * .1); ctx.lineTo(size * .75, size * .2); ctx.stroke();
    const abdomenX = -size * (o.queen ? .85 : .72), rx = size * (o.queen ? .82 : .6), ry = size * (o.queen ? .62 : .46);
    const abdomen = ctx.createRadialGradient(abdomenX, 0, 0, abdomenX, 0, rx);
    abdomen.addColorStop(0, o.core || 'rgba(190,232,255,.35)');
    abdomen.addColorStop(.55, 'rgba(8,18,30,.95)'); abdomen.addColorStop(1, 'rgba(4,10,18,.98)');
    ctx.fillStyle = abdomen; ctx.beginPath(); ctx.ellipse(abdomenX, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.lineWidth = o.queen ? 1.4 : 1; ctx.stroke();
    ctx.fillStyle = 'rgba(6,14,24,.98)'; ctx.beginPath();
    ctx.ellipse(size * .18, 0, size * .36, size * .29, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    if (o.queen) {
      ctx.fillStyle = '#ff5ab4'; ctx.shadowColor = '#ff5ab4'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(abdomenX - size * .32, -size * .2); ctx.lineTo(abdomenX + size * .32, -size * .2);
      ctx.lineTo(abdomenX, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(abdomenX - size * .32, size * .2); ctx.lineTo(abdomenX + size * .32, size * .2);
      ctx.lineTo(abdomenX, 0); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(190,232,255,.35)'; ctx.lineWidth = .8;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.ellipse(abdomenX, 0, rx * i / 4.2, ry * i / 4.2, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#ff5ab4';
      [-1, 0, 1].forEach(offset => {
        ctx.beginPath(); ctx.moveTo(size * .05, offset * size * .13 - size * .05);
        ctx.lineTo(size * .05, offset * size * .13 + size * .05); ctx.lineTo(-size * .12, offset * size * .13); ctx.closePath(); ctx.fill();
      });
    }
    ctx.fillStyle = '#ffffff';
    [[.42, -.09], [.42, .09], [.34, -.16], [.34, .16]].forEach(([x, y], i) => {
      if (!o.queen && i > 1) return;
      ctx.beginPath(); ctx.arc(size * x, size * y, o.queen ? 1.6 : 1.1, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  return { draw };
});
