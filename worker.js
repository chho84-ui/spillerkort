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

  if (path === '/cup2000debug') {
    let body;
    try { body = await request.json(); } catch(e) { return json({error: 'Ugyldig JSON'}, 400); }
    const navnNorm2 = (body.tournamentNavn || '').replace(/^[^:]+:\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
    let cup2000Id2 = null;
    const listHtml2 = await (await fetch('https://www.cup2000.dk/turnerings-system/Vis-turneringer/', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    for (const m of listHtml2.matchAll(/onclick="selectTournament\((\d+)\)"[^>]*>.*?<td>(\d+)<\/td><td>[^<]*<\/td><td>([^<]+)<\/td>/gs)) {
      const rowName = m[3].toLowerCase().replace(/\s+/g, ' ').trim();
      if (rowName.includes(navnNorm2) || navnNorm2.includes(rowName.split(' ').slice(-3).join(' '))) { cup2000Id2 = m[1]; break; }
    }
    if (!cup2000Id2) return json({ error: 'Turnering ikke funnet', navnNorm: navnNorm2 });
    const BASE3 = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx';
    const UA3 = { 'User-Agent': 'Mozilla/5.0' };
    const navJson2 = await (await fetch(`${BASE3}?tournamentid=${cup2000Id2}&c=0`, { headers: UA3 })).json();
    const classes2 = [];
    if (Array.isArray(navJson2.data)) {
      for (const cat of navJson2.data) {
        if (!Array.isArray(cat)) continue;
        for (const cl of cat) {
          if (Array.isArray(cl) && cl[0] && cl[1]) classes2.push({ c: cl[0], e: cl[1], disc: String(cl[2]||'') });
        }
      }
    }
    if (!classes2.length) return json({ cup2000Id: cup2000Id2, error: 'Ingen klasser' });
    // Hent raw data for første klasse + første pulje
    const firstClass = classes2[0];
    const d2 = await (await fetch(`${BASE3}?tournamentid=${cup2000Id2}&c=${firstClass.c}&e=${firstClass.e}`, { headers: UA3 })).json();
    const puljer2 = d2.data && d2.data[0] && Array.isArray(d2.data[0][3]) ? d2.data[0][3] : [];
    const firstPuljeId = puljer2[0] ? puljer2[0][0] : null;
    let pdRaw = null;
    if (firstPuljeId) {
      pdRaw = await (await fetch(`${BASE3}?tournamentid=${cup2000Id2}&c=${firstClass.c}&e=${firstClass.e}&p=0&g=${firstPuljeId}`, { headers: UA3 })).json();
    }
    const rawRounds = pdRaw && pdRaw.data && Array.isArray(pdRaw.data[2]) && Array.isArray(pdRaw.data[2][0]) ? pdRaw.data[2][0] : [];
    return json({
      cup2000Id: cup2000Id2,
      firstClass,
      pdDataLength: pdRaw && pdRaw.data ? pdRaw.data.length : null,
      pdAllKeys: pdRaw ? Object.keys(pdRaw) : null,
      rawMatches: rawRounds.slice(0, 3).map(m => Array.isArray(m) ? { len: m.length, m0: m[0], m2: m[2], m8: m[8], m9: m[9], m10: m[10], m11: m[11], m12: m[12] } : m)
    });
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

    if (!classes.length) return json({ kamper: [] });

    // Steg 3: Per klasse — finn spillerens puljer, hent kamper per pulje
    const fetchClass = async ({ c, e, disc, ageGroup }) => {
      const d = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}`, { headers: UA })).json();
      if (!Array.isArray(d.data)) return { kamper: [], grupper: [] };
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

      // Hent kamper og gruppestandings for hver pulje
      const kamper = [];
      const grupper = [];
      for (const puljeId of minePuljer) {
        const pd = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}&p=0&g=${puljeId}`, { headers: UA })).json();
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
          const rawTime = String(match[2] || '');
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
          const navnStr = Array.isArray(s[5]) && s[5][0] ? decEnt(String(s[5][0])) : '';
          const navn = navnStr.split(',')[0].trim();
          const klubb = (navnStr.split(',')[1] || '').trim();
          const erMeg = navnParts.length >= 2
            ? navnStr.toLowerCase().includes(navnParts[0].toLowerCase()) && navnStr.toLowerCase().includes(navnParts[navnParts.length - 1].toLowerCase())
            : navnStr.toLowerCase().includes(navnFull.toLowerCase());
          return { pos: parseInt(s[4]) || 0, navn, klubb, kV: s[7] || 0, kT: s[8] || 0, sV: s[9] || 0, sT: s[10] || 0, erMeg };
        }).sort((a, b) => a.pos - b.pos);
        if (spillereListe.length > 0) grupper.push({ disc: dc, ageGroup, spillere: spillereListe });
      }

      // Sluttspill (knockout): hent p=1 (uten g)
      // Struktur: data[0]=tittel, data[1]=[[idx,?,pos,[navn]],...], data[2]=[[rundeId,[kamper]],...]
      // Kamp: [bane, ?, "HH:MM DD-MM-YYYY", scoreStr, ?, vinner(1/2), [], [], sp1idx, sp2idx, ...]
      try {
        const spJson = await (await fetch(`${BASE}?tournamentid=${cup2000Id}&c=${c}&e=${e}&p=1`, { headers: UA })).json();
        if (Array.isArray(spJson.data) && spJson.data.length >= 3) {
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
              const rawTime = String(match[2] || '');
              const tp = rawTime.trim().split(/\s+/);
              let timeStr;
              if (tp.length >= 2) {
                const p0 = tp[0], p1 = tp[1];
                if (/^\d{2}:\d{2}/.test(p0)) {
                  timeStr = p1.substring(0, 5) + ' ' + p0.substring(0, 5);
                } else {
                  timeStr = p0.substring(0, 5) + ' ' + p1.substring(0, 5);
                }
              } else {
                timeStr = tp[0] || '';
              }
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

    const allResults = await Promise.all(classes.map(fetchClass));
    const kamper = allResults.flatMap(r => r.kamper).sort((a, b) => (a.tid || '').localeCompare(b.tid || ''));
    const grupper = allResults.flatMap(r => r.grupper);
    return json({ kamper, grupper });
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

    // w=1 gir "Næste kampe": alle kommende + pågående kamper med live score
    const liveJson = await (await fetch(`${BASE2}?tournamentid=${cup2000Id}&w=1`, { headers: UA2 })).json();
    // data[3][0] = flat liste av alle kamper
    const rawKamper = Array.isArray(liveJson.data) && Array.isArray(liveJson.data[3]) && Array.isArray(liveJson.data[3][0])
      ? liveJson.data[3][0] : [];

    const DISC_MAP2 = [['herresingle','HS'],['damesingle','DS'],['herredouble','HD'],['damedouble','DD'],['mixed','MD']];
    function discCode2(name) { const n = name.toLowerCase(); for (const [k,v] of DISC_MAP2) if (n.includes(k)) return v; return ''; }
    function decEnt2(s) { return s.replace(/&#(\d+);/g, (_,n) => String.fromCharCode(Number(n))); }

    const navnDeler = (body.navn || '').toLowerCase().split(' ').filter(Boolean);

    const kamper2 = [];
    for (const match of rawKamper) {
      if (!Array.isArray(match)) continue;
      const sp1raw = Array.isArray(match[6]) ? match[6] : [];
      const sp2raw = Array.isArray(match[7]) ? match[7] : [];
      const spiller1 = sp1raw.map(n => { const dn = decEnt2(String(n)); return { navn: dn.split(',')[0].trim(), klubb: (dn.split(',')[1]||'').trim() }; });
      const spiller2 = sp2raw.map(n => { const dn = decEnt2(String(n)); return { navn: dn.split(',')[0].trim(), klubb: (dn.split(',')[1]||'').trim() }; });
      const allNames = [...spiller1, ...spiller2].map(s => s.navn.toLowerCase());
      const mine = navnDeler.length >= 2
        ? allNames.some(n => navnDeler.every(del => n.includes(del)))
        : allNames.some(n => n.includes(navnDeler[0] || ''));
      const discFull = decEnt2(String(match[4] || ''));
      const dc = discCode2(discFull);
      const ageGroupM = discFull.match(/U\d+|Senior|Junior/i);
      const ageGroup = ageGroupM ? ageGroupM[0].toUpperCase() : '';
      // Tid: "HH:MM DD-MM-YYYY"
      const rawTime = String(match[2] || '');
      const tp = rawTime.trim().split(/\s+/);
      const tid = tp.length >= 2 && /^\d{2}:\d{2}/.test(tp[0]) ? tp[1].substring(0,5) + ' ' + tp[0].substring(0,5) : (tp[0] || '');
      // Status: match[3] = "NÆSTE KAMP" / "Antal kampe før: N" / ""
      const statusRaw = decEnt2(String(match[3] || '')).trim();
      let status; // 'live' | 'next' | number (kamper igjen)
      if (!statusRaw || statusRaw === 'NÆSTE KAMP') {
        status = statusRaw === 'NÆSTE KAMP' ? 'next' : 'live';
      } else {
        const foerM = statusRaw.match(/(\d+)/);
        status = foerM ? parseInt(foerM[1]) : statusRaw;
      }
      // Live score: match[10] = [set1sp1, set1sp2, set2sp1, set2sp2, ...]
      const sets = Array.isArray(match[10]) ? match[10] : [];
      const score = [];
      for (let i = 0; i + 1 < sets.length; i += 2) {
        if (sets[i] != null && sets[i+1] != null) score.push([sets[i], sets[i+1]]);
      }
      kamper2.push({ tid, bane: String(match[0] || ''), disc: dc, discFull, ageGroup, spiller1, spiller2, score, status, mine });
    }
    return json({ kamper: kamper2 });
  }

  if (path === '/stats') {
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
        'Authorization': `Bearer ${CF_ANALYTICS_TOKEN}`,
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
