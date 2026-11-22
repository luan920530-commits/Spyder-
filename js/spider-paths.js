/** Geometría pura para conectar el visor y la arena sin atravesar controles. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCSpiderPaths = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function bound(value, low, high) {
    if (low > high) return (low + high) / 2;
    return Math.max(low, Math.min(high, value));
  }
  function rect(r) {
    const left = Number(r.left) || 0, top = Number(r.top) || 0;
    const right = Number.isFinite(r.right) ? r.right : left + (Number(r.width) || 0);
    const bottom = Number.isFinite(r.bottom) ? r.bottom : top + (Number(r.height) || 0);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  /** Puntos a ambos lados del corredor, en coordenadas del viewport. */
  function portals(docRect, arenaRect, target, lane) {
    const d = rect(docRect), a = rect(arenaRect), margin = 12;
    const offset = Number(lane) || 0;
    const overlapY = Math.min(d.bottom, a.bottom) - Math.max(d.top, a.top);
    const overlapX = Math.min(d.right, a.right) - Math.max(d.left, a.left);
    if (overlapY > 0 && (d.right <= a.left || a.right <= d.left)) {
      const low = Math.max(d.top, a.top) + margin, high = Math.min(d.bottom, a.bottom) - margin;
      const y = bound(target.y + offset, low, high), docOnLeft = d.right <= a.left;
      const dx = docOnLeft ? d.right - margin : d.left + margin;
      const ax = docOnLeft ? a.left + margin : a.right - margin;
      return { direction: 'horizontal', doc: { x: dx, y }, arena: { x: ax, y },
        bridge: { left: Math.min(dx, ax), top: Math.max(d.top, a.top), right: Math.max(dx, ax), bottom: Math.min(d.bottom, a.bottom) } };
    }
    if (overlapX > 0 && (d.bottom <= a.top || a.bottom <= d.top)) {
      const low = Math.max(d.left, a.left) + margin, high = Math.min(d.right, a.right) - margin;
      const x = bound(target.x + offset, low, high), docOnTop = d.bottom <= a.top;
      const dy = docOnTop ? d.bottom - margin : d.top + margin;
      const ay = docOnTop ? a.top + margin : a.bottom - margin;
      return { direction: 'vertical', doc: { x, y: dy }, arena: { x, y: ay },
        bridge: { left: Math.max(d.left, a.left), top: Math.min(dy, ay), right: Math.min(d.right, a.right), bottom: Math.max(dy, ay) } };
    }
    // Superposición o una distribución no estándar: usar un recorrido directo.
    return { direction: 'direct', doc: target, arena: target, bridge: null };
  }
  function route(docRect, arenaRect, target, toDocument, lane) {
    const p = portals(docRect, arenaRect, target, lane);
    if (p.direction === 'direct') return [target];
    return toDocument ? [p.arena, p.doc, target] : [p.doc, p.arena, target];
  }
  function advance(point, waypoints, distance) {
    let remaining = Math.max(0, distance), angle = 0;
    while (waypoints.length) {
      const next = waypoints[0], dx = next.x - point.x, dy = next.y - point.y;
      const length = Math.hypot(dx, dy);
      if (length > 0.01) angle = Math.atan2(dy, dx);
      if (length <= remaining || length < .01) {
        point.x = next.x; point.y = next.y; waypoints.shift(); remaining -= length;
      } else {
        point.x += dx / length * remaining; point.y += dy / length * remaining;
        break;
      }
    }
    return { done: waypoints.length === 0, angle };
  }
  return { bound, rect, portals, route, advance };
});
