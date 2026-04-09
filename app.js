var PROXY = 'https://spillerkort-proxy.chho84.workers.dev';

var SN, SI, SK, SS;
var oliverRanking = [];

// 10-minutters frontend-cache
var _cache = {};
var CACHE_TTL = 10 * 60 * 1000;
function cacheGet(key) {
  var e = _cache[key];
  if (e && (Date.now() - e.ts < CACHE_TTL)) return e.val;
  return undefined;
}
function cacheSet(key, val) { _cache[key] = { val: val, ts: Date.now() }; return val; }

function lagre() {
  localStorage.setItem('sk_navn', document.getElementById('f-navn').value);
  localStorage.setItem('sk_klubb',document.getElementById('f-klubb').value);
}

var TURNERING_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dager

function lagreTurnering(playerKey, t) {
  var key = 'tur:' + playerKey;
  var stored = {};
  try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  stored[t.tournamentId] = { t: t, ts: Date.now() };
  try { localStorage.setItem(key, JSON.stringify(stored)); } catch(e) {}
}

function hentLagredeTurneringer(playerKey) {
  var key = 'tur:' + playerKey;
  var stored = {};
  try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  var now = Date.now();
  var gyldige = {};
  Object.keys(stored).forEach(function(tid) {
    if (now - stored[tid].ts < TURNERING_TTL) gyldige[tid] = stored[tid].t;
  });
  return gyldige;
}

function laster() {
  var n = localStorage.getItem('sk_navn');
  var k = localStorage.getItem('sk_klubb');
  if (n) document.getElementById('f-navn').value = n;
  if (k) document.getElementById('f-klubb').value = k;
}

function sokSpiller(navn, klubb) {
  var key = 'sok:' + navn + '|' + klubb;
  var hit = cacheGet(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return fetch(PROXY + '/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ navn: navn, klubb: klubb })
  }).then(function(r) { return r.json(); }).then(function(d) { return cacheSet(key, d); });
}

function api(method, data) {
  return fetch(PROXY + '/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: method, data: data })
  }).then(function(r) { return r.json(); });
}

function appApi(data) {
  return fetch(PROXY + '/app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function(r) { return r.json(); });
}

function cup2000Api(tournamentNavn, cup2000Url) {
  var key = 'cup2000:' + tournamentNavn + '|' + SN;
  var hit = cacheGet(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return fetch(PROXY + '/cup2000', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tournamentNavn: tournamentNavn, cup2000Url: cup2000Url || '', navn: SN, klubb: SK })
  }).then(function(r) { return r.json(); }).then(function(d) { return cacheSet(key, d); });
}

function hentRanking() {
  return api('GetPlayerProfile', {
    seasonid: SS, playerid: SI,
    getplayerdata: false, showUserProfile: true, showheader: false
  }).then(function(res) {
    var html = String((res.d && res.d.Html) || res.d || '');
    var rows = [];
    var dp = new DOMParser();
    var doc = dp.parseFromString(html, 'text/html');
    var trs = doc.querySelectorAll('table tr');
    for (var i = 0; i < trs.length; i++) {
      var tds = trs[i].querySelectorAll('td');
      if (tds.length >= 2) {
        var cells = [];
        for (var j = 0; j < tds.length; j++) cells.push(tds[j].textContent.trim());
        var last = cells[cells.length - 1];
        if (/^\d+$/.test(last)) {
          // Lenke til rankinglisten ligger i første <td>
          var firstTd = tds[0];
          var a = firstTd.querySelector('a');
          var rankUrl = a ? a.getAttribute('href') : null;
          // Gjør relativ URL absolutt
          if (rankUrl && !rankUrl.startsWith('http')) {
            rankUrl = 'https://badmintonportalen.no' + (rankUrl.startsWith('/') ? '' : '/') + rankUrl;
          }
          rows.push({ disiplin: cells[0], klasse: cells[2] || cells[1] || '', plass: last, url: rankUrl });
        }
      }
    }
    oliverRanking = rows;
    return rows;
  });
}

