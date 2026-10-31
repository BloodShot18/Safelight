// Sample data and generated poster art. Used only when the TMDB proxy is not reachable
// (for example before the API key is added). All titles here are fictional.

const PALETTES = [
  ['#0e3b43', '#f2a65a', '#f7e7ce'],
  ['#3d1e6d', '#ff8fab', '#ffe5ec'],
  ['#1b3a2a', '#d4e157', '#f1f8e9'],
  ['#7a0c1e', '#f6c453', '#fff1d6'],
  ['#0b2545', '#8da9c4', '#eef4ed'],
  ['#2d1b69', '#ff6b35', '#fcefef'],
  ['#264653', '#e9c46a', '#f4a261'],
  ['#3a0ca3', '#4cc9f0', '#f72585'],
  ['#1d3557', '#e63946', '#f1faee'],
  ['#283618', '#dda15e', '#fefae0'],
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function wrapTitle(title, max = 11) {
  const words = title.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

/** Typographic poster, returned as an SVG data URI. Deterministic for a given seed. */
export function posterArt(title, seedKey = title) {
  const seed = hash(seedKey);
  const rand = rng(seed);
  const [c0, c1, c2] = PALETTES[seed % PALETTES.length];
  const layout = Math.floor(rand() * 5);
  let art = '';

  if (layout === 0) {
    art += `<circle cx="150" cy="185" r="92" fill="${c1}"/>`;
    art += `<rect y="255" width="300" height="200" fill="#000" opacity=".38"/>`;
    for (let i = 0; i < 7; i++) art += `<rect y="${268 + i * 17}" width="300" height="${2 + i * 0.6}" fill="${c2}" opacity=".35"/>`;
  } else if (layout === 1) {
    for (let i = 7; i > 0; i--) {
      art += `<circle cx="${130 + rand() * 40}" cy="190" r="${i * 22}" fill="none" stroke="${i % 2 ? c1 : c2}" stroke-width="${3 + (7 - i)}" opacity=".85"/>`;
    }
  } else if (layout === 2) {
    art += `<polygon points="0,0 300,0 300,200 0,330" fill="${c1}"/>`;
    art += `<polygon points="0,330 300,200 300,262 0,392" fill="${c2}" opacity=".85"/>`;
  } else if (layout === 3) {
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 7; x++) {
        const d = Math.hypot(x - 3, y - 3.4);
        const r = Math.max(1.5, 17 - d * 3.4);
        art += `<circle cx="${22 + x * 43}" cy="${24 + y * 36}" r="${r.toFixed(1)}" fill="${c1}"/>`;
      }
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const x = 28 + i * 86;
      art += `<path d="M${x} 330 V190 A38 38 0 0 1 ${x + 76} 190 V330 Z" fill="${i === 1 ? c2 : c1}" opacity="${i === 1 ? 0.95 : 0.8}"/>`;
    }
  }

  const lines = wrapTitle(title);
  const size = lines.some((l) => l.length > 9) ? 36 : 42;
  const lead = size + 4;
  const startY = 430 - (lines.length - 1) * lead;
  const text = lines
    .map((l, i) => `<text x="22" y="${startY + i * lead}" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${size}" fill="${c2}">${esc(l)}</text>`)
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></linearGradient></defs>` +
    `<rect width="300" height="450" fill="${c0}"/>${art}<rect width="300" height="450" fill="url(#g)"/>${text}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// [title, kind, studio, genres, release offset in days from today, rating]
const SAMPLES = [
  ['Salt Meridian', 'movie', 'Neon', ['Thriller', 'Drama'], 9, null],
  ['The Understudy', 'movie', 'A24', ['Comedy', 'Drama'], 23, null],
  ['Wolf Hour', 'movie', 'Neon', ['Horror'], 37, null],
  ['Marigold Lane', 'movie', 'A24', ['Drama', 'Romance'], 58, null],
  ['Static Bloom', 'movie', 'A24', ['Science Fiction', 'Thriller'], 86, null],
  ['Harbor Lights', 'tv', 'A24', ['Drama', 'Mystery'], 104, null],
  ['A Map of Small Hours', 'movie', 'Neon', ['Drama'], 131, null],
  ['What the River Kept', 'movie', 'Neon', ['Documentary'], 168, null],
  ['Cinder Valley', 'movie', 'A24', ['Western', 'Drama'], 210, null],
  ['Night Ferry', 'movie', 'Neon', ['Thriller', 'Crime'], -6, 7.1],
  ['Hollow Season', 'movie', 'A24', ['Horror', 'Mystery'], -14, 6.8],
  ['The Quiet Orchard', 'movie', 'A24', ['Drama'], -29, 7.4],
  ['Low Tide Choir', 'movie', 'Neon', ['Music', 'Drama'], -44, 7.0],
  ['Ten Thousand Doors', 'movie', 'A24', ['Documentary'], -61, 7.9],
  ['Brine', 'movie', 'Neon', ['Horror', 'Thriller'], -96, 6.5],
  ['Velvet Drought', 'movie', 'A24', ['Comedy'], -131, 6.9],
  ["Other People's Weather", 'movie', 'A24', ['Drama', 'Comedy'], -170, 7.6],
  ["The Sleepwalkers' Union", 'tv', 'Neon', ['Comedy', 'Drama'], -205, 8.0],
  ['Fever Parade', 'movie', 'Neon', ['Music', 'Documentary'], -250, 7.7],
  ['Dust Cathedral', 'movie', 'A24', ['Fantasy', 'Drama'], -310, 7.2],
  ['The Long Rehearsal', 'movie', 'A24', ['Drama'], -380, 7.5],
  ['Moth Season', 'movie', 'Neon', ['Horror'], -440, 6.6],
  ['Kerosene Summer', 'movie', 'A24', ['Crime', 'Drama'], -515, 7.3],
  ['Deep Pantry', 'tv', 'A24', ['Comedy'], -590, 8.1],
  ['Glass Orchard', 'movie', 'Neon', ['Mystery', 'Thriller'], -660, 6.9],
  ['The Last Lighthouse Keeper', 'movie', 'A24', ['Drama', 'History'], -740, 7.8],
  ['Paper Lanterns', 'movie', 'Neon', ['Romance', 'Drama'], -820, 7.1],
  ['Small Hours Radio', 'tv', 'Neon', ['Documentary'], -905, 7.9],
  ['Tin Saints', 'movie', 'A24', ['Crime', 'Comedy'], -1010, 6.7],
  ['Orchard of Salt', 'movie', 'Neon', ['Western'], -1105, 7.0],
];

const DAY = 864e5;

export function demoCatalog(today) {
  return SAMPLES.map(([title, kind, studio, genres, offset, rating], i) => {
    const key = `demo-${i}`;
    const old = offset <= -75;
    const r = rng(hash(key));
    return {
      key,
      kind,
      id: i,
      title,
      ts: today + offset * DAY,
      art: posterArt(title, key),
      studios: [studio],
      genres,
      rating,
      overview: `${title} is a sample listing used to preview the layout. Connect your TMDB key and this is replaced by the real catalogue.`,
      flags: {
        s: old && r() > 0.45,
        b: (old && r() > 0.3) || (offset < -25 && offset > -75 && r() > 0.5),
      },
    };
  });
}

export function demoDetail(item, today) {
  const released = item.ts <= today;
  return {
    tagline: '',
    runtime: item.kind === 'movie' ? 88 + (hash(item.key) % 40) : null,
    seasons: item.kind === 'tv' ? 1 + (hash(item.key) % 3) : null,
    theatrical: item.kind === 'movie' ? new Date(item.ts).toISOString().slice(0, 10) : null,
    firstAired: item.kind === 'tv' ? new Date(item.ts).toISOString().slice(0, 10) : null,
    digital: item.flags.b && item.kind === 'movie' ? new Date(item.ts + 45 * DAY).toISOString().slice(0, 10) : null,
    trailer: null,
    providers: released
      ? {
          link: null,
          stream: item.flags.s ? [{ name: 'Sample Stream', logo: null }] : [],
          rentBuy: item.flags.b ? [{ name: 'Sample Store', logo: null }] : [],
        }
      : { link: null, stream: [], rentBuy: [] },
    director: 'Sample Director',
    cast: ['Sample Actor', 'Another Actor', 'Third Actor'],
  };
}
