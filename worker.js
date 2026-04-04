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

async function handleRequest(request, env) {
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
    if (!hits.length) {
      if (env.ANALYTICS) env.ANALYTICS.writeDataPoint({ blobs: [body.navn || '', body.klubb || '', 'not_found'], doubles: [0], indexes: ['search'] });
      return json({error: 'Spiller ikke funnet', html: shtml.substring(0, 500)}, 404);
    }
    const klubbLower = (body.klubb || '').toLowerCase();
    let foundId = hits[0];
    if (hits.length > 1) {
      for (const pid of hits) {
        const idx = shtml.indexOf("SP1('" + pid + "'");
        const chunk = shtml.substring(idx, idx + 400).toLowerCase();
        if (klubbLower && chunk.indexOf(klubbLower) !== -1) { foundId = pid; break; }
      }
    }
    if (env.ANALYTICS) env.ANALYTICS.writeDataPoint({ blobs: [body.navn || '', body.klubb || '', 'found', foundId], doubles: [hits.length], indexes: ['search'] });
    if (hits.length === 1) return json({playerid: foundId});
    return json({playerid: foundId, multiple: hits});
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

    const navnLower = (body.navn || '').split(' ').pop().toLowerCase();

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

    if (!classes.length) return json({ kamper: [] });

    // Steg 3: Per klasse — finn spillerens puljer, hent kamper per pulje
    const fetchClass = async ({ c, e, disc, ageGroup }) => {
      const d = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}`, { headers: UA })).json();
      if (!Array.isArray(d.data)) return [];
      const puljer = d.data[0] && Array.isArray(d.data[0][3]) ? d.data[0][3] : [];
      const dc = discCode(disc);

      // Finn puljer der spilleren er med
      const minePuljer = [];
      for (const pulje of puljer) {
        const puljeId = pulje[0];
        const spillere = Array.isArray(pulje[1]) ? pulje[1] : [];
        // Pulje-spillere: s = [0, ["Navn, Klubb"]] (enkelt) eller [0, ["Sp1, Klubb", "Sp2, Klubb"]] (double)
        const harSpiller = spillere.some(s => {
          const navnArr = Array.isArray(s[1]) ? s[1] : [];
          return navnArr.some(n => decEnt(String(n)).toLowerCase().includes(navnLower));
        });
        if (harSpiller) minePuljer.push(puljeId);
      }
      if (!minePuljer.length) return [];

      // Hent kamper for hver pulje
      const kamper = [];
      for (const puljeId of minePuljer) {
        const pd = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}&p=0&g=${puljeId}`, { headers: UA })).json();
        if (!Array.isArray(pd.data) || pd.data.length < 3) continue;

        // pd.data[1] = spillere: [spillerIdx, ..., ..., ..., ..., [navn1, navn2?], ...]
        // For doubles er s[5] = ["Sp1, Klubb", "Sp2, Klubb"]
        const spillerMap = {};
        for (const s of (pd.data[1] || [])) {
          const idx = s[0];
          const navnArr = Array.isArray(s[5]) ? s[5].map(n => decEnt(String(n))) : [];
          spillerMap[idx] = navnArr.map(n => ({
            navn: n.split(',')[0].trim(),
            klubb: (n.split(',')[1] || '').trim()
          }));
        }

        // pd.data[2][0] = kamparray: [bane, ?, tid, ?, ?, ?, [], [], p1idx, p2idx, res, ...]
        const rounds = Array.isArray(pd.data[2]) && Array.isArray(pd.data[2][0]) ? pd.data[2][0] : [];
        for (const match of rounds) {
          if (!Array.isArray(match)) continue;
          const p1idx = match[8], p2idx = match[9];
          const sp1list = spillerMap[p1idx] || [];
          const sp2list = spillerMap[p2idx] || [];
          const isSp1 = sp1list.some(s => s.navn.toLowerCase().includes(navnLower));
          const isSp2 = sp2list.some(s => s.navn.toLowerCase().includes(navnLower));
          if (!isSp1 && !isSp2) continue;

          const motSpillere = isSp1 ? sp2list : sp1list;
          const mot = motSpillere.map(s => s.navn).join(' / ');
          const motKlubb = [...new Set(motSpillere.map(s => s.klubb).filter(Boolean))].join(' / ');

          const rawTime = String(match[2] || '');
          const tp = rawTime.split(' ');
          const timeStr = tp.length >= 2 ? tp[1].substring(0, 5) + ' ' + tp[0] : tp[0];
          const bane = String(match[0] || '');

          // Resultat: match[10] = null eller sett-data
          const resRaw = match[10];
          let res = '';
          if (resRaw != null && typeof resRaw === 'object' && !Array.isArray(resRaw)) {
            // noop
          } else if (Array.isArray(resRaw)) {
            const chunks = [];
            for (let i = 0; i + 1 < resRaw.length; i += 2) {
              if (resRaw[i] == null) break;
              chunks.push(isSp1 ? `${resRaw[i]}-${resRaw[i+1]}` : `${resRaw[i+1]}-${resRaw[i]}`);
            }
            res = chunks.join(', ');
          }

          kamper.push({ tid: timeStr, bane, disc: dc, mot, motKlubb, motSpillere, ageGroup, res });
        }
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

    // Hent pågående kamper via o=1
    const liveJson = await (await fetch(`${BASE2}?tournamentid=${cup2000Id}&o=1`, { headers: UA2 })).json();
    const courts2 = Array.isArray(liveJson.data) ? (liveJson.data[3] || []) : [];

    const DISC_MAP2 = [['herresingle','HS'],['damesingle','DS'],['herredouble','HD'],['damedouble','DD'],['mixed','MD']];
    function discCode2(name) { const n = name.toLowerCase(); for (const [k,v] of DISC_MAP2) if (n.includes(k)) return v; return ''; }
    function decEnt2(s) { return s.replace(/&#(\d+);/g, (_,n) => String.fromCharCode(Number(n))); }

    const navnLow2 = (body.navn || '').split(' ').pop().toLowerCase();

    const kamper2 = [];
    for (const court of courts2) {
      if (!Array.isArray(court)) continue;
      for (const match of court) {
        if (!Array.isArray(match)) continue;
        const sp1raw = Array.isArray(match[6]) ? match[6] : [];
        const sp2raw = Array.isArray(match[7]) ? match[7] : [];
        const spiller1 = sp1raw.map(n => { const dn = decEnt2(String(n)); return { navn: dn.split(',')[0].trim(), klubb: (dn.split(',')[1]||'').trim() }; });
        const spiller2 = sp2raw.map(n => { const dn = decEnt2(String(n)); return { navn: dn.split(',')[0].trim(), klubb: (dn.split(',')[1]||'').trim() }; });
        const allNames = [...spiller1, ...spiller2].map(s => s.navn.toLowerCase());
        const mine = allNames.some(n => n.includes(navnLow2));
        const discFull = String(match[4] || '');
        const dc = discCode2(discFull);
        const ageGroupM = discFull.match(/U\d+|Senior|Junior/i);
        const ageGroup = ageGroupM ? ageGroupM[0].toUpperCase() : '';
        const rawTime = String(match[2] || '');
        const tp = rawTime.split(' ');
        const tid = tp.length >= 2 ? tp[1].substring(0,5) + ' ' + tp[0] : tp[0];
        const sets = Array.isArray(match[10]) ? match[10] : [];
        const res1 = sets[0] != null ? String(sets[0]) : '';
        const res2 = sets[1] != null ? String(sets[1]) : '';
        kamper2.push({ tid, bane: String(match[0] || ''), disc: dc, ageGroup, spiller1, spiller2, res1, res2, mine });
      }
    }
    kamper2.sort((a,b) => (a.tid||'').localeCompare(b.tid||''));
    return json({ kamper: kamper2 });
  }

  if (path === '/varsle') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const { email, tournamentNavn, cup2000Url, navn, klubb } = body;
    if (!email || !tournamentNavn) return json({error: 'Mangler felt'}, 400);

    const key = `varsle:${tournamentNavn}:${email}`;
    await VARSLER.put(key, JSON.stringify({ email, tournamentNavn, cup2000Url: cup2000Url || '', navn: navn || '', klubb: klubb || '', registrert: Date.now() }), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ok: true});
  }

  return new Response('Not found', { status: 404, headers: CORS });
}