function finnTurneringer() {
  var now = new Date();
  var fraDate = new Date(now);
  fraDate.setDate(fraDate.getDate() - 28);
  var dd = String(fraDate.getDate()).padStart(2, '0');
  var mm = String(fraDate.getMonth() + 1).padStart(2, '0');
  var yyyy = now.getFullYear();
  var fra = dd + '.' + mm + '.' + yyyy;

  return api('GetSeasonPlan', {
    seasonid: SS, regionids: null, agegroupids: null, classids: null,
    strfrom: fra, strto: '31.12.' + yyyy,
    strweekno: '', strweekno2: '', georegionids: null,
    clubid: '', disciplines: null, playerid: null,
    birthdate: null, age: null, points: null, gender: null,
    publicseasonplan: true, showleague: false,
    selectclientfunction: 'SeasonPlan.SelectTournament', page: 0
  }).then(function(res) {
    var html = String((res.d && (res.d.html || res.d.Html)) || res.d || '');
    var kmap = {};
    var re = /SeasonPlan\.SelectTournament\((\d+),\s*(\d+)\)/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var tid = m[1], cid = m[2];
      if (!kmap[tid]) kmap[tid] = { klasser: [], navn: '', dato: '', cup2000Url: '' };
      if (kmap[tid].klasser.indexOf(cid) === -1) kmap[tid].klasser.push(cid);
    }
    var dp2 = new DOMParser();
    var doc2 = dp2.parseFromString(html, 'text/html');
    var trs2 = doc2.querySelectorAll('tr[onclick]');
    for (var i = 0; i < trs2.length; i++) {
      var oc = trs2[i].getAttribute('onclick');
      var idM = oc && oc.match(/SelectTournament\((\d+),/);
      if (!idM) continue;
      var tid2 = idM[1];
      if (!kmap[tid2] || kmap[tid2].navn) continue;
      var tds2 = trs2[i].querySelectorAll('td');
      // tds2[1] = ukenummer, tds2[2] = dager f.eks "10.-12.", tds2[4] = påmeldingsfrist
      // Beregn dato fra ukenummer + år fra fristen
      var dagerTekst = tds2[2] ? tds2[2].textContent.trim() : '';
      var fristTekst = tds2[4] ? tds2[4].textContent.trim() : '';
      var fristParts = fristTekst.split('.');
      var turAar = parseInt(fristParts[2]) || new Date().getFullYear();
      var ukeNr = parseInt(tds2[1] ? tds2[1].textContent.trim() : '0');
      var startDagM = dagerTekst.match(/(\d+)/);
      var startDag = startDagM ? parseInt(startDagM[1]) : 1;
      // Finn dato fra ukenummer (ISO: uke 1 = uke med første torsdag)
      var jan4 = new Date(turAar, 0, 4);
      var startOfWeek1 = new Date(jan4);
      startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
      var turDato = new Date(startOfWeek1);
      turDato.setDate(startOfWeek1.getDate() + (ukeNr - 1) * 7);
      // Juster til riktig ukedag basert på startdag i måneden
      // Finn mandag i uke ukeNr, og match startDag
      var mnd = turDato.getMonth() + 1;
      var aar = turDato.getFullYear();
      // Hvis startDag ikke stemmer med beregnet dato, bruk nærmeste dato med riktig dag
      turDato.setDate(startDag);
      // Sjekk at måneden er rimelig (kan være off-by-one ved ukeoverganger)
      if (Math.abs(turDato.getMonth() + 1 - mnd) > 1) turDato.setMonth(mnd - 1);
      kmap[tid2].dato = String(startDag).padStart(2,'0') + '.' + String(turDato.getMonth()+1).padStart(2,'0') + '.' + turDato.getFullYear();
      kmap[tid2].dager = dagerTekst;
      kmap[tid2].navn = tds2[3] ? tds2[3].textContent.trim() : trs2[i].textContent.replace(/\s+/g, ' ').trim().substring(0, 80);
    }
    var tids = Object.keys(kmap);
    // Vis kommende turneringer + gjennomførte i opptil 7 dager etter siste dag.
    // 'dato' er startdato (dd.MM.yyyy), 'dager' er dagintervall f.eks "28-30".
    var today = new Date(); today.setHours(0,0,0,0);
    var cutoff = new Date(today); cutoff.setDate(today.getDate() - 7);
    tids = tids.filter(function(tid) {
      var dato = kmap[tid].dato; // "dd.MM.yyyy"
      if (!dato) return true;
      var parts = dato.split('.');
      if (parts.length < 3) return true;
      var month = parseInt(parts[1]) - 1;
      var year = parseInt(parts[2]);
      // Finn siste dag fra 'dager' ("28-30" → 30, "28." → 28)
      var dager = kmap[tid].dager || '';
      var dayM = dager.match(/(\d+)\.?\s*[-–]\s*(\d+)/);
      var endDay = dayM ? parseInt(dayM[2]) : parseInt(parts[0]);
      var endDate = new Date(year, month, endDay);
      kmap[tid].isPast = (endDate < today);
      return endDate >= cutoff;
    });
    sett('Sjekker ' + tids.length + ' turneringer...');

    var playerKey = SN + '|' + SK;
    var lagrede = hentLagredeTurneringer(playerKey);

    // Legg til lagrede turneringer som APIet ikke returnerte
    Object.keys(lagrede).forEach(function(tid) {
      if (!kmap[tid]) kmap[tid] = lagrede[tid]._kmapInfo || {};
    });

    return Promise.all(tids.map(function(tid) {
      var info = kmap[tid];
      return hentAlleKlasser(tid).then(function(alleKlasser) {
        info.klasser = alleKlasser;
        return sjekkTurnering(tid, info);
      });
    })).then(function(resultater) {
      var aktive = resultater.filter(function(r) { return r !== null; });

      // Lagre alle turneringer med registreringer til localStorage
      aktive.forEach(function(t) {
        if (t.registreringer && t.registreringer.length > 0) {
          t._kmapInfo = kmap[t.tournamentId];
          lagreTurnering(playerKey, t);
        }
      });

      // Flett inn lagrede turneringer som ikke kom fra API denne gangen
      var aktiveTids = {};
      aktive.forEach(function(t) { aktiveTids[t.tournamentId] = true; });
      Object.keys(lagrede).forEach(function(tid) {
        if (!aktiveTids[tid]) {
          var lt = lagrede[tid];
          lt.isPast = true;
          aktive.push(lt);
        }
      });

      return aktive;
    });
  });
}

function hentAlleKlasser(tournamentId) {
  return appApi({ command: 18, unionid: 200, tournamentid: parseInt(tournamentId), commandversion: 6 })
    .then(function(data) {
      var results = data.searchresult || [];
      var klasser = [];
      for (var i = 0; i < results.length; i++) {
        var classId = results[i][1];
        var className = String(results[i][0] || '');
        if (classId && parseInt(classId) > 0) klasser.push({ id: String(classId), name: className });
      }
      return klasser.length > 0 ? klasser : [{ id: String(tournamentId), name: '' }];
    })
    .catch(function() { return [{ id: String(tournamentId), name: '' }]; });
}

