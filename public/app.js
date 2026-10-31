import { demoCatalog, demoDetail, posterArt } from './demo.js';
import { Odometer, swapText, createMotion } from './motion.js';

const DAY = 864e5;
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REGIONS = ['IN', 'US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'BR', 'MX', 'AR', 'JP', 'KR', 'AE', 'ZA', 'SG', 'PH'];
const GENRES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama',
  10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy',
  10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};
const THEATRE_WINDOW = 75 * DAY;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((x) => x != null && x !== false));
  return n;
}

const svgNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

const utcToday = () => {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
};
const parseDate = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const fmtShort = (ts) => {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/* ---------- state ---------- */

const state = {
  items: [],
  sorted: [],
  sortedTs: [],
  byKey: new Map(),
  devCount: 0,
  today: utcToday(),
  dial: -1,
  min: 0,
  max: 0,
  studio: 'all',
  format: 'all',
  status: 'all',
  q: '',
  marked: false,
  order: 'new',
  region: 'US',
  demo: false,
  quiet: true,
  sweeping: false,
  marks: new Set(store.get('marks', [])),
};

const els = {
  wall: $('#wall'), count: $('#count'), empty: $('#empty'), demoNote: $('#demo-note'),
  ruler: $('#ruler'), todayBtn: $('#today-btn'),
  day: $('#rd-day'), mon: $('#rd-mon'), year: $('#rd-year'),
  mini: $('#mini'), miniDate: $('#mini-date'), miniRange: $('#mini-range'), miniToday: $('#mini-today'),
  hero: $('#hero'), q: $('#q'), region: $('#region'),
  markedBtn: $('#marked-btn'), markedN: $('#marked-n'), sortBtn: $('#sort-btn'),
  sheet: $('#sheet'), sheetBody: $('#sheet-body'), sheetClose: $('#sheet-close'),
  film: $('#film'), dust: $('#dust'),
};

const odo = new Odometer(els.day, 2);
const motion = createMotion({
  wall: els.wall,
  film: els.film,
  canvas: els.dust,
  lamp: () => (state.max > state.min && state.dial >= 0 ? (state.dial - state.min) / (state.max - state.min) : 0.5),
});

/* ---------- data ---------- */

function pickRegion() {
  const saved = store.get('region', null);
  if (saved && REGIONS.includes(saved)) return saved;
  const guess = (navigator.language || '').split('-')[1]?.toUpperCase();
  return REGIONS.includes(guess) ? guess : 'US';
}

function normalizeLive(r) {
  return {
    key: `${r.kind}-${r.id}`,
    kind: r.kind,
    id: r.id,
    title: r.title || 'Untitled',
    ts: parseDate(r.date),
    poster: r.poster,
    backdrop: r.backdrop,
    overview: r.overview || '',
    rating: r.rating,
    studios: r.studios,
    genres: (r.genres || []).map((g) => GENRES[g]).filter(Boolean),
    flags: { s: !!r.s, b: !!r.b },
  };
}

async function loadCatalog() {
  try {
    const res = await fetch(`/api/catalog?region=${state.region}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    state.demo = false;
    return data.items.map(normalizeLive).filter((i) => i.ts != null);
  } catch {
    state.demo = true;
    return demoCatalog(state.today);
  }
}

const detailCache = new Map();
async function loadDetail(item) {
  if (state.demo) return demoDetail(item, state.today);
  const ck = `${item.key}:${state.region}`;
  if (detailCache.has(ck)) return detailCache.get(ck);
  try {
    const res = await fetch(`/api/title/${item.kind}/${item.id}?region=${state.region}`);
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    detailCache.set(ck, d);
    return d;
  } catch { return null; }
}

function ingest(items) {
  state.items = items.sort((a, b) => b.ts - a.ts || a.title.localeCompare(b.title));
  if (state.order === 'old') state.items.reverse();
  state.sorted = [...items].sort((a, b) => a.ts - b.ts);
  state.sortedTs = state.sorted.map((i) => i.ts);
  state.byKey = new Map(items.map((i) => [i.key, i]));

  if (state.sorted.length) {
    const first = new Date(state.sorted[0].ts);
    const last = new Date(Math.max(state.sorted.at(-1).ts, state.today));
    state.min = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    state.max = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 2, 0);
  } else {
    state.min = state.today - 365 * DAY;
    state.max = state.today + 180 * DAY;
  }
  const totalDays = Math.round((state.max - state.min) / DAY);
  els.miniRange.max = String(totalDays);
  els.ruler.setAttribute('aria-valuemin', '0');
  els.ruler.setAttribute('aria-valuemax', String(totalDays));
  els.demoNote.hidden = !state.demo;
}

/* ---------- status ---------- */

function statusOf(it, D) {
  if (it.ts > D) return 'upcoming';
  if (D >= state.today) {
    if (it.flags.s) return 'streaming';
    if (it.flags.b) return 'digital';
  }
  if (it.kind === 'movie' && D - it.ts <= THEATRE_WINDOW) return 'theatres';
  return 'released';
}
function stateLabel(it, st) {
  switch (st) {
    case 'upcoming': return `Opens ${fmtShort(it.ts)}`;
    case 'theatres': return 'In theatres';
    case 'digital': return 'Digital';
    case 'streaming': return 'Streaming';
    default: return String(new Date(it.ts).getUTCFullYear());
  }
}
const studioClass = (it) => (it.studios[0] === 'Neon' ? 'neon' : 'a24');

/* ---------- ruler / dial ---------- */

function buildRuler() {
  const span = state.max - state.min;
  const pct = (ts) => (((ts - state.min) / span) * 100).toFixed(3);
  const frag = document.createDocumentFragment();

  let y = new Date(state.min).getUTCFullYear();
  let m = new Date(state.min).getUTCMonth();
  let firstTick = true;
  for (;;) {
    const ts = Date.UTC(y, m, 1);
    if (ts > state.max) break;
    const tick = el('i', { class: m === 0 ? 'tick tick--year' : 'tick' });
    tick.style.setProperty('--x', pct(ts));
    frag.append(tick);
    const monthsToJan = (12 - m) % 12;
    if (m === 0 || (firstTick && monthsToJan > 5)) {
      const label = el('span', { class: 'yearlabel', text: String(y) });
      label.style.setProperty('--x', pct(ts));
      frag.append(label);
    }
    firstTick = false;
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }

  state.sorted.forEach((it, i) => {
    const pip = el('i', { class: `pip pip--${studioClass(it)}` });
    it.pip = pip;
    pip.style.setProperty('--x', pct(it.ts));
    pip.style.setProperty('--h', `${14 + (i % 4) * 7}px`);
    frag.append(pip);
  });
  frag.append(el('i', { class: 'handle' }));
  els.ruler.replaceChildren(frag);

  const tx = Math.min(100, Math.max(0, ((state.today - state.min) / span) * 100));
  els.todayBtn.style.setProperty('--today-x', tx.toFixed(3));
}

const clampDay = (ts) => {
  const c = Math.min(state.max, Math.max(state.min, ts));
  return state.min + Math.round((c - state.min) / DAY) * DAY;
};

let settleTimer = 0;
function setDial(raw) {
  const ts = clampDay(raw);
  if (ts === state.dial) return;
  state.dial = ts;
  const span = state.max - state.min;
  document.documentElement.style.setProperty('--dial-x', (((ts - state.min) / span) * 100).toFixed(3));
  const d = new Date(ts);
  odo.set(d.getUTCDate());
  swapText(els.mon, MONTHS[d.getUTCMonth()]);
  swapText(els.year, String(d.getUTCFullYear()));
  motion.setDay((ts - state.min) / DAY);
  els.miniDate.textContent = fmtDate(ts);
  const idx = Math.round((ts - state.min) / DAY);
  els.miniRange.value = String(idx);
  els.ruler.setAttribute('aria-valuenow', String(idx));
  els.ruler.setAttribute('aria-valuetext', fmtDate(ts));
  const isToday = ts === clampDay(state.today);
  els.todayBtn.classList.toggle('is-here', isToday);
  syncDeveloped();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, 140);
}

function upperBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function syncDeveloped() {
  const n = upperBound(state.sortedTs, state.dial);
  if (n === state.devCount) return;
  if (n > state.devCount) {
    for (let i = state.devCount; i < n; i++) {
      const it = state.sorted[i];
      it.li?.classList.add('is-developed');
      it.pip?.classList.add('is-lit');
      if (!state.quiet) { it.li?.classList.add('flash'); it.pip?.classList.add('pop'); }
    }
  } else {
    for (let i = n; i < state.devCount; i++) {
      const it = state.sorted[i];
      it.li?.classList.remove('is-developed', 'flash');
      it.pip?.classList.remove('is-lit', 'pop');
    }
  }
  state.devCount = n;
}

let sweepRaf = 0;
function cancelSweep() {
  if (sweepRaf) cancelAnimationFrame(sweepRaf);
  sweepRaf = 0;
  if (state.sweeping) { state.sweeping = false; settle(); }
}
function sweepTo(target, ms, done) {
  cancelAnimationFrame(sweepRaf);
  const from = state.dial;
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    setDial(from + (target - from) * e);
    if (t < 1) sweepRaf = requestAnimationFrame(step);
    else { sweepRaf = 0; done?.(); }
  };
  sweepRaf = requestAnimationFrame(step);
}
function goToday() {
  cancelSweep();
  const target = clampDay(state.today);
  if (reduceMotion) setDial(target);
  else sweepTo(target, 900);
}

function bindDial() {
  const ruler = els.ruler;
  let dragging = false;
  const fromPointer = (e) => {
    const rect = ruler.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setDial(state.min + p * (state.max - state.min));
  };
  ruler.addEventListener('pointerdown', (e) => {
    cancelSweep();
    dragging = true;
    ruler.setPointerCapture(e.pointerId);
    ruler.classList.add('is-dragging');
    fromPointer(e);
  });
  ruler.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
  const end = (e) => {
    dragging = false;
    ruler.classList.remove('is-dragging');
    if (ruler.hasPointerCapture?.(e.pointerId)) ruler.releasePointerCapture(e.pointerId);
  };
  ruler.addEventListener('pointerup', end);
  ruler.addEventListener('pointercancel', end);
  ruler.addEventListener('keydown', (e) => {
    const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -30, PageUp: 30 };
    if (e.key in steps) {
      e.preventDefault();
      cancelSweep();
      setDial(state.dial + steps[e.key] * (e.shiftKey ? 7 : 1) * DAY);
    } else if (e.key === 'Home') { e.preventDefault(); cancelSweep(); setDial(state.min); }
    else if (e.key === 'End') { e.preventDefault(); cancelSweep(); setDial(state.max); }
    else if (e.key === 't' || e.key === 'T') { e.preventDefault(); goToday(); }
  });
  els.todayBtn.addEventListener('click', goToday);
  els.miniToday.addEventListener('click', goToday);
  els.miniRange.addEventListener('input', () => {
    cancelSweep();
    setDial(state.min + Number(els.miniRange.value) * DAY);
  });

  new IntersectionObserver(([entry]) => {
    const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    els.mini.classList.toggle('is-visible', show);
    els.mini.setAttribute('aria-hidden', String(!show));
    for (const c of [els.miniRange, els.miniToday]) c.tabIndex = show ? 0 : -1;
  }).observe(els.hero);
}

/* ---------- wall ---------- */

function posterSrcset(it, img) {
  if (it.art) { img.src = it.art; return; }
  if (it.poster) {
    img.src = `${TMDB_IMG}/w342${it.poster}`;
    img.srcset = `${TMDB_IMG}/w185${it.poster} 185w, ${TMDB_IMG}/w342${it.poster} 342w, ${TMDB_IMG}/w500${it.poster} 500w`;
    img.sizes = '(max-width: 720px) 46vw, 220px';
    return;
  }
  img.src = posterArt(it.title, it.key);
}

function ringIcon() {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true' });
  svg.append(svgEl('path', { d: 'M12 4c4.5 0 8 3 8 7s-3.5 8-8 8-8-3-8-7 3-8 8-8z', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round' }));
  return svg;
}

function buildPrint(it) {
  const img = el('img', { alt: '', width: '342', height: '513', loading: 'lazy', decoding: 'async' });
  posterSrcset(it, img);
  img.addEventListener('error', () => { img.removeAttribute('srcset'); img.src = posterArt(it.title, it.key); }, { once: true });

  const stateEl = el('span', { class: 'print__state' });
  const studio = it.studios.join(' & ');
  const open = el('button', { class: 'print__open', type: 'button', 'aria-label': `Open ${it.title}` },
    el('span', { class: 'print__paper' },
      el('span', { class: 'print__frame' }, img, el('span', { class: 'print__tint' })),
      el('span', { class: 'print__cap' },
        el('span', { class: 'print__title', text: it.title }),
        el('span', { class: 'print__meta' },
          el('span', { class: `print__studio print__studio--${studioClass(it)}`, text: studio }),
          stateEl))));
  open.addEventListener('click', () => openSheet(it.key));

  const ring = svgEl('svg', { class: 'print__ring', viewBox: '0 0 100 150', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  ring.append(svgEl('path', { d: 'M14 82C6 42 38 10 72 16c28 6 28 82 0 112-26 26-62 8-62-34 0-24 10-44 26-58', pathLength: '1' }));

  const mark = el('button', { class: 'print__mark', type: 'button', 'aria-pressed': String(state.marks.has(it.key)), 'aria-label': `Mark ${it.title}`, title: 'Mark this title' }, ringIcon());
  mark.addEventListener('click', () => toggleMark(it));

  const tilt = ((hashStr(it.key) % 100) / 100 - 0.5) * 1.4;
  const li = el('li', { class: 'print' }, el('span', { class: 'print__peg', 'aria-hidden': 'true' }), open, ring, mark);
  li.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`);
  li.style.setProperty('--k', (0.55 + ((hashStr(it.key + 'k') % 100) / 100) * 0.9).toFixed(2));
  li.classList.toggle('is-marked', state.marks.has(it.key));
  it.li = li;
  it.stateEl = stateEl;
  it.markEl = mark;
  return li;
}

function renderWall() {
  const frag = document.createDocumentFragment();
  for (const it of state.items) frag.append(buildPrint(it));
  els.wall.replaceChildren(frag);
  state.devCount = 0;
  state.quiet = true;
}

function toggleMark(it) {
  const on = !state.marks.has(it.key);
  if (on) state.marks.add(it.key); else state.marks.delete(it.key);
  store.set('marks', [...state.marks]);
  it.li.classList.toggle('is-marked', on);
  it.markEl.setAttribute('aria-pressed', String(on));
  if (state.marked) applyFilters(); else updateMarkedCount();
  const sheetBtn = $('#sheet-mark');
  if (sheetBtn && sheetBtn.dataset.key === it.key) setMarkBtn(sheetBtn, on);
}
const updateMarkedCount = () => { els.markedN.textContent = String(state.marks.size); };

/* ---------- filtering ---------- */

const isDoc = (it) => it.genres.includes('Documentary');
function matchesBase(it, q) {
  if (state.studio !== 'all' && !it.studios.includes(state.studio)) return false;
  if (state.format === 'film' && (it.kind !== 'movie' || isDoc(it))) return false;
  if (state.format === 'series' && (it.kind !== 'tv' || isDoc(it))) return false;
  if (state.format === 'doc' && !isDoc(it)) return false;
  if (state.marked && !state.marks.has(it.key)) return false;
  if (q && !`${it.title} ${it.genres.join(' ')} ${it.studios.join(' ')}`.toLowerCase().includes(q)) return false;
  return true;
}

function settle() {
  applyFilters();
}

function applyFilters() {
  const D = state.sweeping ? clampDay(state.today) : state.dial;
  const q = state.q.trim().toLowerCase();
  const counts = { all: 0, upcoming: 0, theatres: 0, digital: 0, streaming: 0, released: 0 };
  let shown = 0;
  for (const it of state.items) {
    const st = statusOf(it, D);
    it.status = st;
    it.stateEl.textContent = stateLabel(it, st);
    const base = matchesBase(it, q);
    if (base) { counts.all += 1; counts[st] += 1; }
    const visible = base && (state.status === 'all' || state.status === st);
    it.li.hidden = !visible;
    if (visible) shown += 1;
  }
  const past = D < state.today;
  for (const chip of $$('.chip')) {
    const v = chip.dataset.value;
    $('.chip__n', chip).textContent = String(counts[v] ?? 0);
    chip.classList.toggle('is-dim', past && (v === 'digital' || v === 'streaming'));
  }
  if (!state.sweeping) {
    els.count.textContent = shown === 1 ? '1 title' : `${shown} titles`;
    els.count.title = past ? 'Digital and streaming availability reflects today, so those filters are empty for past dates.' : '';
  }
  els.empty.hidden = shown > 0 || !state.items.length;
  updateMarkedCount();
}

function setGroup(group, value) {
  state[group] = value;
  for (const b of $$(`[data-group="${group}"] [data-value]`)) b.setAttribute('aria-pressed', String(b.dataset.value === value));
  applyFilters();
}

function bindControls() {
  for (const group of ['studio', 'format', 'status']) {
    $(`[data-group="${group}"]`).addEventListener('click', (e) => {
      const b = e.target.closest('[data-value]');
      if (b) setGroup(group, b.dataset.value);
    });
  }
  let t = 0;
  els.q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = els.q.value; applyFilters(); }, 110);
  });
  els.markedBtn.addEventListener('click', () => {
    state.marked = !state.marked;
    els.markedBtn.setAttribute('aria-pressed', String(state.marked));
    applyFilters();
  });
  els.sortBtn.addEventListener('click', () => {
    state.order = state.order === 'new' ? 'old' : 'new';
    els.sortBtn.textContent = state.order === 'new' ? 'Newest first' : 'Oldest first';
    state.items.reverse();
    els.wall.append(...state.items.map((i) => i.li));
  });
  $('#clear-btn').addEventListener('click', () => {
    els.q.value = ''; state.q = '';
    state.marked = false; els.markedBtn.setAttribute('aria-pressed', 'false');
    setGroup('studio', 'all'); setGroup('format', 'all'); setGroup('status', 'all');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !els.sheet.open) {
      e.preventDefault();
      els.q.focus();
    }
  });
  els.region.addEventListener('change', async () => {
    state.region = els.region.value;
    store.set('region', state.region);
    detailCache.clear();
    if (!state.demo) await reload();
  });
}

