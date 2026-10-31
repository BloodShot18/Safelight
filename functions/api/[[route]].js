// Cloudflare Pages Function: a small, cached proxy in front of TMDB.
// Keeps the API key on the server and shapes the data the site needs.
//
// Routes
//   GET /api/catalog?region=IN        every A24 and Neon title since 2023, with streaming and rent/buy flags
//   GET /api/title/movie/123?region=IN full details for one title
//   GET /api/lookup?q=neon            find TMDB company ids (use this to double-check A24_ID and NEON_ID)
//
// Environment variables (Pages > Settings > Variables and secrets)
//   TMDB_KEY    TMDB v3 API key            (or TMDB_TOKEN: the v4 read access token)
//   A24_ID      optional, default 41077
//   NEON_ID     optional, default 90733

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const SINCE = '2023-01-01';

export async function onRequestGet(context) {
  const { request, env, params, waitUntil } = context;
  const url = new URL(request.url);
  const route = Array.isArray(params.route) ? params.route : [params.route].filter(Boolean);

  if (!env.TMDB_KEY && !env.TMDB_TOKEN) return json({ error: 'missing_key' }, 503, 0);

  const regionParam = (url.searchParams.get('region') || '').toUpperCase();
  const region = /^[A-Z]{2}$/.test(regionParam) ? regionParam : 'US';

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let res;
  try {
    if (route[0] === 'catalog' && route.length === 1) {
      res = await catalog(env, region);
    } else if (route[0] === 'title' && route.length === 3 && /^(movie|tv)$/.test(route[1]) && /^\d{1,9}$/.test(route[2])) {
      res = await title(env, route[1], route[2], region);
    } else if (route[0] === 'lookup' && route.length === 1) {
      res = await lookup(env, url.searchParams.get('q') || '');
    } else {
      res = json({ error: 'not_found' }, 404, 0);
    }
  } catch (err) {
    res = json({ error: 'upstream', detail: String(err.message || err) }, 502, 0);
  }

  if (res.status === 200) waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function json(data, status = 200, sMaxAge = 3600) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': sMaxAge ? `public, max-age=300, s-maxage=${sMaxAge}` : 'no-store',
    },
  });
}

async function tmdb(env, path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  const headers = { accept: 'application/json' };
  if (env.TMDB_TOKEN) headers.authorization = `Bearer ${env.TMDB_TOKEN}`;
  else u.searchParams.set('api_key', env.TMDB_KEY);
  const r = await fetch(u, { headers, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error(`TMDB ${r.status} on ${path}`);
  return r.json();
}

async function discoverAll(env, kind, params, maxPages) {
  const first = await tmdb(env, `/discover/${kind}`, { ...params, page: 1 });
  const total = Math.min(first.total_pages || 1, maxPages);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, total - 1) }, (_, i) => tmdb(env, `/discover/${kind}`, { ...params, page: i + 2 })),
  );
  return [first, ...rest].flatMap((p) => p.results || []);
}

const discoverParams = (kind, companies) => ({
  with_companies: companies,
  include_adult: false,
  language: 'en-US',
  ...(kind === 'movie'
    ? { 'primary_release_date.gte': SINCE, sort_by: 'primary_release_date.desc' }
    : { 'first_air_date.gte': SINCE, sort_by: 'first_air_date.desc' }),
});

