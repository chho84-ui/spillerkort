# Goodminton – CLAUDE.md

Instruksjoner til Claude Code for dette prosjektet. Les dette før du gjør noe annet.

## Hva er dette?

Webapp som viser spillerkort, ranking og kampprogram for badmintonspillere i Norge.
- **Frontend:** `index.html` + `app.js` + `style.css` → hostet på GitHub Pages → goodminton.no
- **Backend:** `worker.js` → Cloudflare Worker → spillerkort-proxy.chho84.workers.dev
- **Kildekode:** github.com/chho84-ui/spillerkort

## Deploy-rutine (ALLTID gjøre begge)

### Worker (worker.js → Cloudflare):
```bash
# Tokens ligger i SETUP.md (ikke committed) eller miljøvariabler
CLOUDFLARE_API_TOKEN=<se SETUP.md> \
CLOUDFLARE_ACCOUNT_ID=<se SETUP.md> \
npx wrangler deploy worker.js --name spillerkort-proxy --compatibility-date 2024-01-01
```

### Frontend (app.js / style.css / index.html → GitHub Pages):
```powershell
$ghToken = '<se SETUP.md>'
$user = 'chho84-ui'
$headers = @{ Authorization = "Bearer $ghToken"; 'User-Agent' = 'spillerkort'; Accept = 'application/vnd.github+json' }
$baseDir = 'C:\Users\chriholm\spillerkort'
foreach ($file in @('app.js', 'style.css', 'index.html')) {
  $fullPath = Join-Path $baseDir $file
  $content = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($fullPath))
  $existing = Invoke-RestMethod "https://api.github.com/repos/$user/spillerkort/contents/$file" -Headers $headers
  Invoke-RestMethod "https://api.github.com/repos/$user/spillerkort/contents/$file" `
    -Method PUT -Headers $headers -ContentType 'application/json' `
    -Body (@{ message = 'deploy'; content = $content; sha = $existing.sha } | ConvertTo-Json) | Out-Null
  Write-Host ('Deployed ' + $file + ' OK')
}
```

### Git (ALLTID etter deploy):
```bash
git add -A
git commit -m "beskrivelse"
git pull --rebase origin main
git push
```

---

## Arkitektur – worker.js endepunkter

| Path | Beskrivelse |
|------|-------------|
| `/search` | Søk etter spiller på badmintonportalen.no |
| `/api` | Proxy til badmintonportalen AJAX-webservice |
| `/app` | Proxy til badmintonportalen App.aspx |
| `/cup2000` | Henter kampprogram + gruppestandings + sluttspill fra cup2000.dk |
| `/cup2000live` | Henter alle kommende/pågående kamper (alle baner) fra cup2000.dk |
| `/varsle` | Lagrer e-postvarsel i KV-store (VARSLER) |
| `/debug` | Sjekker badmintonportalen session-token |

---

## cup2000.dk API – datastruktur (kritisk kunnskap)

**Base URL:** `https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx`

### Finn turnerings-ID:
Scrape `https://www.cup2000.dk/turnerings-system/Vis-turneringer/` for `onclick="selectTournament(ID)"`.

### Klasse-navigasjon:
`?tournamentid=ID&c=0` → renderMethod=1, HTML med lenker `c=X&e=Y` per klasse.
Fallback: scrape `https://www.cup2000.dk/turnerings-system/Vis-turneringer/?tournamentid=ID`

### Klasse-oversikt (puljer):
`?tournamentid=ID&c=C&e=E` → `data[0][3]` = puljer: `[[puljeId, [spillere]], ...]`
Spiller i pulje: `s = [idx, ["Navn, Klubb", ...]]`

### Gruppespill-data per pulje:
`?tournamentid=ID&c=C&e=E&p=0&g=PULJEID`
- `data[1]` = standings: `[idx, ?, ?, ?, "pos", ["Navn, Klubb", ...], played, kV, kT, sV, sT, ...]`
  - `s[5]` kan ha **flere navn** for doubles/mix
- `data[2][0]` = kamper (flat array): `[bane, ?, "HH:MM DD-MM-YYYY", scoreStr, ?, vinner(1/2), [], [], sp1idx, sp2idx, ...]`
  - `match[3]` = score string: `"21/9 21/18"` (slash = sp1/sp2, mellomrom = sett)
  - `match[5]` = vinner: 1=sp1, 2=sp2