function buildRegionSelect() {
  let names;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }
  els.region.replaceChildren(...REGIONS.map((code) => el('option', { value: code, text: names?.of(code) || code })));
  els.region.value = state.region;
}

/* ---------- detail sheet ---------- */

let sheetToken = 0;
let lastFocus = null;

function setMarkBtn(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? 'Marked' : 'Mark this title';
}

function sheetImage(it) {
  if (it.art) return it.art;
  if (it.backdrop) return `${TMDB_IMG}/w780${it.backdrop}`;
  if (it.poster) return `${TMDB_IMG}/w500${it.poster}`;
  return posterArt(it.title, it.key);
}

function renderSheet(it) {
  const released = it.ts <= state.today;
  const st = it.status || statusOf(it, state.dial);
  const img = el('img', { alt: '', decoding: 'async' });
  img.src = sheetImage(it);
  img.addEventListener('error', () => { img.src = posterArt(it.title, it.key); }, { once: true });
  const plate = el('div', { class: 'plate' }, img, el('span', { class: 'plate__tint' }),
    released ? null : el('p', { class: 'plate__note', text: `Not developed yet. Opens ${fmtDate(it.ts)}.` }));

  const metaItems = [
    el('li', { class: `sheet__studio--${studioClass(it)}`, text: it.studios.join(' & ') }),
    el('li', { text: stateLabel(it, st) === String(new Date(it.ts).getUTCFullYear()) ? `Released ${new Date(it.ts).getUTCFullYear()}` : stateLabel(it, st) }),
    el('li', { text: it.kind === 'tv' ? 'Series' : 'Film' }),
  ];
  if (it.rating) metaItems.push(el('li', { text: `${Number(it.rating).toFixed(1)} on TMDB` }));
  const meta = el('ul', { class: 'sheet__meta', id: 'sheet-meta' }, metaItems);

  const head = el('div', { class: 'sheet__head' },
    el('h2', { class: 'sheet__title', id: 'sheet-title', text: it.title }),
    el('p', { class: 'sheet__tagline', id: 'sheet-tagline', hidden: true }),
    meta,
    it.genres.length ? el('p', { class: 'sheet__genres', text: it.genres.join(', ') }) : null);

  const markBtn = el('button', { class: 'markbtn', id: 'sheet-mark', type: 'button', 'data-key': it.key });
  setMarkBtn(markBtn, state.marks.has(it.key));
  markBtn.addEventListener('click', () => toggleMark(it));

  els.sheetBody.replaceChildren(
    plate, head,
    el('p', { class: 'sheet__text', text: it.overview || 'No synopsis yet.' }),
    el('div', { class: 'sheet__detail', id: 'sheet-detail' }, el('p', { class: 'sheet__muted', text: 'Loading release dates and where to watch…' })),
    el('div', { class: 'sheet__actions' }, markBtn));

  if (released) setTimeout(() => plate.classList.add('is-developed'), reduceMotion ? 0 : 380);
  return plate;
}