async function catalog(env, region) {
  const A24 = env.A24_ID || '41077';
  const NEON = env.NEON_ID || '90733';

  // Free-plan Workers allow 50 subrequests per call. This uses at most about 25.
  const jobs = [
    ['movie', 'A24', A24, 5],
    ['tv', 'A24', A24, 2],
    ['movie', 'Neon', NEON, 4],
    ['tv', 'Neon', NEON, 2],
  ];
  const flagSet = (kind, types) =>
    discoverAll(env, kind, { ...discoverParams(kind, `${A24}|${NEON}`), watch_region: region, with_watch_monetization_types: types }, 3)
      .then((rs) => new Set(rs.map((r) => r.id)));

  const [lists, streamMovie, buyMovie, streamTv, buyTv] = await Promise.all([
    Promise.all(
      jobs.map(([kind, studio, id, pages]) =>
        discoverAll(env, kind, discoverParams(kind, id), pages).then((rs) => rs.map((r) => ({ r, kind, studio }))),
      ),
    ),
    flagSet('movie', 'flatrate|free|ads'),
    flagSet('movie', 'rent|buy'),
    flagSet('tv', 'flatrate|free|ads'),
    flagSet('tv', 'rent|buy'),
  ]);

  const merged = new Map();
  for (const { r, kind, studio } of lists.flat()) {
    const date = r.release_date || r.first_air_date;
    if (!date) continue; // titles with no date yet can't be placed on the timeline
    const key = `${kind}-${r.id}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.studios.includes(studio)) existing.studios.push(studio);
      continue;
    }
    merged.set(key, {
      id: r.id,
      kind,
      title: r.title || r.name,
      date,
      poster: r.poster_path,
      backdrop: r.backdrop_path,
      overview: r.overview,
      rating: r.vote_count >= 20 ? Math.round(r.vote_average * 10) / 10 : null,
      genres: r.genre_ids || [],
      studios: [studio],
      s: (kind === 'movie' ? streamMovie : streamTv).has(r.id),
      b: (kind === 'movie' ? buyMovie : buyTv).has(r.id),
    });
  }

  return json({ generated: new Date().toISOString(), region, items: [...merged.values()] }, 200, 21600);
}

function pickReleaseDates(releaseDates, region) {
  const results = releaseDates?.results || [];
  const dates = (code, type) => {
    const c = results.find((x) => x.iso_3166_1 === code);
    return (c?.release_dates || []).filter((d) => d.type === type && d.release_date).map((d) => d.release_date.slice(0, 10)).sort();
  };
  const get = (type) => {
    for (const code of [region, 'US']) {
      const v = dates(code, type)[0];
      if (v) return v;
    }
    const all = results.flatMap((c) => (c.release_dates || []).filter((d) => d.type === type && d.release_date).map((d) => d.release_date.slice(0, 10))).sort();
    return all[0] || null;
  };
  return { theatrical: get(3) || get(2), digital: get(4) };
}

async function title(env, kind, id, region) {
  const d = await tmdb(env, `/${kind}/${id}`, {
    language: 'en-US',
    append_to_response: kind === 'movie' ? 'release_dates,videos,watch/providers,credits' : 'videos,watch/providers,credits',
  });

  const videos = (d.videos?.results || []).filter((v) => v.site === 'YouTube' && /^[\w-]{6,20}$/.test(v.key));
  const trailer = videos.find((v) => v.type === 'Trailer' && v.official) || videos.find((v) => v.type === 'Trailer') || videos[0];

  const regionProviders = d['watch/providers']?.results?.[region] || {};
  const mapProv = (list) => (list || []).map((p) => ({ name: p.provider_name, logo: p.logo_path ? `${IMG}/w92${p.logo_path}` : null }));
  const uniq = (list) => list.filter((p, i) => list.findIndex((q) => q.name === p.name) === i);
  const stream = uniq([...mapProv(regionProviders.flatrate), ...mapProv(regionProviders.free), ...mapProv(regionProviders.ads)]);
  const rentBuy = uniq([...mapProv(regionProviders.rent), ...mapProv(regionProviders.buy)]);

  const crew = d.credits?.crew || [];
  const director = kind === 'movie'
    ? crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ')
    : (d.created_by || []).map((c) => c.name).join(', ');

  const dates = kind === 'movie' ? pickReleaseDates(d.release_dates, region) : { theatrical: null, digital: null };

  return json({
    tagline: d.tagline || '',
    runtime: kind === 'movie' ? d.runtime || null : (d.episode_run_time || [])[0] || null,
    seasons: kind === 'tv' ? d.number_of_seasons || null : null,
    theatrical: dates.theatrical,
    digital: dates.digital,
    firstAired: kind === 'tv' ? d.first_air_date || null : null,
    trailer: trailer ? trailer.key : null,
    providers: { link: regionProviders.link || null, stream, rentBuy },
    director,
    cast: (d.credits?.cast || []).slice(0, 6).map((c) => c.name),
  }, 200, 21600);
}

async function lookup(env, q) {
  q = q.trim().slice(0, 60);
  if (!q) return json({ results: [] }, 200, 0);
  const d = await tmdb(env, '/search/company', { query: q });
  return json({
    results: (d.results || []).slice(0, 10).map((c) => ({ id: c.id, name: c.name, country: c.origin_country })),
  }, 200, 3600);
}