function sjekkTurnering(tid, info) {
  var klasserMedSpiller = [];
  return Promise.all(info.klasser.map(function(kl) {
    var cid = kl.id || kl;  // bakoverkompatibel med bare-streng
    var klasseNavn = kl.name || '';
    var ageGroupM = klasseNavn.match(/^(U\d+|Senior|Junior|SEN)/i);
    var ageGroup = ageGroupM ? ageGroupM[1].toUpperCase() : '';
    return api('SearchRegistrationsByClass', {
      tournamentclassid: parseInt(cid),
      clientselectfunction: 'SelectTournamentClass1'
    }).then(function(res) {
      var html = String((res.d && res.d.Html) || '');
      if (html.indexOf(SI) === -1 && html.indexOf(SN) === -1) return [];
      var cupM = html.match(/cup2000\.dk[^\s"']*/i);
      if (cupM && !info.cup2000Url) info.cup2000Url = 'https://' + cupM[0];
      klasserMedSpiller.push(kl);
      return parseKlasse(html, ageGroup);
    }).catch(function() { return []; });
  })).then(function(alleRegs) {
    var regs = [];
    for (var i = 0; i < alleRegs.length; i++) {
      for (var j = 0; j < alleRegs[i].length; j++) regs.push(alleRegs[i][j]);
    }
    if (!regs.length) {
      if (info.isPast) return { tournamentId: tid, registreringer: [], navn: info.navn, dato: info.dato, dager: info.dager, cup2000Url: info.cup2000Url, klasser: klasserMedSpiller };
      return null;
    }
    return { tournamentId: tid, registreringer: regs, navn: info.navn, dato: info.dato, dager: info.dager, cup2000Url: info.cup2000Url, klasser: klasserMedSpiller };
  });
}

function parseKlasse(html, ageGroup) {
  ageGroup = ageGroup || '';
  var results = [];
  var dp = new DOMParser();
  var doc = dp.parseFromString(html, 'text/html');
  var h3s = doc.querySelectorAll('h3');
  for (var i = 0; i < h3s.length; i++) {
    var disiplin = h3s[i].textContent.trim();
    var table = h3s[i].nextElementSibling;
    if (!table) continue;
    var trs = table.querySelectorAll('tr');
    var candidateRows = [];
    for (var j = 0; j < trs.length; j++) {
      var tr = trs[j];
      var links = tr.querySelectorAll('a[href*="VisSpiller"]');
      var hasPlayer = false;
      var makkere = [];
      var isXmakker = tr.innerHTML.indexOf('X-makker') !== -1;
      for (var k = 0; k < links.length; k++) {
        var href = links[k].getAttribute('href') || '';
        var name = links[k].textContent.trim();
        if (href.indexOf('VisSpiller/#' + SI) !== -1 || name === SN) {
          hasPlayer = true;
        } else if (name) {
          // Hent klubbnavn fra tekstnoden etter </a>: ", Sotra"
          var klubbTxt = '';
          var sibling = links[k].nextSibling;
          if (sibling && sibling.nodeType === 3) {
            klubbTxt = sibling.textContent.replace(/^[,\s]+/, '').replace(/^br\s*\/?.*/i, '').trim();
          }
          makkere.push({ navn: name, klubb: klubbTxt });
        }
      }
      if (hasPlayer) {
        candidateRows.push({ makkere: makkere, isXmakker: isXmakker, tr: tr });
      }
    }
    if (candidateRows.length) {
      // Foretrekk rad med ekte makker fremfor X-makker
      var best = candidateRows.find(function(c) { return !c.isXmakker && c.makkere.length > 0; })
        || candidateRows.find(function(c) { return !c.isXmakker; })
        || candidateRows[0];
      var makkere = best.isXmakker && !best.makkere.length ? [{ navn: 'X-makker', klubb: '' }] : best.makkere;
      results.push({ disiplin: disiplin, makkere: makkere, bekreftet: best.tr.innerHTML.indexOf('checkmark.gif') !== -1, ageGroup: ageGroup });
    }
  }
  return results;
}

function hentMotstanderRanking(navn, disc, ageGroup, klubb) {
  var key = 'motrank:' + navn + '|' + disc + '|' + (ageGroup || '') + '|' + (klubb || '');
  var hit = cacheGet(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return api('SearchPlayer', {
    selectfunction: 'SP1', name: navn, clubid: '', playernumber: '',
    gender: '', agegroupid: '', searchteam: false, licenseonly: false,
    agegroupcontext: 0, tournamentdate: ''
  }).then(function(res) {
    var hmHtml = String((res.d && (res.d.Html || res.d.html)) || '');
    // Finn riktig spiller: foretrekk treff der klubb matcher
    var pidM = null;
    if (klubb) {
      var re2 = /SP1\('(\d+)'[^>]*>[^<]*<\/a>[^<]*,\s*([^<'"\n]{2,40})/g;
      var m2;
      while ((m2 = re2.exec(hmHtml)) !== null) {
        if (m2[2].toLowerCase().indexOf(klubb.toLowerCase().substring(0,5)) !== -1) {
          pidM = [null, m2[1]];
          break;
        }
      }
    }
    if (!pidM) pidM = hmHtml.match(/SP1\('(\d+)'/);
    if (!pidM) return null;
    return api('GetPlayerProfile', {
      seasonid: SS, playerid: pidM[1],
      getplayerdata: false, showUserProfile: true, showheader: false
    }).then(function(res2) {
      var html2 = String((res2.d && res2.d.Html) || '');
      var dp3 = new DOMParser();
      var doc3 = dp3.parseFromString(html2, 'text/html');
      var trs3 = doc3.querySelectorAll('table tr');
      var discKey = disc ? disc.toUpperCase().substring(0, 2) : '';
      // Bruker norsk stavemåte (Herresingel, ikke Herresingle)
      var discMap = {HS:'Herresingel',DS:'Damesingel',HD:'Herredouble',DD:'Damedouble',MD:'Mixeddouble'};
      var discFull = discMap[discKey] || '';
      // Normaliser ageGroup: "U15 A" → "U15", "SEN A" → "SEN"
      var ageGroupNorm = ageGroup ? ageGroup.replace(/\s+[A-Z]$/i, '').trim().toUpperCase() : '';
      var allMatches = [];
      for (var ri = 0; ri < trs3.length; ri++) {
        var tds3 = trs3[ri].querySelectorAll('td');
        if (tds3.length >= 2) {
          var cells3 = [];
          for (var rj = 0; rj < tds3.length; rj++) cells3.push(tds3[rj].textContent.trim());
          var last3 = cells3[cells3.length - 1];
          if (/^\d+$/.test(last3) && discFull && cells3[0].indexOf(discFull) !== -1) {
            allMatches.push({ plass: last3, rankingliste: cells3[0] });
          }
        }
      }
      // Hent fødselsår fra profilen
      var fodtM = html2.match(/dt<\/h2>\s*(\d{4})/i);
      var fodt = fodtM ? fodtM[1] : null;

      if (!allMatches.length) return fodt ? { plass: null, rankingliste: '', fodt: fodt } : null;
      if (ageGroupNorm) {
        var ageMatch = allMatches.find(function(m) { return m.rankingliste.toUpperCase().indexOf(ageGroupNorm) === 0; });
        if (ageMatch) { ageMatch.fodt = fodt; return ageMatch; }
      }
      // Fallback: første treff
      allMatches[0].fodt = fodt;
      return allMatches[0];
    });
  }).then(function(r) { return cacheSet(key, r); }).catch(function() { return cacheSet(key, null); });
}

function sett(tekst) {
  document.getElementById('st').textContent = tekst;
}

function visRanking(rows) {
  if (!rows || !rows.length) return;
  var res = document.getElementById('resultat');
  var sec = document.createElement('div');
  sec.className = 'sk-sek';
  sec.innerHTML = '<h3>Ranking</h3><div class="sk-grid" id="sk-rg"></div>';
  res.appendChild(sec);
  var grid = document.getElementById('sk-rg');
  for (var i = 0; i < rows.length; i++) {
    var c = document.createElement('div');
    c.className = 'sk-chip';
    var inner = '<div class="r-d">' + rows[i].disiplin + '</div>'
      + '<div class="r-k">' + rows[i].klasse + '</div>'
      + '<div class="r-p">#' + rows[i].plass + '</div>';
    var chipUrl = rows[i].url || 'https://badmintonportalen.no/NBF/Ranglister/';
    c.style.cursor = 'pointer';
    c.title = 'Åpne rankingliste';
    c.onclick = (function(url) { return function() { window.open(url, '_blank'); }; })(chipUrl);
    c.innerHTML = inner;
    grid.appendChild(c);
  }
}

function parseTid(tid) {
  if (!tid) return null;
  var m = tid.match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return null;
  var yr = new Date().getFullYear();
  return new Date(yr, parseInt(m[2])-1, parseInt(m[1]), parseInt(m[3]), parseInt(m[4]));
}

function formatTid(tid) {
  if (!tid) return '--:--';
  var m = tid.match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return tid;
  var now = new Date();
  if (parseInt(m[1]) === now.getDate() && parseInt(m[2]) === (now.getMonth()+1)) {
    return m[3] + ':' + m[4];
  }
  return tid;
}

function discTilKode(disc) {
  var d = (disc || '').toLowerCase();
  if (d.indexOf('mixed') !== -1) return 'MD';
  if (d.indexOf('herredouble') !== -1 || d.indexOf('herre double') !== -1) return 'HD';
  if (d.indexOf('damedouble') !== -1 || d.indexOf('dame double') !== -1) return 'DD';
  if (d.indexOf('herresingle') !== -1) return 'HS';
  if (d.indexOf('damesingle') !== -1) return 'DS';
  return disc ? disc.substring(0, 2).toUpperCase() : '';
}

function visTurnering(t) {
  var res = document.getElementById('resultat');
  var sec = document.createElement('div');
  sec.className = 'sk-sek';
  var _mnd = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
  var _dp = (t.dato || '').split('.');
  var _turDato = t.dager ? t.dager.replace(/\.\s*$/, '') + '. ' + (_dp[1] ? _mnd[parseInt(_dp[1])-1] : '') + (_dp[2] ? ' ' + _dp[2] : '') : (t.dato || '');
  sec.innerHTML = '<div class="sk-sek-banner"><h3>' + _turDato + ' \u2014 ' + (t.navn || 'Turnering') + '</h3></div>';
  res.appendChild(sec);
  var div = document.createElement('div');
  div.className = 'sk-t';
  var rh = '';
  for (var i = 0; i < t.registreringer.length; i++) {
    var r = t.registreringer[i];
    var makkerHtml = '';
    if (r.makkere.length) {
      if (r.makkere[0].navn === 'X-makker') {
        makkerHtml = '<span class="sk-makker">(uten makker)</span>';
      } else {
        var makkerNavn = r.makkere.map(function(m) {
          return '<span class="sk-mot-link" onclick="aapneMotstander(\'' + m.navn.replace(/'/g, "\\'") + '\',\'' + (m.klubb||'').replace(/'/g, "\\'") + '\')">' + m.navn + '</span>'
            + (m.klubb ? ' <span style="opacity:.7">(' + m.klubb + ')</span>' : '');
        }).join(', ');
        makkerHtml = '<span class="sk-makker">m ' + makkerNavn
          + ' <span class="sk-rank-mini" id="sk-mkr-' + t.tournamentId + '-' + i + '"></span></span>';
      }
    }
    rh += '<div class="sk-row">'
      + '<span class="sk-bk' + (r.bekreftet ? ' ok' : '') + '">' + (r.bekreftet ? 'OK' : '?') + '</span>'
      + '<span class="sk-disc">' + r.disiplin + '</span>'
      + makkerHtml
      + '</div>'
      + '<div id="sk-kl-' + t.tournamentId + '-' + i + '" class="sk-kamplist">'
      + '<div style="font-size:11px;color:#555;text-align:center;padding:2px 0">Laster kampprogram...</div>'
      + '</div>';
  }
  var fallbackBtn = t.cup2000Url ? '<a class="sk-btn" href="' + t.cup2000Url + '&search=1" target="_blank" style="margin-top:4px;font-size:11px;background:#0f3460">Åpne i Cup2000</a>' : '';
  if (!t.registreringer.length) {
    div.innerHTML = '<div id="sk-kl-past-' + t.tournamentId + '" class="sk-kamplist"><div style="font-size:11px;color:#555;text-align:center;padding:2px 0">Laster resultater...</div></div>' + fallbackBtn;
  } else {
    div.innerHTML = rh + fallbackBtn;
  }
  res.appendChild(div);

  // Hent ranking for makkere asynkront
  for (var mi = 0; mi < t.registreringer.length; mi++) {
    (function(reg, idx) {
      if (!reg.makkere.length || reg.makkere[0].navn === 'X-makker') return;
      var kode = discTilKode(reg.disiplin);
      // Bruk aldersgruppe fra turneringsklassen (f.eks. "U15" fra "U15 A"), fallback til olivers ranking
      var regAgeGroup = reg.ageGroup || '';
      if (!regAgeGroup) {
        var discMap2 = {HS:'Herresingle',DS:'Damesingle',HD:'Herredouble',DD:'Damedouble',MD:'Mixed'};
        var discFull2 = discMap2[kode] || '';
        var oliverRow = oliverRanking.find(function(r) { return discFull2 && r.disiplin.indexOf(discFull2) !== -1; });
        regAgeGroup = oliverRow ? (oliverRow.disiplin.match(/^(U\d+|Senior|Junior)/i) || ['',''])[1].toUpperCase() : '';
      }
      hentMotstanderRanking(reg.makkere[0].navn, kode, regAgeGroup).then(function(ranking) {
        if (!ranking) return;
        var el = document.getElementById('sk-mkr-' + t.tournamentId + '-' + idx);
        if (el) el.textContent = '#' + ranking.plass;
      });
    })(t.registreringer[mi], mi);
  }

  if (true) {
    cup2000Api(t.navn, t.cup2000Url).then(function(data) {
      var kamper = data && data.kamper ? data.kamper : (data && data.html ? parseKamper(data.html) : []);
      // Clear loading placeholders
      var pastKl = document.getElementById('sk-kl-past-' + t.tournamentId);
      if (pastKl) pastKl.innerHTML = '';
      for (var ci = 0; ci < t.registreringer.length; ci++) {
        var klc = document.getElementById('sk-kl-' + t.tournamentId + '-' + ci);
        if (klc) klc.innerHTML = '';
      }
      if (!kamper.length) {
        if (!t.registreringer.length) {
          // Past tournament stub with no cup2000 games — player wasn't in this tournament
          if (sec.parentNode) sec.parentNode.removeChild(sec);
          if (div.parentNode) div.parentNode.removeChild(div);
          return;
        }
        var vBtn = document.createElement('button');
        vBtn.className = 'sk-varsle-mini';
        vBtn.textContent = '\uD83D\uDD14 Varsle meg';
        (function(tnavn, tcup2000Url) {
          vBtn.onclick = function() { visVarsleSkjema(tnavn, tcup2000Url, sec); };
        })(t.navn, t.cup2000Url || '');
        var banner = sec.querySelector('.sk-sek-banner');
        if (banner) banner.appendChild(vBtn);
        return;
      }

      // Sorter kamper etter tidspunkt
      kamper.sort(function(a, b) { return (a.tid || '').localeCompare(b.tid || ''); });
      // Finn neste kamp (første uten resultat med fremtidig tid)
      var nowT = new Date();
      var nextKampIdx = -1;
      for (var ni = 0; ni < kamper.length; ni++) {
        if (!kamper[ni].res) { var ntd = parseTid(kamper[ni].tid); if (ntd && ntd > nowT) { nextKampIdx = ni; break; } }
      }

      // Bygg disc→regIdx-kart
      var discToRegIdx = {};
      for (var ri2 = 0; ri2 < t.registreringer.length; ri2++) {
        var rdc = discTilKode(t.registreringer[ri2].disiplin);
        if (!(rdc in discToRegIdx)) discToRegIdx[rdc] = ri2;
      }

      // Grupper kamper etter disc (normaliser til kode for å unngå duplikater på f.eks. "U13 Mixed Damer" vs "U15 Mixed Damer")
      var discGroups = {};
      for (var i = 0; i < kamper.length; i++) {
        var dc = discTilKode(kamper[i].disc) || kamper[i].disc || 'HS';
        if (!discGroups[dc]) discGroups[dc] = [];
        discGroups[dc].push(i); // index into sorted kamper
      }

      // Render inn i riktig reg-slot (eller pastKl for avsluttede turneringer)
      Object.keys(discGroups).forEach(function(dc) {
        var regIdx = discToRegIdx[dc];
        var kl = (regIdx !== undefined) ? document.getElementById('sk-kl-' + t.tournamentId + '-' + regIdx) : null;
        if (!kl && !pastKl) return;
        var entries = discGroups[dc];
        var kh = '';
        for (var j = 0; j < entries.length; j++) {
          var ki = entries[j];
          var k = kamper[ki];
          kh += '<div class="sk-kamp' + (ki === nextKampIdx ? ' sk-kamp-next' : '') + '">'
            + '<span class="sk-kamp-tid">' + formatTid(k.tid) + '</span>'
            + '<span class="sk-kamp-bane">' + (k.bane || '') + '</span>'
            + '<span class="sk-kamp-mot" id="sk-mot-' + t.tournamentId + '-' + ki + '">'
            + (function(kp, kpi) {
                var spillere = kp.motSpillere && kp.motSpillere.length > 1 ? kp.motSpillere : null;
                if (spillere) {
                  return spillere.map(function(s, si) {
                    return '<span id="sk-mot-' + t.tournamentId + '-' + kpi + '-p' + si
                      + '" class="sk-mot-link" onclick="aapneMotstander(\'' + s.navn.replace(/'/g, "\\'") + '\',\'' + (s.klubb||'').replace(/'/g, "\\'") + '\')">' + s.navn + '</span>';
                  }).join(' ');
                }
                return '<span class="sk-mot-link" onclick="aapneMotstander(\'' + (kp.mot||'').replace(/'/g, "\\'") + '\',\'' + (kp.motKlubb||'').replace(/'/g, "\\'") + '\')">' + (kp.mot || '') + '</span>';
              })(k, ki)
            + (k.motKlubb ? '<span class="sk-kamp-mot-sub">' + k.motKlubb + '</span>' : '')
            + '</span>'
            + (k.res ? '<span class="sk-kamp-res" style="' + (k.vant === true ? 'color:#7fffd4' : k.vant === false ? 'color:#e94560' : '') + '">' + k.res + '</span>' : '')
            + '</div>';
        }
        if (kl) {
          kl.innerHTML = kh;
          // Vis gruppe-knapp hvis vi har gruppedata for denne disiplinen
          if (data.grupper && data.grupper.length) {
            var g = null;
            for (var gi = 0; gi < data.grupper.length; gi++) { if (data.grupper[gi].disc === dc) { g = data.grupper[gi]; break; } }
            if (g) {
              g.klasser = t.klasser;
              var gruppeBtn = document.createElement('button');
              gruppeBtn.className = 'sk-gruppe-btn';
              gruppeBtn.textContent = '\uD83D\uDCCA Vis gruppe (' + g.spillere.length + ' spillere)';
              (function(gData) { gruppeBtn.onclick = function() { visGruppe(gData); }; })(g);
              kl.parentNode.insertBefore(gruppeBtn, kl.nextSibling);
            }
          }
        } else {
          var dcDiv = document.createElement('div');
          dcDiv.className = 'sk-disc-group';
          dcDiv.innerHTML = '<div class="sk-disc-header">' + dc + ' <span class="sk-disc-count">(' + entries.length + ')</span></div>' + kh;
          pastKl.appendChild(dcDiv);
        }
      });

      // Asynkron ranking for alle kamper
      for (var mi = 0; mi < kamper.length; mi++) {
        (function(kamp, idx) {
          if (!kamp.mot) return;
          var regAgeGroup = kamp.ageGroup || '';
          if (!regAgeGroup) {
            var discMap2 = {HS:'Herresingle',DS:'Damesingle',HD:'Herredouble',DD:'Damedouble',MD:'Mixed'};
            var dFull = discMap2[kamp.disc] || '';
            for (var ri = 0; ri < t.registreringer.length; ri++) {
              if (dFull && t.registreringer[ri].disiplin.indexOf(dFull) !== -1) {
                regAgeGroup = t.registreringer[ri].ageGroup || ''; break;
              }
            }
          }
          var spillere = kamp.motSpillere && kamp.motSpillere.length
            ? kamp.motSpillere
            : [{ navn: kamp.mot, klubb: kamp.motKlubb || '' }];
          spillere.forEach(function(spiller, si) {
            (function(sNavn, sKlubb, sIdx) {
              hentMotstanderRanking(sNavn, kamp.disc, regAgeGroup, sKlubb).then(function(ranking) {
                if (!ranking) return;
                var motEl;
                if (spillere.length > 1) {
                  motEl = document.getElementById('sk-mot-' + t.tournamentId + '-' + idx + '-p' + sIdx);
                } else {
                  motEl = document.getElementById('sk-mot-' + t.tournamentId + '-' + idx);
                }
                if (!motEl) return;
                  var bornChip = ranking.fodt ? document.createElement('span') : null;
                  if (bornChip) { bornChip.className = 'sk-born-mini'; bornChip.textContent = '(' + ranking.fodt + ')'; }
                  if (spillere.length > 1) {
                    if (ranking.plass) { var chip = document.createElement('span'); chip.className = 'sk-rank-mini'; chip.style.marginLeft = '3px'; chip.textContent = '#' + ranking.plass; motEl.appendChild(chip); }
                    if (bornChip) motEl.appendChild(bornChip);
                  } else {
                    var subSpan2 = motEl.querySelector('.sk-kamp-mot-sub');
                    if (ranking.plass) { var chip = document.createElement('span'); chip.className = 'sk-rank-mini'; chip.style.marginLeft = '3px'; chip.textContent = '#' + ranking.plass; motEl.insertBefore(chip, subSpan2); }
                    if (bornChip) motEl.insertBefore(bornChip, subSpan2);
                }
              });
            })(spiller.navn, spiller.klubb, si);
          });
        })(kamper[mi], mi);
      }
    });
  }
}

function parseKamper(html) {
  var dp = new DOMParser();
  var doc = dp.parseFromString(html, 'text/html');
  var kamper = [];
  var rows = doc.querySelectorAll('table tr');
  for (var i = 0; i < rows.length; i++) {
    var tds = rows[i].querySelectorAll('td');
    if (tds.length < 4) continue;
    var rowTxt = rows[i].textContent;
    if (rowTxt.indexOf(SN) === -1 && rowTxt.indexOf(SK) === -1) continue;
    var cells = [];
    for (var j = 0; j < tds.length; j++) cells.push(tds[j].textContent.trim());
    var tid = '', bane = '', disc = '', mot = '', res = '';
    for (var k = 0; k < cells.length; k++) {
      if (/^\d{2}:\d{2}$/.test(cells[k])) tid = cells[k];
      else if (/^[A-Za-z]\d+$/.test(cells[k]) || /^\d+$/.test(cells[k])) bane = cells[k];
      else if (/^(HS|DS|HD|DD|MD|MX)/i.test(cells[k])) disc = cells[k];
      else if (cells[k].length > 3 && cells[k].indexOf(SN) === -1 && cells[k] !== SK) mot = cells[k];
      else if (/\d+-\d+/.test(cells[k])) res = cells[k];
    }
    if (tid || mot) kamper.push({ tid: tid, bane: bane, disc: disc, mot: mot, res: res });
  }
  return kamper;
}

function visVarsleSkjema(tournamentNavn, cup2000Url, container) {
  // Bytt ut knappen med inline-skjema
  var lagretEpost = localStorage.getItem('sk_epost') || '';
  var form = document.createElement('div');
  form.className = 'sk-varsle-form';
  form.innerHTML = '<div style="font-size:11px;color:#aaa;margin-bottom:4px">Få e-post når kampprogram er tilgjengelig</div>'
    + '<input type="email" id="sk-varsle-epost" placeholder="din@epost.no" value="' + lagretEpost.replace(/"/g, '') + '">'
    + '<button class="sk-varsle-send" onclick="sendVarsel(this,\'' + tournamentNavn.replace(/'/g, "\\'") + '\',\'' + (cup2000Url||'').replace(/'/g, "\\'") + '\')">Send varsel</button>';
  // Fjern eksisterende varsle-knapper i denne containeren
  var existing = container.querySelectorAll('.sk-varsle-btn, .sk-varsle-mini, .sk-varsle-form');
  existing.forEach(function(el) { el.remove(); });
  container.appendChild(form);
  var inp = document.getElementById('sk-varsle-epost');
  if (inp) inp.focus();
}

function sendVarsel(btn, tournamentNavn, cup2000Url) {
  var inp = document.getElementById('sk-varsle-epost');
  var email = inp ? inp.value.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    inp && (inp.style.borderColor = '#e94560');
    return;
  }
  localStorage.setItem('sk_epost', email);
  btn.disabled = true;
  btn.textContent = 'Sender...';
  fetch(PROXY + '/varsle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, tournamentNavn: tournamentNavn, cup2000Url: cup2000Url || '', navn: SN, klubb: SK })
  }).then(function(r) { return r.json(); }).then(function(d) {
    var form = btn.closest('.sk-varsle-form');
    if (form) form.innerHTML = '<div style="font-size:12px;color:#7fffd4;padding:4px 0">\u2713 Vi varsler ' + email + ' når programmet er klart!</div>';
  }).catch(function() {
    btn.disabled = false;
    btn.textContent = 'Send varsel';
  });
}

function visGruppe(g) {
  var DISC_FULL = { HS: 'Herresingle', DS: 'Damesingle', HD: 'Herredouble', DD: 'Damedouble', MD: 'Mixed' };
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-gruppe-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkGruppe(); };

  var navnLower = SN.split(' ').pop().toLowerCase();

  function gruppefaseHTML() {
    var rows = g.spillere.map(function(s) {
      return '<tr class="' + (s.erMeg ? 'meg' : '') + '">'
        + '<td class="pos">' + s.pos + '</td>'
        + '<td>' + s.navn + (s.klubb ? '<br><span style="font-size:10px;color:#888">' + s.klubb + '</span>' : '') + '</td>'
        + '<td class="score">' + s.kV + '-' + s.kT + '</td>'
        + '<td class="score">' + s.sV + '-' + s.sT + '</td>'
        + '</tr>';
    }).join('');
    return '<div style="font-size:10px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Gruppefase</div>'
      + '<table class="sk-gruppe-tabell">'
      + '<thead><tr><th>#</th><th>Spiller</th><th>Kamp</th><th>Sett</th></tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  }

  function sluttresultatHTML(sluttRows) {
    var rows = sluttRows.map(function(s) {
      var erMeg = s.navn.toLowerCase().indexOf(navnLower) !== -1;
      return '<tr class="' + (erMeg ? 'meg' : '') + '">'
        + '<td class="pos">' + (s.plass || '') + '</td>'
        + '<td>' + s.navn + (s.klubb ? '<br><span style="font-size:10px;color:#888">' + s.klubb + '</span>' : '') + '</td>'
        + '<td class="score">' + (s.poeng ? s.poeng + 'p' : '') + '</td>'
        + '</tr>';
    }).join('');
    return '<div style="font-size:10px;color:#888;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.05em">Sluttresultat</div>'
      + '<table class="sk-gruppe-tabell">'
      + '<thead><tr><th>#</th><th>Spiller</th><th>Poeng</th></tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  }

  function oppdater(sluttRows) {
    var panel = overlay.querySelector('.sk-gruppe-panel');
    if (!panel) return;
    var content = gruppefaseHTML();
    if (sluttRows) content += sluttresultatHTML(sluttRows);
    panel.querySelector('.sk-gruppe-innhold').innerHTML = content;
  }

  overlay.innerHTML = '<div class="sk-gruppe-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">' + g.disc + ' ' + g.ageGroup + ' \u2014 Gruppestilling</span>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkGruppe()">\u2715</button>'
    + '</div>'
    + '<div class="sk-gruppe-innhold">' + gruppefaseHTML() + '</div>'
    + '</div>';
  document.body.appendChild(overlay);

  // Hent sluttresultat asynkront
  var kl = g.klasser && g.klasser.find(function(k) { return k.name === g.ageGroup; });
  if (!kl) return;
  api('SearchTournamentResults', {
    tournamentclassid: parseInt(kl.id),
    clientselectfunction: 'SelectTournamentClass1'
  }).then(function(res) {
    var html = String((res.d && res.d.Html) || '');
    if (!html) return;
    var doc3 = new DOMParser().parseFromString(html, 'text/html');
    var discFull = DISC_FULL[g.disc] || '';
    var h2s = doc3.querySelectorAll('h2');
    var targetTable = null;
    for (var hi = 0; hi < h2s.length; hi++) {
      if (h2s[hi].textContent.toLowerCase().indexOf(discFull.toLowerCase()) !== -1) {
        var next = h2s[hi].nextElementSibling;
        while (next && next.tagName !== 'TABLE') next = next.nextElementSibling;
        if (next) { targetTable = next; break; }
      }
    }
    if (!targetTable) return;
    var sluttRows = [];
    var trs3 = targetTable.querySelectorAll('tr:not(.headrow)');
    var lastPlass = '';
    for (var ri = 0; ri < trs3.length; ri++) {
      var playerCell = trs3[ri].querySelector('td.player');
      var pointsCell = trs3[ri].querySelector('td.points');
      var rankCell = trs3[ri].querySelector('td.rank');
      if (!playerCell) continue;
      var plass = rankCell ? rankCell.textContent.trim() : '';
      if (plass) lastPlass = plass;
      var pts = pointsCell ? pointsCell.textContent.trim() : '';
      var navn = playerCell.textContent.split(',')[0].trim();
      var klubb = (playerCell.textContent.split(',')[1] || '').trim();
      sluttRows.push({ plass: plass || lastPlass, navn: navn, klubb: klubb, poeng: pts });
    }
    if (sluttRows.length) oppdater(sluttRows);
  }).catch(function() {});
}

function lukkGruppe() {
  var el = document.getElementById('sk-gruppe-overlay');
  if (el) el.remove();
}

function aapneMotstander(navn, klubb) {
  document.getElementById('f-navn').value = navn;
  document.getElementById('f-klubb').value = klubb || '';
  window.scrollTo(0, 0);
  setTimeout(hent, 0);
}

function hent() {
  SN = document.getElementById('f-navn').value.trim();
  SK = document.getElementById('f-klubb').value.trim();

  if (!SN || !SK) { sett('Fyll inn navn og klubb.'); return; }

  lagre();

  var now0 = new Date();
  var seasonStart = now0.getMonth() >= 7 ? now0.getFullYear() : now0.getFullYear() - 1;
  SS = '200' + seasonStart;

  var btn = document.getElementById('hent-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Henter...';

  var res = document.getElementById('resultat');
  res.innerHTML = '<div class="sk-status" id="st">Søker etter spiller...</div>';

  sokSpiller(SN, SK).then(function(data) {
    if (data.error || !data.playerid) {
      sett('Fant ikke spiller: ' + SN + ' / ' + SK);
      btn.disabled = false;
      btn.textContent = '🔍 Hent spillerkort';
      return;
    }
    SI = data.playerid;
    sett('Henter spillerinfo...');
    return Promise.all([hentRanking(), finnTurneringer()]).then(function(d) {
      sett('');
      visRanking(d[0]);
      if (!d[1].length) {
        sett('Ingen kommende turneringer funnet.');
      } else {
        d[1].forEach(visTurnering);
      }
    });
  }).catch(function(e) {
    sett('Feil: ' + e.message);
  }).finally(function() {
    btn.disabled = false;
    btn.textContent = '🔍 Hent spillerkort';
  });
}

window.onload = function() {
  laster();
  var n = document.getElementById('f-navn').value;
  var k = document.getElementById('f-klubb').value;
  if (n && k) hent();
};