function providerChip(p) {
  const logoOk = typeof p.logo === 'string' && p.logo.startsWith('https://image.tmdb.org/');
  return el('li', { class: 'prov' },
    logoOk ? el('img', { src: p.logo, alt: '', width: '28', height: '28', loading: 'lazy' }) : el('span', { class: 'prov__dot', text: (p.name || '?').slice(0, 1) }),
    p.name);
}

function fillDetail(it, d, plate) {
  const box = $('#sheet-detail');
  if (!box) return;
  box.replaceChildren();
  if (!d) {
    box.append(el('p', { class: 'sheet__muted', text: 'Details are unavailable right now. Close this and try again in a moment.' }));
    return;
  }
  if (d.tagline) {
    const tl = $('#sheet-tagline');
    tl.textContent = d.tagline; tl.hidden = false;
  }
  const meta = $('#sheet-meta');
  if (d.runtime) meta.append(el('li', { text: `${d.runtime} min` }));
  if (d.seasons) meta.append(el('li', { text: d.seasons === 1 ? '1 season' : `${d.seasons} seasons` }));

  if (d.trailer && /^[\w-]{6,20}$/.test(d.trailer)) {
    const play = el('button', { class: 'plate__play', type: 'button' }, 'Play trailer');
    play.addEventListener('click', () => {
      plate.append(el('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${d.trailer}?autoplay=1&rel=0`,
        title: `${it.title} trailer`, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      }));
      play.remove();
    });
    plate.append(play);
  }

  const rows = [];
  if (d.theatrical) rows.push(['In theatres', fmtDate(parseDate(d.theatrical))]);
  if (d.firstAired) rows.push(['First aired', fmtDate(parseDate(d.firstAired))]);
  if (d.digital) rows.push(['Digital release', fmtDate(parseDate(d.digital))]);
  if (rows.length) {
    box.append(el('h3', { class: 'sheet__h', text: 'Release dates' }),
      el('dl', { class: 'dates' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
  }

  const regionName = els.region.selectedOptions[0]?.textContent || state.region;
  const p = d.providers || {};
  const released = it.ts <= state.today;
  if (p.stream?.length || p.rentBuy?.length) {
    box.append(el('h3', { class: 'sheet__h', text: `Where to watch in ${regionName}` }));
    if (p.stream?.length) box.append(el('p', { class: 'sheet__muted', text: 'Streaming' }), el('ul', { class: 'provs' }, p.stream.map(providerChip)));
    if (p.rentBuy?.length) box.append(el('p', { class: 'sheet__muted', text: 'Rent or buy' }), el('ul', { class: 'provs' }, p.rentBuy.map(providerChip)));
    if (p.link && /^https:\/\//.test(p.link)) box.append(el('a', { class: 'sheet__link', href: p.link, target: '_blank', rel: 'noopener noreferrer', text: 'See every option on TMDB' }));
  } else {
    box.append(el('h3', { class: 'sheet__h', text: `Where to watch in ${regionName}` }),
      el('p', { class: 'sheet__muted', text: released ? 'Not on streaming, rent or buy in this country yet.' : 'Not available yet. It will show up here once it has a release.' }));
  }

  const credits = [];
  if (d.director) credits.push(['Director', d.director]);
  if (d.cast?.length) credits.push(['Cast', d.cast.join(', ')]);
  if (credits.length) {
    box.append(el('h3', { class: 'sheet__h', text: 'Credits' }),
      el('dl', { class: 'dates' }, credits.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
  }
}

async function openSheet(key, push = true) {
  const it = state.byKey.get(key);
  if (!it) return;
  const token = ++sheetToken;
  lastFocus = document.activeElement;
  const plate = renderSheet(it);
  if (!els.sheet.open) els.sheet.showModal();
  requestAnimationFrame(() => els.sheet.classList.add('is-in'));
  els.sheet.scrollTop = 0;
  if (push) history.replaceState(null, '', `#${key}`);
  const d = await loadDetail(it);
  if (token !== sheetToken) return;
  fillDetail(it, d, plate);
}

function closeSheet() {
  if (!els.sheet.open) return;
  sheetToken += 1;
  els.sheet.classList.remove('is-in');
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => {
    if (els.sheet.classList.contains('is-in')) return;
    els.sheet.close();
    els.sheetBody.replaceChildren();
    lastFocus?.focus?.({ preventScroll: true });
  }, reduceMotion ? 0 : 420);
}

function bindSheet() {
  els.sheetClose.addEventListener('click', closeSheet);
  els.sheet.addEventListener('click', (e) => { if (e.target === els.sheet) closeSheet(); });
  els.sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
}

/* ---------- boot ---------- */

async function reload() {
  const dial = state.dial;
  const items = await loadCatalog();
  ingest(items);
  buildRuler();
  renderWall();
  state.dial = -1;
  setDial(dial);
  applyFilters();
  state.quiet = false;
}

function intro() {
  const target = clampDay(state.today);
  if (reduceMotion) { setDial(target); applyFilters(); state.quiet = false; return; }
  state.sweeping = true;
  setDial(state.min);
  applyFilters();
  state.quiet = false;
  setTimeout(() => {
    if (!state.sweeping) return;
    sweepTo(target, 3000, () => { state.sweeping = false; applyFilters(); });
  }, 500);
}

async function boot() {
  state.region = pickRegion();
  buildRegionSelect();
  els.count.textContent = 'Loading the catalogue…';
  const items = await loadCatalog();
  ingest(items);
  buildRuler();
  renderWall();
  bindDial();
  bindControls();
  bindSheet();
  const hashKey = decodeURIComponent(location.hash.slice(1));
  const deepLink = state.byKey.has(hashKey);
  motion.start();
  if (deepLink || reduceMotion) document.body.classList.remove('is-intro');
  else setTimeout(() => document.body.classList.remove('is-intro'), 2600);
  if (deepLink) { setDial(clampDay(state.today)); applyFilters(); state.quiet = false; openSheet(hashKey, false); }
  else intro();
}

boot();
