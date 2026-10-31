// Motion layer for Safelight. Everything here is decoration: the site works without it,
// and none of it runs when the visitor prefers reduced motion.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Rolling-digit counter. Each column is a strip of 0-9 that slides to the right digit. */
export class Odometer {
  constructor(root, digits = 2) {
    this.root = root;
    this.digits = digits;
    root.textContent = '';
    root.classList.add('odo');
    this.strips = [];
    for (let i = 0; i < digits; i++) {
      const col = document.createElement('span');
      col.className = 'odo__col';
      const strip = document.createElement('span');
      strip.className = 'odo__strip';
      for (let n = 0; n < 10; n++) {
        const cell = document.createElement('span');
        cell.textContent = String(n);
        strip.append(cell);
      }
      col.append(strip);
      root.append(col);
      this.strips.push(strip);
    }
  }
  set(value) {
    const s = String(value).padStart(this.digits, '0').slice(-this.digits);
    this.strips.forEach((strip, i) => {
      strip.style.transform = `translateY(${-Number(s[i]) * 10}%)`;
    });
  }
}

/** Swap a short text with a quick slide, so month and year changes feel mechanical. */
const lastSwap = new WeakMap();
export function swapText(node, text) {
  if (node.textContent === text) return;
  node.textContent = text;
  if (typeof node.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // During a fast sweep the text changes every few frames. Only animate the calmer changes,
  // otherwise the label would sit permanently half-faded.
  const now = performance.now();
  const prev = lastSwap.get(node) || 0;
  lastSwap.set(node, now);
  if (now - prev < 220) return;
  node.animate(
    [{ transform: 'translateY(0.3em)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  );
}

/**
 * One animation loop for the ambient pieces:
 *  - dust motes drifting through the safelight (canvas)
 *  - the film strip, which scrolls with the dial and drifts on its own
 *  - a damped pendulum that swings the hanging prints when the dial moves fast
 */
export function createMotion({ wall, film, canvas, lamp }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const noop = { setDay() {}, start() {} };
  if (reduce.matches || !canvas.getContext) {
    canvas.hidden = true;
    return noop;
  }

  const ctx = canvas.getContext('2d');
  const mobile = matchMedia('(max-width: 720px)').matches;
  const motes = Array.from({ length: mobile ? 36 : 72 }, () => ({
    x: Math.random(),
    y: Math.random(),
    z: 0.25 + Math.random() * 0.75,
    ph: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * 0.012,
    vy: -(0.004 + Math.random() * 0.012),
  }));

  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  let day = 0, prevDay = 0, seeded = false;
  let vel = 0, wind = 0;
  let sway = 0, swayV = 0, swayWritten = 0;
  let filmPos = 0, idle = 0, filmWritten = NaN;
  let last = performance.now();
  let running = false;

  function frame(now) {
    if (!running) return;
    const dt = clamp((now - last) / 1000, 0.001, 0.05);
    last = now;

    // Dial speed in days per second, smoothed.
    const raw = (day - prevDay) / dt;
    prevDay = day;
    vel += (raw - vel) * Math.min(1, dt * 10);
    wind += (clamp(vel / 500, -1, 1) - wind) * Math.min(1, dt * 4);

    // Prints lean away from the direction of travel, then swing back and settle.
    const target = -clamp(vel / 260, -1, 1) * 4;
    const w0 = 9, zeta = 0.3;
    swayV += (w0 * w0 * (target - sway) - 2 * zeta * w0 * swayV) * dt;
    sway += swayV * dt;
    if (Math.abs(sway) < 0.004 && Math.abs(swayV) < 0.02 && Math.abs(target) < 0.004) { sway = 0; swayV = 0; }
    if (Math.abs(sway - swayWritten) > 0.01 || (sway === 0 && swayWritten !== 0)) {
      wall.style.setProperty('--sway', `${sway.toFixed(3)}deg`);
      swayWritten = sway;
    }

    // Film strip follows the dial with some inertia and keeps creeping.
    idle -= dt * 9;
    filmPos += (-day * 3.2 - filmPos) * Math.min(1, dt * 6);
    const fx = filmPos + idle;
    if (Math.abs(fx - filmWritten) > 0.05 || Number.isNaN(filmWritten)) {
      film.style.setProperty('--film-x', `${fx.toFixed(2)}px`);
      filmWritten = fx;
    }

    // Dust, brightest near the lamp, drifting upward and nudged by the dial.
    ctx.clearRect(0, 0, W, H);
    const lx = clamp(lamp(), 0, 1) * W;
    const reach = Math.max(W, H) * 0.9;
    const scroll = window.scrollY || 0;
    const t = now / 1000;
    for (const m of motes) {
      m.x += (m.vx + wind * 0.05 * m.z) * dt;
      m.y += m.vy * dt;
      if (m.x < -0.02) m.x += 1.04; else if (m.x > 1.02) m.x -= 1.04;
      if (m.y < -0.02) m.y += 1.04;
      const px = m.x * W;
      const py = (((m.y * H - scroll * m.z * 0.15) % H) + H) % H;
      const light = Math.max(0, 1 - Math.hypot(px - lx, py + H * 0.1) / reach);
      const twinkle = 0.55 + 0.45 * Math.sin(t * (0.6 + m.z) + m.ph);
      const alpha = (0.07 + 0.55 * light * light) * twinkle * m.z;
      if (alpha < 0.01) continue;
      ctx.fillStyle = `rgba(255, 175, 145, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, 0.6 + m.z * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false; else start();
  });

  return {
    setDay(d) {
      day = d;
      if (!seeded) { prevDay = d; filmPos = -d * 3.2; seeded = true; }
    },
    start,
  };
}
