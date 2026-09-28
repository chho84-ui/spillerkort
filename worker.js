import { buildPushPayload } from '@block65/webcrypto-web-push';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// cup2000-oppsett per turnering (sesjonscookie, spillesteder, dagens dt) – spart i 10 min per isolate,
// så /cup2000live bare trenger én runde med kall.
const LIVE_OPPSETT = new Map();

let cachedCtx = null;
let ctxExpiry = 0;

async function getCtx() {
  const now = Date.now();
  if (cachedCtx && now < ctxExpiry) return cachedCtx;
  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'nb-NO,nb;q=0.9'
  };
  const r = await fetch('https://badmintonportalen.no/', { headers: hdrs });
  const html = await r.text();
  const m = html.match(/SR_CallbackContext\s*=\s*['"]([^'"]{10,})['"]/);
  cachedCtx = m ? m[1] : null;
  ctxExpiry = now + 5 * 60 * 1000;
  return cachedCtx;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function finnCup2000Id(body) {
  let cup2000Id = null;
  if (body.cup2000Url) {
    const m = body.cup2000Url.match(/tournamentid=(\d+)/i);
    if (m) cup2000Id = m[1];
  }
  if (!cup2000Id && body.tournamentNavn) {
    const listHtml = await (await fetch('https://www.cup2000.dk/turnerings-system/Vis-turneringer/', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })).text();
    const normStr = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/^[^:]+:\s*/, '').toLowerCase().replace(/[-\s]+/g, ' ').trim();
    const navnNorm = normStr(body.tournamentNavn);
    for (const m of listHtml.matchAll(/onclick="selectTournament\((\d+)\)"[^>]*>.*?<td>(\d+)<\/td><td>[^<]*<\/td><td>([^<]+)<\/td>/gs)) {
      const rowName = normStr(m[3]);
      if (rowName.includes(navnNorm) || navnNorm.includes(rowName.split(' ').slice(-3).join(' '))) {
        cup2000Id = m[1];
        break;
      }
    }
  }
  return cup2000Id;
}

