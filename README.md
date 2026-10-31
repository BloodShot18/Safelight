# Safelight

A24 and Neon films, series and documentaries on one release-date dial. Plain HTML, CSS and JS, plus one Cloudflare Pages Function that proxies TMDB so your API key stays private.

## Run it locally

```bash
cp .dev.vars.example .dev.vars        # add your TMDB key
npx wrangler pages dev                 # serves ./public and ./functions
```

Without a key (or without the function), the site falls back to fictional sample titles so you can see the design.

## Deploy to Cloudflare Pages

1. Get a free TMDB API key: themoviedb.org > Settings > API.
2. Push this folder to a GitHub repo, then in Cloudflare: Workers & Pages > Create > Pages > Connect to Git.
   - Build command: leave empty
   - Build output directory: `public`
3. In the project: Settings > Variables and secrets > add `TMDB_KEY` (type: Secret).
4. Redeploy. Open `https://<your-project>.pages.dev`.

Or from the terminal:

```bash
npx wrangler pages project create safelight
npx wrangler pages secret put TMDB_KEY --project-name safelight
npx wrangler pages deploy
```

## Check the studio IDs

The function defaults to `41077` for A24 and `90733` for Neon. Confirm both once after deploying:

```
https://<your-project>.pages.dev/api/lookup?q=a24
https://<your-project>.pages.dev/api/lookup?q=neon
```

If an ID is different, set `A24_ID` or `NEON_ID` as a variable in Pages and redeploy.

## How statuses work

The dial sets an "as of" date. For that date:

| Status | Rule |
| --- | --- |
| Upcoming | release date is after the dial |
| In theatres | film released within the last 75 days |
| Digital | rent or buy offer exists in the chosen country |
| Streaming | subscription, free or ad-supported offer exists in the chosen country |
| Released | everything else |

Digital and streaming come from TMDB's watch-provider data (JustWatch) for today, so those two filters are empty when the dial is set to a past date.

## Motion

All motion lives in `public/motion.js` plus the "Motion" block at the end of `public/styles.css`.

- Opening: the safelight strikes, the headline wipes in, then the dial sweeps from 2023 to today.
- Rolling-digit date, and a film strip that scrolls with the dial.
- Prints swing on their pegs when you drag fast, and a wash of developer sweeps over each print as it develops.
- Dust drifts through the lamp light (canvas), and the lamp flickers slightly.

Visitors who set "reduce motion" in their system get none of it: no intro, no dust, no animations, and the dial jumps straight to today. To tone things down, lower the mote count in `createMotion` or delete the `.room::before` flicker rule.

## Notes

- TMDB titles with no release date are skipped, because they cannot be placed on the timeline.
- The function caches catalogue responses at the edge for 6 hours and stays under the free plan's 50 subrequests per call.
- TMDB's terms ask for attribution (included in the footer). Add their logo to the footer if you publish publicly, and use a commercial licence if the site earns money.
- Poster art and posters shown for real titles belong to their rights holders and are served directly from TMDB's image CDN.
