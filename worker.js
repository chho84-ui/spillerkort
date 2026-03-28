const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

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
    const hits = [];
    const re2 = /SP1\('(\d+)'/g;
    let m2;
    while ((m2 = re2.exec(shtml)) !== null) hits.push(m2[1]);
    if (!hits.length) return json({error: 'Spiller ikke funnet', html: shtml.substring(0, 500)}, 404);
    if (hits.length === 1) return json({playerid: hits[0]});
    const klubbLower = (body.klubb || '').toLowerCase();
    for (const pid of hits) {
      const idx = shtml.indexOf("SP1('" + pid + "'");
      const chunk = shtml.substring(idx, idx + 400).toLowerCase();
      if (klubbLower && chunk.indexOf(klubbLower) !== -1) return json({playerid: pid});
    }
    return json({playerid: hits[0], multiple: hits});
  }

  if (path === '/api') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const ctx = await getCtx();
    if (!ctx) return json({error: 'Kunne ikke hente session fra badmintonportalen.no'}, 500);
    body.data.callbackcontextkey = ctx;
    const r = await fetch('https://badmintonportalen.no/SportsResults/Components/WebService1.asmx/' + body.method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body.data)
    });
    const result = await r.json();
    return json(result);
  }

  if (path === '/app') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const r = await fetch('https://badmintonportalen.no/SportsResults/Services/App.aspx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await r.json();
    return json(result);
  }

  if (path === '/cup2000') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }

    // Steg 1: Finn cup2000 tournamentId fra turneringsnavnet
    let cup2000Id = null;
    if (body.tournamentNavn) {
      const listHtml = await (await fetch('https://www.cup2000.dk/turnerings-system/Vis-turneringer/', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })).text();
      const navnNorm = body.tournamentNavn.replace(/^[^:]+:\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
      for (const m of listHtml.matchAll(/onclick="selectTournament\((\d+)\)"[^>]*>.*?<td>(\d+)<\/td><td>[^<]*<\/td><td>([^<]+)<\/td>/gs)) {
        const rowName = m[3].toLowerCase().replace(/\s+/g, ' ').trim();
        if (rowName.includes(navnNorm) || navnNorm.includes(rowName.split(' ').slice(-3).join(' '))) {
          cup2000Id = m[1];
          break;
        }
      }
    }
    if (!cup2000Id) return json({ kamper: [] });

    const BASE = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx';
    const UA = { 'User-Agent': 'Mozilla/5.0' };

    // Steg 2: Hent klasse-navigasjon for å finne alle c/e-kombinasjoner (med aldersgruppe)
    const navJson = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=0`, { headers: UA })).json();
    const navHtml = navJson.data || '';
    const classes = [];
    // Parse rad for rad: <tr><td>U15 A</td><td>...lenker...</td></tr>
    for (const row of navHtml.matchAll(/<tr[^>]*><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/gs)) {
      const ag = row[1].replace(/&nbsp;/g,'').trim();
      if (!ag || ag === 'Klasser') continue;
      for (const lm of row[2].matchAll(/c=(\d+)&(?:amp;)?e=(\d+)"[^>]*>([^<]+)<\/a>/g)) {
        classes.push({ c: lm[1], e: lm[2], disc: lm[3].trim(), ageGroup: ag });
      }
    }
    if (!classes.length) return json({ kamper: [] });

    // Disiplin-kart: cup2000 navn → kort kode
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

    // Steg 3: Hent alle klasser parallelt og finn spillerens kamper
    // HTML-entity dekoder (norske tegn)
    function decEnt(s) {
      return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    }

    const navnLower = (body.navn || '').split(' ').pop().toLowerCase();

    const fetchClass = async ({ c, e, disc, ageGroup }) => {
      const d = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}`, { headers: UA })).json();
      if (!Array.isArray(d.data) || d.data.length < 3) return [];
      const [, players, matchInfo] = d.data;

      // Finn spillerens indekser (1-basert)
      const playerIdxs = new Set();
      players.forEach((p, i) => {
        (p[5] || []).forEach(n => {
          if (n.toLowerCase().includes(navnLower)) playerIdxs.add(i + 1);
        });
      });
      if (!playerIdxs.size) return [];

      const rounds = matchInfo[0] || [];
      const courts = matchInfo[1] || [];
      const courtMap = {};
      courts.forEach(ct => { courtMap[ct[0]] = ct[1]; });

      const dc = discCode(disc);
      const kamper = [];
      for (const match of rounds) {
        const p1i = match[8], p2i = match[9];
        if (!playerIdxs.has(p1i) && !playerIdxs.has(p2i)) continue;
        const myIdx = playerIdxs.has(p1i) ? p1i : p2i;
        const oppIdx = myIdx === p1i ? p2i : p1i;
        const oppEntry = players[oppIdx - 1] || [];
        const oppRaw = (oppEntry[5] || []).map(n => decEnt(n));
        const motSpillere = oppRaw.map(n => ({
          navn: n.split(',')[0].trim(),
          klubb: (n.split(',')[1] || '').trim()
        }));
        const mot = motSpillere.map(s => s.navn).join(' / ');
        const motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');
        // match[2] = "09:45 28-03-2026" - keep date too, reformat to "28-03 09:45"
        const rawTime = match[2] || '';
        const timeParts = rawTime.split(' ');
        const timeStr = timeParts.length >= 2
          ? timeParts[1].substring(0, 5) + ' ' + timeParts[0]
          : timeParts[0];
        const bane = String(match[1] || '');
        const r1 = match[3], r2 = match[4];
        const res = (r1 || r2) ? (myIdx === p1i ? `${r1}-${r2}` : `${r2}-${r1}`) : '';
        kamper.push({ tid: timeStr, bane: bane, disc: dc, mot: mot, motKlubb: motKlubb, motSpillere: motSpillere, ageGroup: ageGroup, res: res });
      }
      return kamper;
    };

    const allResults = await Promise.all(classes.map(fetchClass));
    const kamper = allResults.flat().sort((a, b) => (a.tid || '').localeCompare(b.tid || ''));
    return json({ kamper });
  }

  if (path === '/cup2000live') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }

    let cup2000Id = null;
    if (body.tournamentNavn) {
      const listHtml = await (await fetch('https://www.cup2000.dk/turnerings-system/Vis-turneringer/', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })).text();
      const navnNorm = body.tournamentNavn.replace(/^[^:]+:\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
      for (const m of listHtml.matchAll(/onclick="selectTournament\((\d+)\)"[^>]*>.*?<td>(\d+)<\/td><td>[^<]*<\/td><td>([^<]+)<\/td>/gs)) {
        const rowName = m[3].toLowerCase().replace(/\s+/g, ' ').trim();
        if (rowName.includes(navnNorm) || navnNorm.includes(rowName.split(' ').slice(-3).join(' '))) {
          cup2000Id = m[1]; break;
        }
      }
    }
    if (!cup2000Id) return json({ kamper: [] });

    const BASE2 = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx';
    const UA2 = { 'User-Agent': 'Mozilla/5.0' };

    const navJson2 = await (await fetch(`${BASE2}?tournamentid=${cup2000Id}&c=0`, { headers: UA2 })).json();
    const navHtml2 = navJson2.data || '';
    const classes2 = [];
    for (const row of navHtml2.matchAll(/<tr[^>]*><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/gs)) {
      const ag = row[1].replace(/&nbsp;/g,'').trim();
      if (!ag || ag === 'Klasser') continue;
      for (const lm of row[2].matchAll(/c=(\d+)&(?:amp;)?e=(\d+)"[^>]*>([^<]+)<\/a>/g)) {
        classes2.push({ c: lm[1], e: lm[2], disc: lm[3].trim(), ageGroup: ag });
      }
    }
    if (!classes2.length) return json({ kamper: [] });

    const DISC_MAP2 = [['herresingle','HS'],['damesingle','DS'],['herredouble','HD'],['damedouble','DD'],['mixed','MD']];
    function discCode2(name) { const n = name.toLowerCase(); for (const [k,v] of DISC_MAP2) if (n.includes(k)) return v; return ''; }
    function decEnt2(s) { return s.replace(/&#(\d+);/g, (_,n) => String.fromCharCode(Number(n))); }

    const navnLow2 = (body.navn || '').split(' ').pop().toLowerCase();

    const fetchClassAll = async ({ c, e, disc, ageGroup }) => {
      const d = await (await fetch(`${BASE2}?tournamentid=${cup2000Id}&c=${c}&e=${e}`, { headers: UA2 })).json();
      if (!Array.isArray(d.data) || d.data.length < 3) return [];
      const [, players, matchInfo] = d.data;
      const rounds = matchInfo[0] || [];
      const dc = discCode2(disc);
      const kamper = [];
      for (const match of rounds) {
        const p1i = match[8], p2i = match[9];
        if (!p1i || !p2i) continue;
        const makeSpillere = (entry) => (entry[5] || []).map(n => {
          const dn = decEnt2(n);
          return { navn: dn.split(',')[0].trim(), klubb: (dn.split(',')[1] || '').trim() };
        });
        const spiller1 = makeSpillere(players[p1i - 1] || []);
        const spiller2 = makeSpillere(players[p2i - 1] || []);
        const allNames = [...spiller1, ...spiller2].map(s => s.navn.toLowerCase());
        const mine = allNames.some(n => n.includes(navnLow2));
        const rawTime = match[2] || '';
        const tp = rawTime.split(' ');
        const tid = tp.length >= 2 ? tp[1].substring(0,5) + ' ' + tp[0] : tp[0];
        const res1 = match[3] != null ? String(match[3]) : '';
        const res2 = match[4] != null ? String(match[4]) : '';
        kamper.push({ tid, bane: String(match[1] || ''), disc: dc, ageGroup, spiller1, spiller2, res1, res2, mine });
      }
      return kamper;
    };

    const all2 = await Promise.all(classes2.map(fetchClassAll));
    const kamper2 = all2.flat().sort((a,b) => (a.tid||'').localeCompare(b.tid||''));
    return json({ kamper: kamper2 });
  }

  return new Response('Not found', { status: 404, headers: CORS });
}

addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request));
});