function parseKampTid(raw) {
  const rawTime = String(raw || '');
  const tp = rawTime.trim().split(/\s+/);
  let timeStr;
  if (tp.length >= 2) {
    const p0 = tp[0], p1 = tp[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(p0)) {
      // ISO "YYYY-MM-DD HH:MM" → "DD-MM HH:MM"
      const dp2 = p0.split('-');
      timeStr = dp2[2] + '-' + dp2[1] + ' ' + p1.substring(0, 5);
    } else if (/^\d{2}:\d{2}/.test(p0)) {
      // "HH:MM DD-MM-YYYY" eller "HH:MM DD-MM" → "DD-MM HH:MM"
      timeStr = p1.substring(0, 5) + ' ' + p0.substring(0, 5);
    } else {
      timeStr = p0.substring(0, 5) + ' ' + p1.substring(0, 5);
    }
  } else {
    timeStr = tp[0] || '';
  }
  return timeStr;
}

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // Feilsøking fra mobil: viser utdrag av cup2000-sidens JavaScript som handler om cookies/spillested,
  // så vi kan se hvordan siden velger spillested. GET /cup2000js?id=11080
  if (path === '/cup2000js') {
    const id = (url.searchParams.get('id') || '').replace(/\D/g, '');
    if (!id) return new Response('Mangler ?id=', { status: 400, headers: CORS });
    const UA = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };
    const side = await fetch(`https://www.cup2000.dk/turnerings-system/Vis-turneringer/?tournamentid=${id}&o=1`, { headers: UA });
    const html = await side.text();
    const ut = [];
    const cookies = typeof side.headers.getSetCookie === 'function' ? side.headers.getSetCookie() : [side.headers.get('set-cookie') || ''];
    ut.push('== Set-Cookie fra siden: ' + cookies.map(c => c.split(';')[0].split('=')[0]).join(', '));
    const kilder = [{ navn: 'side', tekst: html }];
    const srcer = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1])
      .filter(src => !/jquery|bootstrap|signalr|google|gtag|analytics|cookiebot|facebook/i.test(src)).slice(0, 8);
    ut.push('== Skript: ' + srcer.join(' , '));
    await Promise.all(srcer.map(async src => {
      try {
        const abs = new URL(src, 'https://www.cup2000.dk/turnerings-system/Vis-turneringer/').toString();
        kilder.push({ navn: abs.replace('https://www.cup2000.dk', ''), tekst: await (await fetch(abs, { headers: UA })).text() });
      } catch (e) { ut.push('!! kunne ikke hente ' + src); }
    }));
    // ?s=ord1|ord2 søker etter egne ord (bare bokstaver/tall/_), f.eks. ?s=period|venue|date
    const sok = (url.searchParams.get('s') || '').split('|').map(x => x.replace(/[^\w]/g, '')).filter(Boolean);
    const monster = sok.length ? new RegExp(sok.join('|'), 'gi')
      : /document\.cookie|setCookie|getCookie|\$\.cookie|localStorage|sessionStorage|SearchTournamentsService|[?&](p|pl|place|sted|l|loc)=|selectPlace|Place|spillested|onchange/gi;
    const maks = sok.length ? 60 : 25, foer = sok.length ? 200 : 120, etter = sok.length ? 260 : 160;
    for (const k of kilder) {
      const funn = [];
      let m;
      monster.lastIndex = 0;
      while ((m = monster.exec(k.tekst)) !== null && funn.length < maks) {
        const fra = Math.max(0, m.index - foer), til = Math.min(k.tekst.length, m.index + etter);
        if (funn.length && fra < funn[funn.length - 1].til) { funn[funn.length - 1].til = til; continue; }
        funn.push({ fra, til });
      }
      if (!funn.length) continue;
      ut.push('\n== ' + k.navn + ' (' + k.tekst.length + ' tegn)');
      funn.forEach(f => ut.push('… ' + k.tekst.slice(f.fra, f.til).replace(/\s+/g, ' ') + ' …'));
    }
    return new Response(ut.join('\n').slice(0, 30000), { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  if (path === '/debug') {
    const ctx2 = await getCtx();
    return json({ found: !!ctx2, ctx: ctx2 ? ctx2.substring(0, 20) + '...' : null });
  }

  if (path === '/search') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const ctx = await getCtx();
    if (!ctx) return json({error: 'Ingen session'}, 500);
    const sr = await fetch('https://badmintonportalen.no/SportsResults/Components/WebService1.asmx/SearchPlayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        callbackcontextkey: ctx, selectfunction: 'SP1',
        name: body.navn, clubid: '', playernumber: '', gender: '',
        agegroupid: '', searchteam: false, licenseonly: false,
        agegroupcontext: 0, tournamentdate: ''
      })
    });
    const sdata = await sr.json();
    const shtml = String((sdata.d && (sdata.d.Html || sdata.d.html)) || '');
    // Finn alle player-IDs (samme regex som før — vi vet den virker)
    const hits = [];
    const re2 = /SP1\('(\d+)'/g;
    let m2;
    while ((m2 = re2.exec(shtml)) !== null) hits.push(m2[1]);

    // SP1('id','nr','Navn Navnesen','xx','Klubb','M') — parse direkte fra argumentene
    const players = hits.map(pid => {
      const idx = shtml.indexOf("SP1('" + pid + "'");
      const chunk = shtml.substring(idx, idx + 200);
      const m = chunk.match(/SP1\('[^']*',\s*'[^']*',\s*'([^']+)',\s*'[^']*',\s*'([^']*)'/);
      return { id: pid, navn: m ? m[1] : '', klubb: m ? m[2] : '' };
    });
    if (!players.length) {
      if (env.ANALYTICS) env.ANALYTICS.writeDataPoint({ blobs: [body.navn || '', body.klubb || '', 'not_found'], doubles: [0], indexes: ['search'] });
      return json({error: 'Spiller ikke funnet'}, 404);
    }
    // Hvis bare autocomplete (ingen klubb oppgitt), returner alle treff
    if (body.autocomplete) return json({ players });
    // Velg beste treff basert på klubb
    const klubbLower = (body.klubb || '').toLowerCase();
    let best = players[0];
    if (klubbLower && players.length > 1) {
      const match = players.find(p => p.klubb.toLowerCase().indexOf(klubbLower) !== -1);
      if (match) best = match;
    }
    if (env.ANALYTICS) env.ANALYTICS.writeDataPoint({ blobs: [body.navn || '', body.klubb || '', 'found', best.id], doubles: [players.length], indexes: ['search'] });
    return json({ playerid: best.id, players });
  }

  if (path === '/api') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const TILLATTE_METODER = ['SearchPlayer', 'GetPlayerProfile', 'GetSeasonPlan', 'SearchRegistrationsByClass', 'SearchTournamentResults', 'SearchTournamentMatches'];
    if (!TILLATTE_METODER.includes(body.method)) return json({error: 'Metode ikke tillatt'}, 403);

    // Resultater og tidligere sesongers profiler endrer seg sjelden; nåværende sesongs
    // profil caches ikke, ellers blir rankingen utdatert.
    const naa = new Date();
    const gjeldendeSesong = 2000000 + (naa.getMonth() >= 6 ? naa.getFullYear() : naa.getFullYear() - 1);
    let ttl = 0;
    if (body.method === 'SearchTournamentMatches' || body.method === 'SearchTournamentResults') ttl = 3600;
    if (body.method === 'GetPlayerProfile' && Number(body.data && body.data.seasonid) < gjeldendeSesong) ttl = 7 * 86400;
    const cacheKey = ttl ? new Request('https://cache.goodminton.no/api/' + body.method + '?' + encodeURIComponent(JSON.stringify(body.data))) : null;
    if (cacheKey && !body.fersk) {
      const hit = await caches.default.match(cacheKey);
      if (hit) return json(await hit.json());
    }

    const ctx = await getCtx();
    if (!ctx) return json({error: 'Kunne ikke hente session fra badmintonportalen.no'}, 500);
    body.data.callbackcontextkey = ctx;
    const r = await fetch('https://badmintonportalen.no/SportsResults/Components/WebService1.asmx/' + body.method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body.data)
    });
    const result = await r.json();
    // Tomme svar (f.eks. resultater som ikke er publisert ennå) caches ikke.
    const html = result && result.d && (result.d.Html || result.d.html);
    if (cacheKey && r.ok && html) {
      await caches.default.put(cacheKey, new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + ttl }
      }));
    }
    return json(result);
  }

  if (path === '/app') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    if (body.command !== 18) return json({error: 'Metode ikke tillatt'}, 403);
    const r = await fetch('https://badmintonportalen.no/SportsResults/Services/App.aspx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await r.json();
    return json(result);
  }

  if (path === '/cup2000debug') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    let cup2000Id2 = body.tournamentId || null;
    if (!cup2000Id2 && body.tournamentNavn) {
      const navnNorm2 = body.tournamentNavn.replace(/^[^:]+:\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (navnNorm2) {
        const listHtml2 = await (await fetch('https://www.cup2000.dk/turnerings-system/Vis-turneringer/', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
        for (const m of listHtml2.matchAll(/onclick="selectTournament\((\d+)\)"[^>]*>.*?<td>(\d+)<\/td><td>[^<]*<\/td><td>([^<]+)<\/td>/gs)) {
          const rowName = m[3].toLowerCase().replace(/\s+/g, ' ').trim();
          if (rowName.includes(navnNorm2) || navnNorm2.includes(rowName.split(' ').slice(-3).join(' '))) { cup2000Id2 = m[1]; break; }
        }
      }
    }
    if (!cup2000Id2) return json({ error: 'Turnering ikke funnet' });
    const BASE3 = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx';
    const UA3 = { 'User-Agent': 'Mozilla/5.0' };
    const c2 = String(body.c || '0'), e2 = String(body.e || '0');
    const p2 = body.p !== undefined ? '&p=' + body.p : '';
    const g2 = body.g !== undefined ? '&g=' + body.g : '';
    const e2param = body.e !== undefined ? '&e=' + e2 : '';
    const raw2 = await (await fetch(BASE3 + '?tournamentid=' + cup2000Id2 + '&c=' + c2 + e2param + p2 + g2, { headers: UA3 })).text();
    return json({ cup2000Id: cup2000Id2, raw: raw2.substring(0, 3000) });
  }

  if (path === '/cup2000') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }

    // Steg 1: Finn cup2000 tournamentId — prøv URL først, deretter navnematching
    const cup2000Id = await finnCup2000Id(body);
    if (!cup2000Id) return json({ kamper: [] });

    const BASE = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx';
    const UA = { 'User-Agent': 'Mozilla/5.0' };

    const DISC_MAP = [
      ['herresingle', 'HS'], ['damesingle', 'DS'],
      ['herredouble', 'HD'], ['damedouble', 'DD'],
      ['mixed', 'MD']
    ];
    function discCode(name) {
      const n = name.toLowerCase();
      for (const [k, v] of DISC_MAP) if (n.includes(k)) return v;
      return '';
    }
    function decEnt(s) {
      return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    }

    // Bruk hele navnet for matching (ikke bare etternavn) for å unngå falske treff
    const navnFull = (body.navn || '').toLowerCase();
    const navnLower = navnFull;
    const klubbLower = (body.klubb || '').toLowerCase();

    // Steg 2: Hent klasse-navigasjon for å finne alle c/e-kombinasjoner
    const navJson = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=0`, { headers: UA })).json();
    const classes = [];

    if (typeof navJson.data === 'string') {
      // renderMethod 1: HTML med klasse-lenker
      for (const row of navJson.data.matchAll(/<tr[^>]*><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/gs)) {
        const ag = row[1].replace(/&nbsp;/g, '').trim();
        if (!ag || ag === 'Klasser') continue;
        for (const lm of row[2].matchAll(/c=(\d+)&(?:amp;)?e=(\d+)"[^>]*>([^<]+)<\/a>/g)) {
          classes.push({ c: lm[1], e: lm[2], disc: lm[3].trim(), ageGroup: ag });
        }
      }
    }

    if (!classes.length) {
      // Fallback: hent klasse-lenker fra HTML-siden (fungerer uavhengig av renderMethod)
      const pageHtml = await (await fetch(`https://www.cup2000.dk/turnerings-system/Vis-turneringer/?tournamentid=${cup2000Id}`, { headers: UA })).text();
      for (const lm of pageHtml.matchAll(/c=(\d+)&(?:amp;)?e=(\d+)"[^>]*>([^<]{2,40})<\/a>/g)) {
        const c = lm[1], e = lm[2], disc = lm[3].trim();
        if (!classes.some(x => x.c === c && x.e === e) && /single|double|mixed/i.test(disc)) {
          classes.push({ c, e, disc, ageGroup: '' });
        }
      }
    }

    // renderMethod=2 fra Cloudflare: cup2000.dk returnerer én klasse per c/e-kall.
    // Skan sekvensielt per c (e=0..4 parallelt per c) for å holde oss innenfor
    // Cloudflare free plans grense på 50 subrequests per request (det kommer flere
    // kall per klasse etterpå). Klassene ligger sammenhengende, men trenger ikke
    // starte på c=0 — derfor avbrytes først på en tom rad ETTER at noe er funnet.
    // Hardt tak på 35 kall totalt i skanningen.
    if (!classes.length && navJson.renderMethod === 2) {
      const MAKS_SKANN_KALL = 35;
      let skannKall = 0;
      for (let sc = 0; sc <= 14 && skannKall < MAKS_SKANN_KALL; sc++) {
        const ePairs = [];
        for (let se = 0; se <= 4; se++) ePairs.push(se);
        const gjenstaende = MAKS_SKANN_KALL - skannKall;
        const radePairs = ePairs.slice(0, gjenstaende);
        if (!radePairs.length) break;
        skannKall += radePairs.length;
        const c = String(sc);
        const scanResults = await Promise.all(radePairs.map(async (se) => {
          const e = String(se);
          try {
            const d = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}`, { headers: UA })).json();
            if (d.renderMethod === 2 && Array.isArray(d.data) && d.data[0] && d.data[0][2]) {
              return { c, e, disc: decEnt(String(d.data[0][2])), ageGroup: '' };
            }
          } catch {}
          return null;
        }));
        const funnet = scanResults.filter(Boolean);
        funnet.forEach(r => {
          if (!classes.some(x => x.c === r.c && x.e === r.e)) classes.push(r);
        });
        if (!funnet.length && classes.length) break;
      }
    }

    if (!classes.length) return json({ kamper: [] });

    // Steg 3: Per klasse — finn spillerens puljer, hent kamper per pulje
    const fetchClass = async ({ c, e, disc, ageGroup }) => {
      const d = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}`, { headers: UA })).json();
      if (!Array.isArray(d.data)) return { kamper: [], grupper: [] };
      const dc = discCode(disc);

      // renderMethod=3: klassen har kun én pulje — cup2000 returnerer puljedata direkte
      // (data[0] = tittelstring med "Pulje"). Behandle som vanlig puljedata.
      if (d.renderMethod === 3 && typeof d.data[0] === 'string') {
        const kamper = [];
        const grupper = [];
        const spillerMap = {};
        for (const s of (d.data[1] || [])) {
          const idx = s[0];
          const navnArr = Array.isArray(s[5]) ? s[5].map(n => decEnt(String(n))) : [];
          spillerMap[idx] = navnArr.map(n => ({ navn: n.split(',')[0].trim(), klubb: (n.split(',')[1] || '').trim() }));
        }
        const matchNavn3 = (navn) => {
          const n = navn.toLowerCase();
          const parts = navnFull.split(' ').filter(Boolean);
          return parts.length >= 2 ? n.includes(parts[0]) && n.includes(parts[parts.length - 1]) : n.includes(navnFull);
        };
        const erMeg = Object.values(spillerMap).some(arr => arr.some(s => matchNavn3(s.navn)));
        if (!erMeg) return { kamper: [], grupper: [] };
        const rounds3 = Array.isArray(d.data[2]) && Array.isArray(d.data[2][0]) ? d.data[2][0] : [];
        for (const match of rounds3) {
          if (!Array.isArray(match)) continue;
          const p1idx = match[8], p2idx = match[9];
          const sp1list = spillerMap[p1idx] || [];
          const sp2list = spillerMap[p2idx] || [];
          const isSp1 = sp1list.some(s => matchNavn3(s.navn));
          const isSp2 = sp2list.some(s => matchNavn3(s.navn));
          if (!isSp1 && !isSp2) continue;
          const motSpillere = isSp1 ? sp2list : sp1list;
          const mot = motSpillere.map(s => s.navn).join(' / ');
          const motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');
          const timeStr = parseKampTid(match[2]);
          const bane = String(match[0] || '');
          const scoreStr = String(match[3] || '').trim();
          const vinner = match[5];
          let res = '';
          if (scoreStr) res = scoreStr.split(/\s+/).map(s => { const pts = s.split('/'); return pts.length === 2 ? (isSp1 ? `${pts[0]}-${pts[1]}` : `${pts[1]}-${pts[0]}`) : s; }).join(', ');
          const vant = vinner ? (isSp1 ? vinner === 1 : vinner === 2) : null;
          kamper.push({ tid: timeStr, bane, disc: dc, mot, motKlubb, motSpillere, ageGroup, res, vant });
        }
        // Standings
        const navnParts = navnFull.split(' ').filter(Boolean);
        const spillereListe = (d.data[1] || []).map(s => {
          const navnArr = Array.isArray(s[5]) ? s[5].map(n => decEnt(String(n))) : [];
          const navn = navnArr.map(n => n.split(',')[0].trim()).join(' / ');
          const klubb = navnArr.map(n => (n.split(',')[1] || '').trim()).filter(Boolean)[0] || '';
          const erMegS = navnArr.some(n => navnParts.every(p => n.toLowerCase().includes(p)));
          return { pos: String(s[4] || ''), navn, klubb, kV: s[7] || 0, kT: s[8] || 0, sV: s[9] || 0, sT: s[10] || 0, erMeg: erMegS };
        });
        if (spillereListe.length) grupper.push({ disc: dc, ageGroup, spillere: spillereListe });
        return { kamper, grupper };
      }

      // Sjekk om dette er direkte sluttspill-struktur (data[0] er string = tittel, ikke pulje)
      if (typeof d.data[0] === 'string') {
        // Direkte sluttspill: behandle d.data som spJson.data
        const kamper = [];
        const matchNavn2 = (navn) => {
          const n = navn.toLowerCase();
          const parts = navnFull.split(' ').filter(Boolean);
          return parts.length >= 2
            ? n.includes(parts[0]) && n.includes(parts[parts.length - 1])
            : n.includes(navnFull);
        };
        const seedMap2 = {};
        for (const s of (d.data[1] || [])) {
          if (!Array.isArray(s)) continue;
          const idx = s[0];
          const navnArr = Array.isArray(s[3]) ? s[3].map(n => decEnt(String(n))) : [];
          if (navnArr.length) seedMap2[idx] = navnArr.map(n => ({ navn: n.split(',')[0].trim(), klubb: (n.split(',')[1] || '').trim() }));
        }
        const runder2 = Array.isArray(d.data[2]) ? d.data[2] : [];

        // Bygg kart: kampNr → { sp1: [...], sp2: [...] } for oppslag av "Vinder af kamp X"
        const kampNrMap = {};
        for (const runde of runder2) {
          if (!Array.isArray(runde) || !Array.isArray(runde[1])) continue;
          const kl = Array.isArray(runde[1][0]) ? runde[1][0] : runde[1];
          for (const m of kl) {
            if (!Array.isArray(m)) continue;
            kampNrMap[String(m[0])] = { sp1: seedMap2[m[8]] || [], sp2: seedMap2[m[9]] || [] };
          }
        }

        for (const runde of runder2) {
          if (!Array.isArray(runde) || !Array.isArray(runde[1])) continue;
          const kampliste = Array.isArray(runde[1][0]) ? runde[1][0] : runde[1];
          for (const match of kampliste) {
            if (!Array.isArray(match)) continue;

            // Løs opp "Vinder af kamp X" — idx === -1 betyr ukjent spiller
            const resolveSpiller = (idx, navnTekstArr) => {
              if (idx !== -1) return seedMap2[idx] || [];
              // Finn kamp-nr fra tekst som "Vinder af kamp 62"
              const tekst = Array.isArray(navnTekstArr) ? (navnTekstArr[0] || '') : '';
              const km = String(tekst).match(/kamp\s+(\d+)/i);
              if (!km) return [];
              const ref = kampNrMap[km[1]];
              if (!ref) return [];
              // Returner begge spillere fra den refererte kampen
              return [...ref.sp1, ...ref.sp2];
            };

            const spiller1 = resolveSpiller(match[8], match[6]);
            const spiller2 = resolveSpiller(match[9], match[7]);
            const isSp1 = spiller1.some(s => matchNavn2(s.navn));
            const isSp2 = spiller2.some(s => matchNavn2(s.navn));
            if (!isSp1 && !isSp2) continue;
            const motSpillere = isSp1 ? spiller2 : spiller1;
            // Bygg motstander-tekst: ved ukjent, bruk "Vinder av kamp X" basert på ref-kampens spillere
            const motIdx = isSp1 ? match[9] : match[8];
            const erUkjentMot = motIdx === -1;
            const motNavnTekst = isSp1 ? match[7] : match[6];
            let mot, motKlubb;
            if (erUkjentMot && motSpillere.length > 0) {
              // Vis hvem som kan bli motstander (begge lag i ref-kampen)
              const tekst = Array.isArray(motNavnTekst) ? (motNavnTekst[0] || '') : String(motNavnTekst || '');
              const km2 = tekst.match(/kamp\s+(\d+)/i);
              if (km2) {
                const ref2 = kampNrMap[km2[1]];
                if (ref2 && ref2.sp1.length && ref2.sp2.length) {
                  const lag1 = ref2.sp1.map(s => s.navn).join('/');
                  const lag2 = ref2.sp2.map(s => s.navn).join('/');
                  mot = 'Vinner av ' + lag1 + ' vs ' + lag2;
                  motKlubb = '';
                } else {
                  mot = motSpillere.map(s => s.navn).join(' / ');
                  motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');
                }
              } else {
                mot = motSpillere.map(s => s.navn).join(' / ');
                motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');
              }
            } else {
              mot = motSpillere.map(s => s.navn).join(' / ');
              motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');
            }
            const timeStr = parseKampTid(match[2]);
            const bane = String(match[0] || '');
            const scoreStr = String(match[3] || '').trim();
            const vinner = match[5];
            let res = '';
            if (scoreStr) {
              res = scoreStr.split(/\s+/).map(s => {
                const pts = s.split('/');
                return pts.length === 2 ? (isSp1 ? `${pts[0]}-${pts[1]}` : `${pts[1]}-${pts[0]}`) : s;
              }).join(', ');
            }
            const vant = vinner ? (isSp1 ? vinner === 1 : vinner === 2) : null;
            kamper.push({ tid: timeStr, bane, disc: dc, mot, motKlubb, motSpillere, ageGroup, res, vant, sluttspill: true });
          }
        }
        return { kamper, grupper: [] };
      }

      const puljer = d.data[0] && Array.isArray(d.data[0][3]) ? d.data[0][3] : [];

      // Finn puljer der spilleren er med
      const minePuljer = [];
      for (const pulje of puljer) {
        const puljeId = pulje[0];
        const spillere = Array.isArray(pulje[1]) ? pulje[1] : [];
        // Pulje-spillere: s = [0, ["Navn, Klubb"]] (enkelt) eller [0, ["Sp1, Klubb", "Sp2, Klubb"]] (double)
        const harSpiller = spillere.some(s => {
          const navnArr = Array.isArray(s[1]) ? s[1] : [];
          return navnArr.some(n => {
            const entry = decEnt(String(n)).toLowerCase();
            const parts = navnFull.split(' ').filter(Boolean);
            return parts.length >= 2
              ? entry.includes(parts[0]) && entry.includes(parts[parts.length - 1])
              : entry.includes(navnFull);
          });
        });
        if (harSpiller) minePuljer.push(puljeId);
      }

      const matchNavn = (navn) => {
        const n = navn.toLowerCase();
        const parts = navnFull.split(' ').filter(Boolean);
        return parts.length >= 2
          ? n.includes(parts[0]) && n.includes(parts[parts.length - 1])
          : n.includes(navnFull);
      };

      // Spiller er ikke i denne klassen — hopp over (unngår unødvendige subrequests)
      if (minePuljer.length === 0) return { kamper: [], grupper: [] };

      // Hent kamper og gruppestandings for hver pulje
      const kamper = [];
      const grupper = [];
      for (const puljeId of minePuljer) {
        let pd;
        try { pd = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}&p=0&g=${puljeId}`, { headers: UA })).json(); }
        catch(e) { continue; }
        if (!Array.isArray(pd.data) || pd.data.length < 3) continue;

        // pd.data[1] = standings: [playerIdx, ?, ?, ?, "pos", ["Navn, Klubb"], played, kV, kT, sV, sT, pV, pT, pts]
        // Bygg spillerMap fra standings for motstanderoppslag i kamper
        const spillerMap = {};
        for (const s of (pd.data[1] || [])) {
          const idx = s[0];
          const navnArr = Array.isArray(s[5]) ? s[5].map(n => decEnt(String(n))) : [];
          spillerMap[idx] = navnArr.map(n => ({
            navn: n.split(',')[0].trim(),
            klubb: (n.split(',')[1] || '').trim()
          }));
        }

        // pd.data[2][0] = kamparray: [bane, ?, tid, scoreStr, ?, ?, [], [], p1idx, p2idx, ?, ...]
        // scoreStr = "4/21 6/21" (mellomrom-separerte sett, slash mellom p1/p2)
        const rounds = Array.isArray(pd.data[2]) && Array.isArray(pd.data[2][0]) ? pd.data[2][0] : [];
        for (const match of rounds) {
          if (!Array.isArray(match)) continue;
          const p1idx = match[8], p2idx = match[9];
          const sp1list = spillerMap[p1idx] || [];
          const sp2list = spillerMap[p2idx] || [];
          const isSp1 = sp1list.some(s => matchNavn(s.navn));
          const isSp2 = sp2list.some(s => matchNavn(s.navn));
          if (!isSp1 && !isSp2) continue;

          const motSpillere = isSp1 ? sp2list : sp1list;
          const mot = motSpillere.map(s => s.navn).join(' / ');
          const motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');

          // Tidsformat: "HH:MM DD-MM-YYYY" → "DD-MM HH:MM"
          const timeStr = parseKampTid(match[2]);
          const bane = String(match[0] || '');

          // Resultat: match[3] = scoreStr "4/21 6/21"
          const scoreStr = String(match[3] || '').trim();
          const vinner = match[5]; // 1=sp1 vant, 2=sp2 vant
          let res = '';
          if (scoreStr) {
            res = scoreStr.split(/\s+/).map(s => {
              const pts = s.split('/');
              if (pts.length === 2) return isSp1 ? `${pts[0]}-${pts[1]}` : `${pts[1]}-${pts[0]}`;
              return s;
            }).join(', ');
          }
          const vant = vinner ? (isSp1 ? vinner === 1 : vinner === 2) : null;

          kamper.push({ tid: timeStr, bane, disc: dc, mot, motKlubb, motSpillere, ageGroup, res, vant });
        }

        // Standings direkte fra pd.data[1]: [idx, ?, ?, ?, "pos", ["Navn, Klubb"], played, kV, kT, sV, sT, ...]
        const navnParts = navnFull.split(' ').filter(Boolean);
        const spillereListe = (pd.data[1] || []).map(s => {
          // s[5] kan ha flere navn for doubles/mix: ["Sp1, Klubb", "Sp2, Klubb"]
          const navnArr = Array.isArray(s[5]) ? s[5].map(n => decEnt(String(n))) : [];
          const navn = navnArr.map(n => n.split(',')[0].trim()).join(' / ');
          const klubbArr = [...new Set(navnArr.map(n => (n.split(',')[1] || '').trim()).filter(Boolean))];
          const klubb = klubbArr.join(' / ');
          const erMeg = navnArr.some(n => navnParts.length >= 2
            ? n.toLowerCase().includes(navnParts[0].toLowerCase()) && n.toLowerCase().includes(navnParts[navnParts.length - 1].toLowerCase())
            : n.toLowerCase().includes(navnFull.toLowerCase()));
          return { pos: parseInt(s[4]) || 0, navn, klubb, kV: s[7] || 0, kT: s[8] || 0, sV: s[9] || 0, sT: s[10] || 0, erMeg };
        }).sort((a, b) => a.pos - b.pos);
        if (spillereListe.length > 0) grupper.push({ disc: dc, ageGroup, spillere: spillereListe });
      }

      // Sluttspill (knockout): hent p=1, p=2, p=3, ... til ingen data
      // Struktur: data[0]=tittel, data[1]=[[idx,?,pos,[navn]],...], data[2]=[[rundeId,[kamper]],...]
      // Kamp: [bane, ?, "HH:MM DD-MM-YYYY", scoreStr, ?, vinner(1/2), [], [], sp1idx, sp2idx, ...]
      try {
        for (let pNum = 1; pNum <= 10; pNum++) {
          const spJson = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}&p=${pNum}`, { headers: UA })).json();
          if (!Array.isArray(spJson.data) || spJson.data.length < 3 || typeof spJson.data[0] !== 'string') break;

          // Bygg seedMap fra data[1]: [idx, ?, pos, ["Navn, Klubb"]]
          const seedMap = {};
          for (const s of (spJson.data[1] || [])) {
            if (!Array.isArray(s)) continue;
            const idx = s[0];
            const navnArr = Array.isArray(s[3]) ? s[3].map(n => decEnt(String(n))) : [];
            if (navnArr.length) seedMap[idx] = navnArr.map(n => ({ navn: n.split(',')[0].trim(), klubb: (n.split(',')[1] || '').trim() }));
          }

          // data[2] = [[rundeId, [[kamp1,kamp2,...], null]], ...]
          const runder = Array.isArray(spJson.data[2]) ? spJson.data[2] : [];
          for (const runde of runder) {
            if (!Array.isArray(runde) || !Array.isArray(runde[1])) continue;
            const kampliste = Array.isArray(runde[1][0]) ? runde[1][0] : runde[1];
            for (const match of kampliste) {
              if (!Array.isArray(match)) continue;
              const spiller1 = seedMap[match[8]] || [];
              const spiller2 = seedMap[match[9]] || [];
              const isSp1 = spiller1.some(s => matchNavn(s.navn));
              const isSp2 = spiller2.some(s => matchNavn(s.navn));
              if (!isSp1 && !isSp2) continue;

              const motSpillere = isSp1 ? spiller2 : spiller1;
              if (!motSpillere.length || !motSpillere[0].navn) continue;
              const mot = motSpillere.map(s => s.navn).join(' / ');
              const motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');

              // Tid: "HH:MM DD-MM-YYYY"
              const timeStr = parseKampTid(match[2]);
              const bane = String(match[0] || '');

              // Score: "21/9 21/18" — vinner er match[5]: 1=sp1, 2=sp2
              const scoreStr = String(match[3] || '').trim();
              const vinner = match[5]; // 1=sp1 vant, 2=sp2 vant
              let res = '';
              if (scoreStr) {
                res = scoreStr.split(/\s+/).map(s => {
                  const pts = s.split('/');
                  if (pts.length === 2) return isSp1 ? `${pts[0]}-${pts[1]}` : `${pts[1]}-${pts[0]}`;
                  return s;
                }).join(', ');
              }
              const vant = vinner ? (isSp1 ? vinner === 1 : vinner === 2) : null;

              kamper.push({ tid: timeStr, bane, disc: dc, mot, motKlubb, motSpillere, ageGroup, res, vant, sluttspill: true });
            }
          }
        }
      } catch(e) { /* sluttspill ikke tilgjengelig */ }

      return { kamper, grupper };
    };

    const allResults = await Promise.all(classes.map(c => fetchClass(c).catch(() => ({ kamper: [], grupper: [] }))));
    const kamper = allResults.flatMap(r => r.kamper).sort((a, b) => (a.tid || '').localeCompare(b.tid || ''));
    const grupper = allResults.flatMap(r => r.grupper);
    return json({ kamper, grupper });
  }

  if (path === '/cup2000live') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }

    // En turnering kan være delt på flere cup2000-turneringer (f.eks. én per hall). Appen sender ID-ene
    // den fant i klassenes cup2000-lenker hos badmintonportalen; uten dem brukes navneoppslag.
    let ider = Array.isArray(body.cup2000Ider) ? body.cup2000Ider.map(String).filter(x => /^\d+$/.test(x)) : [];
    ider = [...new Set(ider)].slice(0, 4);
    if (!ider.length) { const id = await finnCup2000Id(body); if (id) ider = [id]; }
    if (!ider.length) return json({ kamper: [], resultater: [], kilder: [], ikkeFunnet: true });

    // Hele svaret caches i 15 s, så flere som ser på samme turnering deler det. ↻ i appen sender fersk: true.
    const liveCacheKey = new Request('https://cache.goodminton.no/live?' + encodeURIComponent(JSON.stringify([ider, body.navn || ''])));
    if (!body.fersk) {
      const hit = await caches.default.match(liveCacheKey);
      if (hit) return json(await hit.json());
    }

    const BASE2 = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx';
    const UA2 = { 'User-Agent': 'Mozilla/5.0' };

    // Hallnavn = cup2000-navnet minus ordene som er felles for alle, f.eks. "BSI-Smashen 2026 (Fana)" → "Fana".
    const hallNavn = {};
    if (ider.length > 1) {
      const navn = {};
      try {
        const listHtml = await (await fetch('https://www.cup2000.dk/turnerings-system/Vis-turneringer/', { headers: UA2 })).text();
        for (const m of listHtml.matchAll(/onclick="selectTournament\((\d+)\)"[^>]*>.*?<td>(\d+)<\/td><td>[^<]*<\/td><td>([^<]+)<\/td>/gs)) {
          navn[m[1]] = m[3].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();
        }
      } catch (e) { /* uten liste blir det "Hall 1", "Hall 2" */ }
      const ord = ider.map(id => (navn[id] || '').split(/\s+/).filter(Boolean));
      let felles = 0;
      if (ord.every(o => o.length)) while (ord.every(o => o[felles] !== undefined && o[felles] === ord[0][felles])) felles++;
      ider.forEach((id, i) => {
        const rest = ord[i].slice(felles).join(' ').replace(/^[\s\-–:,(]+|[\s)]+$/g, '');
        hallNavn[id] = rest || ('Hall ' + (i + 1));
      });
    }

    // To kilder: o=1 = "Kampe i gang" (pågående, har banenummer), w=1 = "Næste kampe" (kø, uten bane).
    // En kamp som nettopp er satt i gang ligger i begge, så o=1 har forrang ved dedupe på kampnr.
    // lr=1 = "Seneste resultater", nyeste først.
    // Kampene ligger normalt i data[3] som én liste per spillested/hall, men formen varierer (flat liste,
    // flere haller, flere dager). Let derfor rekursivt etter alt som ser ut som en kamp: tid i [2] og
    // spillerlister i [6]/[7]. Gruppe = indeks øverst i data[3] (≈ hall). Svar: { kamper, struktur }, null ved feil.
    const erKamp = x => Array.isArray(x) && x.length >= 8 && !Array.isArray(x[0])
      && Array.isArray(x[6]) && Array.isArray(x[7]) && /\d{1,2}[:.]\d{2}/.test(String(x[2] || ''));
    const finnKamper = (node, gruppe, ut, dybde) => {
      if (!Array.isArray(node) || dybde > 8) return;
      if (erKamp(node)) { ut.push({ gruppe, match: node }); return; }
      node.forEach((barn, i) => finnKamper(barn, dybde === 0 ? i : gruppe, ut, dybde + 1));
    };
    const beskriv = d => Array.isArray(d)
      ? '[' + d.map(x => Array.isArray(x) ? 'a' + x.length : x === null ? 'n' : typeof x === 'string' ? 's' : typeof x[0] || typeof x).join(',') + ']'
      : typeof d;
    // Turneringer med flere spillesteder (f.eks. «lørdag», «søndag før 14», «søndag etter 14»): cup2000
    // husker valgt spillested i sesjonen. Uten cookie får vi ingenting (o=1) eller første spillested
    // (lr=1 = gårsdagens resultater). Åpne derfor turneringssiden først, som en nettleser, og bruk cookien.
    const hentSesjon = async (id) => {
      try {
        const r = await fetch(`https://www.cup2000.dk/turnerings-system/Vis-turneringer/?tournamentid=${id}`, { headers: UA2 });
        await r.arrayBuffer();
        const raa = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie()
          : (r.headers.get('set-cookie') || '').split(/,(?=\s*[^;,\s]+=)/);
        return raa.map(c => c.split(';')[0].trim()).filter(c => c.includes('=')).join('; ');
      } catch (e) { return ''; }
    };
    const dekod = t => String(t || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
    // extra = f.eks. "&l=1" for å velge spillested. Svar: { kamper, stedIdx, steder, valgt, struktur } eller null.
    const hentLive = async (id, q, cookie, extra = '') => {
      try {
        const r = await fetch(`${BASE2}?tournamentid=${id}&${q}${extra}`, { headers: cookie ? { ...UA2, Cookie: cookie } : UA2 });
        const j = await r.json();
        const data = Array.isArray(j.data) ? j.data : [];
        // data[6] = alle spillesteder [[indeks, navn], ...]; data[5] = indeks for valgt spillested.
        // (data[3][1] = [[1, navn]] har navnet, men tallet der er ikke spillestedsindeksen.)
        const steder = Array.isArray(data[6]) ? data[6].filter(x => Array.isArray(x) && typeof x[1] === 'string').map(x => [x[0], dekod(x[1])]) : [];
        // data[8] = datoer [["20262709", "27-09-2026"], ...] (verdi til parameteren dt)
        const datoer = Array.isArray(data[8]) ? data[8].filter(x => Array.isArray(x) && x.length >= 2).map(x => [String(x[0]), String(x[1])]) : [];
        const d31 = Array.isArray(data[3]) && Array.isArray(data[3][1]) && Array.isArray(data[3][1][0]) ? dekod(data[3][1][0][1]) : '';
        const stedIdx = typeof data[5] === 'number' && steder.some(x => x[0] === data[5]) ? data[5] : null;
        const valgt = stedIdx !== null ? steder.find(x => x[0] === stedIdx)[1] : d31;
        const kamper = [];
        if (Array.isArray(data[3])) {
          const d3 = data[3];
          if (erKamp(d3[0])) finnKamper([d3], 0, kamper, 0); else finnKamper(d3, 0, kamper, 0);
        }
        if (!kamper.length) finnKamper(data, 0, kamper, 1);
        return { kamper, stedIdx, valgt, steder, datoer,
          struktur: 'rm' + j.renderMethod + ' data' + beskriv(data) + (Array.isArray(data[3]) ? ' d3' + beskriv(data[3]) : '') };
      } catch (e) { return null; }
    };

    // Fra cup2000s SearchTournaments.js (RenderVenueMatches): data[5]/[6] = valgt/alle spillesteder (parameter vi),
    // data[7]/[8] = valgt/alle datoer (parameter dt), data[1]/[2] = periode (parameter pi, -1 = alle).
    // Nettleseren velger spillested og dato selv; uten dem gir tjenesten første spillested (f.eks. gårsdagens).
    const osloDag = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
    const idagFull = String(osloDag.getDate()).padStart(2, '0') + '-' + String(osloDag.getMonth() + 1).padStart(2, '0') + '-' + osloDag.getFullYear();

    // Per ID: finn oppsett (sesjon, spillesteder, dagens dato) – fra minnet hvis ferskt, ellers sesjon + standardvisning.
    // Har turneringen flere spillesteder, hentes hvert med &vi=…&dt=… (én runde når oppsettet er kjent).
    const sesjoner = {};
    const enheter = [];  // { id, idIdx, sted, res: [o, w, lr] }
    const stedInfo = {}; // id -> { steder, dato, standard }
    await Promise.all(ider.map(async (id, i) => {
      let opp = LIVE_OPPSETT.get(id);
      if (opp && (Date.now() - opp.tid > 10 * 60 * 1000 || opp.dag !== idagFull)) opp = null;
      let std = null;
      if (!opp) {
        const cookie = await hentSesjon(id);
        std = await Promise.all(['o=1', 'w=1', 'lr=1'].map(q => hentLive(id, q, cookie)));
        const steder = (std.find(x => x && x.steder.length) || { steder: [] }).steder;
        const datoer = (std.find(x => x && x.datoer.length) || { datoer: [] }).datoer;
        const idag = datoer.find(d => d[1] === idagFull);
        opp = { tid: Date.now(), dag: idagFull, cookie, steder, dt: idag ? '&dt=' + encodeURIComponent(idag[0]) : '',
          dato: idag ? idag[1] : '', standard: (std.find(x => x && x.valgt) || {}).valgt || '' };
        if (std.some(x => x)) LIVE_OPPSETT.set(id, opp);
      }
      sesjoner[id] = opp.cookie;
      stedInfo[id] = { steder: opp.steder, dato: opp.dato, standard: opp.standard };
      const steder = opp.steder;
      if (steder.length < 2) {
        if (!std) std = await Promise.all(['o=1', 'w=1', 'lr=1'].map(q => hentLive(id, q, opp.cookie)));
        enheter.push({ id, idIdx: i, sted: '', res: std });
        return;
      }
      const perSted = await Promise.all(steder.map(([idx]) =>
        Promise.all(['o=1', 'w=1', 'lr=1'].map(q => hentLive(id, q, opp.cookie, `&vi=${idx}${opp.dt}&pi=-1`)))));
      steder.forEach(([, navn], si) => enheter.push({ id, idIdx: i, sted: navn.replace(/\s*\(.*\)\s*$/, ''), res: perSted[si] }));
    }));
    enheter.sort((a, b) => a.idIdx - b.idIdx);

    const DISC_MAP2 = [['herresingle','HS'],['damesingle','DS'],['herredouble','HD'],['damedouble','DD'],['mixed','MD']];
    function discCode2(name) { const n = name.toLowerCase(); for (const [k,v] of DISC_MAP2) if (n.includes(k)) return v; return ''; }
    function decEnt2(s) { return s.replace(/&#(\d+);/g, (_,n) => String.fromCharCode(Number(n))); }

    const navnDeler = (body.navn || '').toLowerCase().split(' ').filter(Boolean);
    const osloNaa = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
    const idagOslo = String(osloNaa.getDate()).padStart(2, '0') + '-' + String(osloNaa.getMonth() + 1).padStart(2, '0');

    // match[0] er kampnummer (ikke bane). Ekte bane står kun i match[3] for kamper i gang.
    function parseKamp(match) {
      const sp1raw = Array.isArray(match[6]) ? match[6] : [];
      const sp2raw = Array.isArray(match[7]) ? match[7] : [];
      const spiller1 = sp1raw.map(n => { const dn = decEnt2(String(n)); return { navn: dn.split(',')[0].trim(), klubb: (dn.split(',')[1]||'').trim() }; });
      const spiller2 = sp2raw.map(n => { const dn = decEnt2(String(n)); return { navn: dn.split(',')[0].trim(), klubb: (dn.split(',')[1]||'').trim() }; });
      const allNames = [...spiller1, ...spiller2].map(s => s.navn.toLowerCase());
      const mine = navnDeler.length >= 2
        ? allNames.some(n => navnDeler.every(del => n.includes(del)))
        : allNames.some(n => n.includes(navnDeler[0] || ''));
      const discFull = decEnt2(String(match[4] || ''));
      const ageGroupM = discFull.match(/U\d+|Senior|Junior/i);
      // Tid: "HH:MM DD-MM-YYYY" → "DD-MM HH:MM"
      const raaTid = String(match[2] || '').trim();
      const klM = raaTid.match(/(\d{1,2})[:.](\d{2})/);
      const datoM = raaTid.match(/(\d{1,2})-(\d{1,2})(?:-\d{2,4})?/);
      const kl = klM ? klM[1].padStart(2, '0') + ':' + klM[2] : '';
      const dato = datoM ? datoM[1].padStart(2, '0') + '-' + datoM[2].padStart(2, '0') : idagOslo;
      const tid = kl ? dato + ' ' + kl : raaTid;
      return {
        kampnr: String(match[0] || ''),
        tid,
        disc: discCode2(discFull),
        discFull,
        ageGroup: ageGroupM ? ageGroupM[0].toUpperCase() : '',
        spiller1, spiller2, mine
      };
    }

    const kamper2 = [];
    const resultater = [];

    const kilder = [];

    const seddePerId = {};
    ider.forEach(id => { seddePerId[id] = { live: new Set(), res: new Set() }; });

    enheter.forEach(({ id, sted, res }) => {
      const [raaIgang, raaKoe, raaSiste] = res.map(x => (x && x.kamper) || []);
      const alle = [...raaIgang, ...raaKoe, ...raaSiste];
      const flereGrupper = new Set(alle.map(x => x.gruppe)).size > 1;
      const hallFor = gi => [hallNavn[id], sted, flereGrupper ? 'Hall ' + (gi + 1) : ''].filter(Boolean).join(' · ');
      const seddeKampnr = seddePerId[id].live, seddeRes = seddePerId[id].res;

      for (const { gruppe, match } of raaIgang) {
        const k = parseKamp(match);
        if (seddeKampnr.has(k.kampnr)) continue;
        // match[3] = "Startet bane 4 11:26"
        const baneM = decEnt2(String(match[3] || '')).match(/bane\s+(\S+)\s+(\d{1,2}:\d{2})/i);
        kamper2.push({ ...k, hall: hallFor(gruppe), status: 'live', bane: baneM ? baneM[1] : '', startet: baneM ? baneM[2] : '' });
        seddeKampnr.add(k.kampnr);
      }
      for (const { gruppe, match } of raaKoe) {
        const k = parseKamp(match);
        if (seddeKampnr.has(k.kampnr)) continue;
        // match[3] = "NÆSTE KAMP" eller "Antal kampe før: N"
        const statusRaw = decEnt2(String(match[3] || '')).trim();
        const foerM = statusRaw.match(/(\d+)/);
        const status = statusRaw.toUpperCase() === 'NÆSTE KAMP' ? 'next' : (foerM ? parseInt(foerM[1]) : 'next');
        kamper2.push({ ...k, hall: hallFor(gruppe), status, bane: '', startet: '' });
        seddeKampnr.add(k.kampnr);
      }
      // match[3] = score "12/15 8/15" (sp1/sp2 per sett), match[5] = vinner (1/2)
      for (const { gruppe, match } of raaSiste) {
        const k = parseKamp(match);
        if (seddeRes.has(k.kampnr)) continue;
        seddeRes.add(k.kampnr);
        const sett = String(match[3] || '').trim().split(/\s+/).filter(Boolean).map(s => s.replace('/', '-'));
        const vinner = match[5] === 1 || match[5] === 2 ? match[5] : 0;
        resultater.push({ ...k, hall: hallFor(gruppe), sett, vinner });
      }
    });

    ider.forEach(id => {
      const mine = enheter.filter(e => e.id === id);
      const tell = i => mine.reduce((sum, e) => sum + ((e.res[i] && e.res[i].kamper.length) || 0), 0);
      const si = stedInfo[id] || {};
      kilder.push({ id, hall: hallNavn[id] || '', igang: tell(0), neste: tell(1), resultater: tell(2),
        sesjon: !!sesjoner[id],
        valgt: si.steder && si.steder.length > 1 ? si.steder.length + ' spillesteder' + (si.dato ? ', ' + si.dato : '') : si.standard,
        feil: mine.some(e => e.res.some(x => x === null)),
        struktur: mine.map(e => e.res.map(x => x ? x.struktur : 'feil').join(' | ')).join(' || ') });
    });

    // Resultater fra flere haller flettes nyeste først. tid = "DD-MM HH:MM".
    const tidNokkel = t => { const m = String(t || '').match(/(\d{2})-(\d{2})\s+(\d{2}:\d{2})/); return m ? m[2] + m[1] + m[3] : ''; };
    resultater.sort((a, b) => tidNokkel(b.tid).localeCompare(tidNokkel(a.tid)));

    const svar = { kamper: kamper2, resultater: resultater.slice(0, 40), kilder };
    if (!kilder.some(k => k.feil)) {
      await caches.default.put(liveCacheKey, new Response(JSON.stringify(svar), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=15' }
      }));
    }
    return json(svar);
  }

  if (path === '/stats') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const forventet = String(env.STATS_TOKEN || '').trim();
    if (!forventet) return json({error: 'STATS_TOKEN er ikke satt i workeren'}, 500);
    if (!token || token !== forventet) return json({error: 'Unauthorized'}, 401);
    const account_id = 'b88a9b1ba068ad113b6ed1b8266d3587';
    const query = `
      SELECT blob1 as navn, blob2 as klubb, blob3 as resultat, count() as antall
      FROM goodminton_searches
      WHERE index1 = 'search'
        AND timestamp > NOW() - INTERVAL '30' DAY
      GROUP BY navn, klubb, resultat
      ORDER BY antall DESC
      LIMIT 50
    `;
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account_id}/analytics_engine/sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_ANALYTICS_TOKEN}`,
        'Content-Type': 'text/plain'
      },
      body: query
    });
    if (!r.ok) return json({ error: 'Analytics query feilet', status: r.status }, 502);
    const data = await r.json();
    return json(data);
  }

  if (path === '/varsle') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const { email, tournamentNavn, cup2000Url, navn, klubb } = body;
    if (!email || !tournamentNavn) return json({error: 'Mangler felt'}, 400);

    const key = `varsle:${tournamentNavn}:${email}`;
    await env.VARSLER.put(key, JSON.stringify({ email, tournamentNavn, cup2000Url: cup2000Url || '', navn: navn || '', klubb: klubb || '', registrert: Date.now() }), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ok: true});
  }

  if (path === '/push/subscribe') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const { subscription, tournamentNavn, cup2000Url, navn, klubb } = body || {};

    if (!subscription || typeof subscription.endpoint !== 'string') return json({error: 'Mangler abonnement'}, 400);
    if (subscription.endpoint.length > 1024) return json({error: 'Endpoint for langt'}, 400);
    let endpointUrl;
    try { endpointUrl = new URL(subscription.endpoint); } catch(e) { return json({error: 'Ugyldig endpoint'}, 400); }
    if (endpointUrl.protocol !== 'https:') return json({error: 'Ugyldig endpoint'}, 400);
    if (!subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) return json({error: 'Mangler nøkler'}, 400);
    if (!tournamentNavn) return json({error: 'Mangler felt'}, 400);

    const endpointHash = await sha256Hex(subscription.endpoint);
    const key = `push:${tournamentNavn}:${endpointHash.substring(0, 16)}`;
    await env.VARSLER.put(key, JSON.stringify({
      subscription, tournamentNavn, cup2000Url: cup2000Url || '', navn: navn || '', klubb: klubb || '', registrert: Date.now()
    }), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ok: true});
  }

  if (path === '/push/test') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const forventet = String(env.STATS_TOKEN || '').trim();
    if (!forventet) return json({error: 'STATS_TOKEN er ikke satt i workeren'}, 500);
    if (!token || token !== forventet) return json({error: 'Unauthorized'}, 401);

    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const { tournamentNavn } = body || {};
    if (!tournamentNavn) return json({error: 'Mangler felt'}, 400);

    const list = await env.VARSLER.list({ prefix: `push:${tournamentNavn}:` });
    let sent = 0, failed = 0, deleted = 0;
    for (const k of list.keys) {
      const val = await env.VARSLER.get(k.name, { type: 'json' });
      if (!val) continue;
      const { ok, status } = await sendPush(val.subscription, { title: 'Goodminton', body: 'Test-varsel 🏸', url: 'https://goodminton.no' }, env);
      if (ok) sent++;
      else {
        failed++;
        if (status === 404 || status === 410) { await env.VARSLER.delete(k.name); deleted++; }
      }
    }
    return json({ sent, failed, deleted });
  }

  return new Response('Not found', { status: 404, headers: CORS });
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendResend(email, fornavn, tournamentNavn, env) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Goodminton <noreply@send.goodminton.no>',
      to: [email],
      subject: `Kampprogram klart \u2013 ${tournamentNavn}`,
      html: `<p>Hei${fornavn ? ' ' + escapeHtml(fornavn) : ''}!</p>
