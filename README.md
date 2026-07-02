# Goodminton

Webapp som viser spillerkort, ranking, påmeldinger og kampprogram (med live-score) for badmintonspillere i Norge.

Bygget på data fra badmintonportalen.no og cup2000.dk.

## Arkitektur

- **Frontend:** Static site på GitHub Pages (goodminton.no)
  - `index.html` – UI
  - `app.js` – app-logikk, API-kall til worker
  - `style.css` – styling
  - `stats.html` – brukerstats-side
  - Firebase for innlogging og favoritter

- **Backend:** Cloudflare Worker (`worker.js`)
  - Proxy mot badmintonportalen.no og cup2000.dk
  - Håndterer CORS-problemer
  - KV-store for e-postvarsler
  - Deploy via `wrangler deploy` (se `wrangler.toml`)

## Filstruktur

| Fil | Formål |
|-----|--------|
| `index.html` | Hovedside |
| `app.js` | App-logikk |
| `style.css` | Styling |
| `stats.html` | Brukerstats |
| `worker.js` | Cloudflare Worker |
| `wrangler.toml` | Worker-config |
| `robots.txt` | SEO |
| `.gitignore` | Git-ignoreringer |

## Deploy

Se `CLAUDE.md` for deploy-rutine (both frontend og worker).

## Mer info

Se `CLAUDE.md` for:
- Cup2000.dk API-struktur
- app.js-funksjoner og cache-TTL
- worker.js-endepunkter
- Kjente gotchas
