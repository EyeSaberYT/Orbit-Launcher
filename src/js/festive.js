// The festive look: a snowy sky (bright for the light theme, dusk for the dark one), snow on the
// buttons and light snowfall. It switches itself on for December (1st to 31st, on this computer's
// clock) and off again afterwards; nothing has to be released for it.
//
// Preview it any time of year from the developer console:
//   localStorage.setItem('orbit.festive', 'on')    (or 'off'; remove the key to follow the date)
// then reload. The look lives in css/festive.css, keyed on <html data-festive>.

import { motionReduced, onMotionChange } from './motion.js';

const OVERRIDE_KEY = 'orbit.festive';

/** December, on the local clock. */
export function isFestiveDate(date = new Date()) {
  return date.getMonth() === 11;
}

function override() {
  try {
    const value = localStorage.getItem(OVERRIDE_KEY);
    return value === 'on' || value === 'off' ? value : null;
  } catch {
    return null;
  }
}

export function festiveActive(date = new Date()) {
  const forced = override();
  return forced ? forced === 'on' : isFestiveDate(date);
}

let snow = null;

function apply() {
  const on = festiveActive();
  const root = document.documentElement;
  if (on) root.dataset.festive = 'on';
  else delete root.dataset.festive;
  if (on && !motionReduced()) snow ??= startSnowfall();
  else if (snow) {
    snow.stop();
    snow = null;
  }
}

/**
 * Snowfall drawn on one canvas behind the interface, in three depths: far flakes are tiny, faint and slow;
 * near ones are bigger, softer and quicker. Flakes are soft-edged sprites drawn once, and a gentle breeze
 * slowly changes strength. Pauses while the window is hidden.
 */
function startSnowfall() {
  const sky = document.querySelector('.sky');
  if (!sky) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'snowfall';
  canvas.setAttribute('aria-hidden', 'true');
  sky.append(canvas);
  const ctx = canvas.getContext('2d');

  // Depth layers: share of flakes, radius range, fall speed range (px/s), opacity range, sway.
  const LAYERS = [
    { share: 0.5, r: [0.6, 1.1], speed: [9, 16], alpha: [0.3, 0.55], sway: 4, wind: 0.35 },
    { share: 0.35, r: [1.2, 2.0], speed: [18, 30], alpha: [0.5, 0.8], sway: 9, wind: 0.7 },
    { share: 0.15, r: [2.4, 3.6], speed: [34, 52], alpha: [0.65, 0.9], sway: 16, wind: 1 },
  ];
  const between = ([low, high]) => low + Math.random() * (high - low);

  // A soft round flake, drawn once per size and reused.
  const sprites = new Map();
  const sprite = (radius) => {
    const size = Math.max(1, Math.round(radius * 2) / 2);
    if (!sprites.has(size)) {
      const pad = Math.ceil(size * 2.2);
      const c = document.createElement('canvas');
      c.width = c.height = pad * 2;
      const g = c.getContext('2d');
      const glow = g.createRadialGradient(pad, pad, 0, pad, pad, pad);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(Math.min(0.9, size / pad), 'rgba(255,255,255,.9)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, pad * 2, pad * 2);
      sprites.set(size, c);
    }
    return sprites.get(size);
  };

  let width = 0;
  let height = 0;
  let flakes = [];
  let frame = 0;
  let last = 0;
  let time = 0;

  const flake = (layer, anywhere) => {
    const r = between(layer.r);
    return {
      layer,
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : -8 - Math.random() * 40,
      r,
      image: sprite(r),
      speed: between(layer.speed),
      alpha: between(layer.alpha),
      phase: Math.random() * Math.PI * 2,
      spin: 0.6 + Math.random() * 0.9,
    };
  };

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const total = Math.round(Math.min(170, (width * height) / 9000));
    flakes = LAYERS.flatMap((layer) => Array.from({ length: Math.round(total * layer.share) }, () => flake(layer, true)));
  };

  const draw = (now) => {
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    time += dt;
    // A breeze that drifts between calm and a light push to one side.
    const breeze = Math.sin(time * 0.11) * 9 + Math.sin(time * 0.037 + 1.3) * 6;
    ctx.clearRect(0, 0, width, height);
    for (const f of flakes) {
      f.phase += dt * f.spin;
      f.y += f.speed * dt;
      f.x += (Math.sin(f.phase) * f.layer.sway + breeze * f.layer.wind) * dt;
      if (f.y > height + 10) Object.assign(f, flake(f.layer, false));
      if (f.x < -10) f.x = width + 10;
      else if (f.x > width + 10) f.x = -10;
      const size = f.image.width;
      ctx.globalAlpha = f.alpha;
      ctx.drawImage(f.image, f.x - size / 2, f.y - size / 2);
    }
    frame = requestAnimationFrame(draw);
  };

  const visibility = () => {
    cancelAnimationFrame(frame);
    last = 0;
    if (!document.hidden) frame = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  visibility();
  requestAnimationFrame(() => canvas.classList.add('is-on'));

  return {
    stop() {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      canvas.remove();
    },
  };
}

/** Apply now, then re-check every hour so the look starts on December 1st and ends after the 31st. */
export function startFestive() {
  apply();
  setInterval(apply, 60 * 60 * 1000);
  onMotionChange(apply);
  window.addEventListener('storage', (event) => {
    if (event.key === OVERRIDE_KEY) apply();
  });
}