<p>Kamprogrammet for <strong>${escapeHtml(tournamentNavn)}</strong> er n\u00e5 tilgjengelig.</p>
<p><a href="https://goodminton.no">Åpne goodminton.no</a> for \u00e5 se kampene dine.</p>
<p style="color:#888;font-size:12px">Du mottar denne e-posten fordi du ba om varsel p\u00e5 goodminton.no.</p>`
    })
  });
  return r.ok;
}

async function sendPush(subscription, payloadObj, env) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };
  const message = {
    data: payloadObj,
    options: { ttl: 60 * 60 * 24 }
  };
  try {
    const payload = await buildPushPayload(message, subscription, vapid);
    const res = await fetch(subscription.endpoint, payload);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

async function cup2000HarKamper(tournamentNavn, cup2000Url) {
  // Finn cup2000 tournamentId
  const cup2000Id = await finnCup2000Id({ tournamentNavn, cup2000Url });
  if (!cup2000Id) return false;

  const BASE = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx';
  const navJson = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=0`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  const navHtml = navJson.data || '';
  // Sjekk om det finnes minst én klasse med tidssatte kamper (data.length >= 3)
  for (const row of navHtml.matchAll(/<tr[^>]*><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/gs)) {
    const ag = row[1].replace(/&nbsp;/g, '').trim();
    if (!ag || ag === 'Klasser') continue;
    for (const lm of row[2].matchAll(/c=(\d+)&(?:amp;)?e=(\d+)"[^>]*>/g)) {
      const d = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${lm[1]}&e=${lm[2]}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
      if (Array.isArray(d.data) && d.data.length >= 3) return true;
    }
  }
  return false;
}

