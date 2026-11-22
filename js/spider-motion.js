/** Locomoción acotada sobre rutas: giro, aceleración y frenado sin saltar portales. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCSpiderMotion = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const EPS = .01;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

  /**
   * Avanza sobre los segmentos, no a través de los controles. Antes de una
   * curva frena y gira sobre el punto de apoyo; en tramos colineales mantiene
   * velocidad. `stopAtFirst` permite al lector destacar cada palabra aunque
   * se use la siguiente como anticipación para el frenado.
   *
   * `actor` tiene x, y, angle y speed; la lista se consume al alcanzar puntos.
   * Devuelve el recorrido real y el giro para sincronizar la postura con ellos.
   */
  function step(actor, waypoints, dt, options = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    const maxSpeed = Math.max(1, Number(options.maxSpeed) || 140);
    const acceleration = Math.max(1, Number(options.acceleration) || 600);
    const braking = Math.max(1, Number(options.braking) || 700);
    const turnRate = Math.max(.1, Number(options.turnRate) || 5);
    const stopAtFirst = !!options.stopAtFirst;
    actor.speed = Math.max(0, Number.isFinite(actor.speed) ? actor.speed : 0);
    actor.angle = Number.isFinite(actor.angle) ? actor.angle : 0;
    let reached = 0, distance = 0, turn = 0;

    // Evita puntos duplicados y mantiene el contrato por palabra del escáner.
    while (waypoints.length && Math.hypot(waypoints[0].x - actor.x, waypoints[0].y - actor.y) < EPS) {
      actor.x = waypoints[0].x; actor.y = waypoints[0].y;
      waypoints.shift(); reached++;
      if (stopAtFirst) {
        if (!waypoints.length || Math.abs(angleDelta(actor.angle, Math.atan2(waypoints[0].y - actor.y, waypoints[0].x - actor.x))) > .08) actor.speed = 0;
        return { done: !waypoints.length, reached, distance, turn };
      }
    }
    if (!waypoints.length) { actor.speed = 0; return { done: true, reached, distance, turn }; }
    if (!dt) return { done: false, reached, distance, turn };

    const first = waypoints[0], firstDistance = Math.hypot(first.x - actor.x, first.y - actor.y);
    const desired = Math.atan2(first.y - actor.y, first.x - actor.x);
    const difference = angleDelta(actor.angle, desired);
    const rotation = clamp(difference, -turnRate * dt, turnRate * dt);
    actor.angle = Math.atan2(Math.sin(actor.angle + rotation), Math.cos(actor.angle + rotation));
    turn = Math.abs(rotation);

    let movingTime = dt;
    if (Math.abs(difference) > .12) {
      // En un giro importante no se desliza lateralmente ni corta la esquina.
      actor.speed = Math.max(0, actor.speed - braking * dt);
      movingTime = turn + 1e-9 < Math.abs(difference) ? 0 : Math.max(0, dt - Math.abs(difference) / turnRate);
    }
    if (!movingTime) return { done: false, reached, distance, turn };

    // Mira hasta el siguiente cambio de dirección, no hasta cada portal recto.
    let straightDistance = 0, previous = { x: actor.x, y: actor.y };
    for (const waypoint of waypoints) {
      const dx = waypoint.x - previous.x, dy = waypoint.y - previous.y, length = Math.hypot(dx, dy);
      if (length < EPS) { previous = waypoint; continue; }
      if (straightDistance && Math.abs(angleDelta(desired, Math.atan2(dy, dx))) > .08) break;
      straightDistance += length; previous = waypoint;
    }
    const goal = Math.min(maxSpeed, Math.sqrt(2 * braking * straightDistance));
    const change = (goal > actor.speed ? acceleration : braking) * movingTime;
    const nextSpeed = actor.speed + clamp(goal - actor.speed, -change, change);
    let remaining = Math.min((actor.speed + nextSpeed) * .5 * movingTime,
      stopAtFirst ? firstDistance : straightDistance);
    actor.speed = nextSpeed;

    while (waypoints.length) {
      const point = waypoints[0], dx = point.x - actor.x, dy = point.y - actor.y;
      const length = Math.hypot(dx, dy);
      if (length <= remaining + 1e-9 || length < EPS) {
        actor.x = point.x; actor.y = point.y; distance += length;
        remaining = Math.max(0, remaining - length); waypoints.shift(); reached++;
        if (stopAtFirst) break;
      } else {
        actor.x += dx / length * remaining; actor.y += dy / length * remaining;
        distance += remaining; remaining = 0; break;
      }
    }
    if (!waypoints.length || (reached && straightDistance - distance < EPS)) actor.speed = 0;
    return { done: !waypoints.length, reached, distance, turn };
  }

  return { step, angleDelta };
});