async function sendResend(email, fornavn, tournamentNavn) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'Goodminton <noreply@send.goodminton.no>',
      to: [email],
      subject: `Kampprogram klart \u2013 ${tournamentNavn}`,
      html: `<p>Hei${fornavn ? ' ' + fornavn : ''}!</p>
<p>Kamprogrammet for <strong>${tournamentNavn}</strong> er n\u00e5 tilgjengelig.</p>
<p><a href="https://goodminton.no">Åpne goodminton.no</a> for \u00e5 se kampene dine.</p>
<p style="color:#888;font-size:12px">Du mottar denne e-posten fordi du ba om varsel p\u00e5 goodminton.no.</p>`
    })
  });
  return r.ok;
}

async function cup2000HarKamper(tournamentNavn, cup2000Url) {
  // Finn cup2000 tournamentId
  let cup2000Id = null;
  if (cup2000Url) {
    const m = cup2000Url.match(/tournamentid=(\d+)/i);
    if (m) cup2000Id = m[1];
  }
  if (!cup2000Id && tournamentNavn) {
    const listHtml = await (await fetch('https://www.cup2000.dk/turnerings-system/Vis-turneringer/', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })).text();
    const navnNorm = tournamentNavn.replace(/^[^:]+:\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
    for (const m of listHtml.matchAll(/onclick="selectTournament\((\d+)\)"[^>]*>.*?<td>(\d+)<\/td><td>[^<]*<\/td><td>([^<]+)<\/td>/gs)) {
      const rowName = m[3].toLowerCase().replace(/\s+/g, ' ').trim();
      if (rowName.includes(navnNorm) || navnNorm.includes(rowName.split(' ').slice(-3).join(' '))) {
        cup2000Id = m[1]; break;
      }
    }
  }
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

addEventListener('scheduled', function(event) {
  event.waitUntil(handleScheduled());
});

async function handleScheduled() {
  const list = await VARSLER.list({ prefix: 'varsle:' });
  if (!list.keys.length) return;

  // Grupper per turnering for å unngå å sjekke cup2000 flere ganger
  const turneringer = {};
  for (const key of list.keys) {
    const val = await VARSLER.get(key.name, { type: 'json' });
    if (!val) continue;
    const tn = val.tournamentNavn;
    if (!turneringer[tn]) turneringer[tn] = { cup2000Url: val.cup2000Url, mottakere: [] };
    turneringer[tn].mottakere.push({ key: key.name, email: val.email, navn: val.navn });
  }

  for (const [tournamentNavn, info] of Object.entries(turneringer)) {
    const harKamper = await cup2000HarKamper(tournamentNavn, info.cup2000Url);
    if (!harKamper) continue;

    for (const m of info.mottakere) {
      const fornavn = m.navn ? m.navn.split(' ')[0] : '';
      const ok = await sendResend(m.email, fornavn, tournamentNavn);
      if (ok) await VARSLER.delete(m.key);
    }
  }
}

addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request, typeof ANALYTICS !== 'undefined' ? { ANALYTICS: ANALYTICS } : {}));
});