async function handleScheduled(env) {
  const [varsleList, pushList] = await Promise.all([
    env.VARSLER.list({ prefix: 'varsle:' }),
    env.VARSLER.list({ prefix: 'push:' })
  ]);
  if (!varsleList.keys.length && !pushList.keys.length) return;

  // Grupper begge varsel-typer per turnering, slik at cup2000HarKamper() kun kalles én gang per turnering
  const turneringer = {};
  for (const key of varsleList.keys) {
    const val = await env.VARSLER.get(key.name, { type: 'json' });
    if (!val) continue;
    const tn = val.tournamentNavn;
    if (!turneringer[tn]) turneringer[tn] = { cup2000Url: val.cup2000Url, mottakere: [], pushAbonnenter: [] };
    turneringer[tn].mottakere.push({ key: key.name, email: val.email, navn: val.navn });
  }
  for (const key of pushList.keys) {
    const val = await env.VARSLER.get(key.name, { type: 'json' });
    if (!val) continue;
    const tn = val.tournamentNavn;
    if (!turneringer[tn]) turneringer[tn] = { cup2000Url: val.cup2000Url, mottakere: [], pushAbonnenter: [] };
    if (!turneringer[tn].cup2000Url) turneringer[tn].cup2000Url = val.cup2000Url;
    turneringer[tn].pushAbonnenter.push({ key: key.name, subscription: val.subscription });
  }

  for (const [tournamentNavn, info] of Object.entries(turneringer)) {
    const harKamper = await cup2000HarKamper(tournamentNavn, info.cup2000Url);
    if (!harKamper) continue;

    for (const m of info.mottakere) {
      const fornavn = m.navn ? m.navn.split(' ')[0] : '';
      const ok = await sendResend(m.email, fornavn, tournamentNavn, env);
      if (ok) await env.VARSLER.delete(m.key);
    }

    const pushPayload = { title: 'Goodminton', body: `Kampprogrammet for ${tournamentNavn} er klart! 🏸`, url: 'https://goodminton.no' };
    for (const p of info.pushAbonnenter) {
      const { ok, status } = await sendPush(p.subscription, pushPayload, env);
      if (ok || status === 404 || status === 410) await env.VARSLER.delete(p.key);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  }
};