### Sluttspill:
`?tournamentid=ID&c=C&e=E&p=1` (uten g!)
- `data[0]` = tittel (string)
- `data[1]` = seedMap: `[[idx, ?, pos, ["Navn, Klubb"]], ...]`
- `data[2]` = runder: `[[rundeId, [[kamp1, kamp2, ...], null]], ...]`
  - Kamper i `runde[1][0]` (ikke `runde[1]`)
  - Kamp-format: `[bane, ?, "HH:MM DD-MM-YYYY", scoreStr, ?, vinner, [], [], sp1idx, sp2idx, ...]`

### Kommende/live kamper:
`?tournamentid=ID&w=1`
- `data[3][0]` = flat liste av kamper
- Kamp: `[bane, ?, "HH:MM DD-MM-YYYY", statusStr, discFull, 0, [sp1names...], [sp2names...], sp1idx, sp2idx, score, ...]`
  - `match[3]` = `"NÆSTE KAMP"` / `"Antal kampe før: N"` / `""` (live)
  - `match[6]`/`[7]` = navn-arrays: `["Navn, Klubb", ...]`
  - `match[10]` = live score: `[set1sp1, set1sp2, set2sp1, set2sp2, ...]`

---

## app.js – viktige funksjoner

| Funksjon | Beskrivelse |
|----------|-------------|
| `hent()` | Hovedfunksjon – søker opp spiller og viser alt |
| `visTurnering(t)` | Renderer én turnering med kamper og gruppe-knapp |
| `cup2000Api(navn, url)` | Henter kampprogram fra `/cup2000` (2 min cache) |
| `cup2000LiveApi(navn)` | Henter live-oversikt fra `/cup2000live` (30 sek cache) |
| `visLive(id, navn)` | Åpner live-panel overlay |
| `renderLiveInnhold(data)` | Renderer innhold i live-panel (global, brukes av oppdaterLive) |
| `oppdaterLive(navn)` | Tømmer cache og oppdaterer live-panel |
| `visGruppe(g)` | Åpner gruppestillings-overlay |
| `aapneMotstander(navn, klubb)` | Søker opp motstander |
| `discTilKode(disc)` | Konverterer "Herresingle" → "HS" etc. |
| `parseTid(tid)` | Parser "DD-MM HH:MM" til Date |

### Cache-TTL:
- Generell: 10 min (`CACHE_TTL`)
- cup2000 kampprogram: 2 min (`CUP2000_TTL`)
- cup2000 live: 30 sek (`LIVE_TTL`)

### Turnerings-objekt (t):
```js
{
  tournamentId, navn, dato, dager, cup2000Url,
  registreringer: [{ disiplin, bekreftet, makkere, ageGroup }],
  klasser: [{ id, name }]
}
```

### Gruppe-data fra worker:
```js
{ disc: "HS", ageGroup: "U15 A", spillere: [{ pos, navn, klubb, kV, kT, sV, sT, erMeg }] }
```

---

## Kjente gotchas

- **cup2000.dk blokkerer CORS** – all fetching må gå via worker, ikke direkte fra nettleser
- **GitHub Pages cacher aggressivt** – brukere må lukke/åpne fane for hard refresh på mobil
- **`g=-1` virker ikke** – sluttspill hentes med `p=1` uten `g`-parameter
- **doubles/mix standings** – `s[5]` har flere navn, ikke bare `s[5][0]`
- **sluttspill runder** – kamper ligger i `runde[1][0]`, ikke `runde[1]`
- **git push avvises** – GitHub har nye commits fra API-deploy; bruk alltid `git pull --rebase origin main` før push
- **wrangler `--account-id`** – virker ikke, bruk env var `CLOUDFLARE_ACCOUNT_ID` i stedet

---

## Debugging med Chrome DevTools MCP

Alltid bruk DevTools MCP for å inspisere live oppførsel, ikke gjetning:
```js
// Test worker direkte:
fetch('https://spillerkort-proxy.chho84.workers.dev/cup2000', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ tournamentNavn: 'UBM', navn: 'Oliver Holmefjord', klubb: 'Sotra' })
}).then(r=>r.json()).then(console.log)
```

Chrome må kjøre med: `chrome.exe --remote-debugging-port=9222`
