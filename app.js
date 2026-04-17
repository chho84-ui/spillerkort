// ── Firebase ──────────────────────────────────────────────────────────────
var firebaseConfig = {
  apiKey: "AIzaSyBxavzk2kA1MHbYWhrEhlW9vcIm8wO691Q",
  authDomain: "goodminton-bb96a.firebaseapp.com",
  projectId: "goodminton-bb96a",
  storageBucket: "goodminton-bb96a.firebasestorage.app",
  messagingSenderId: "1051716838708",
  appId: "1:1051716838708:web:69dae8b305304e5af9f161"
};
firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();
var auth = firebase.auth();
var currentUser = null;
var _favoritter = {}; // cache: playerId -> true/false


auth.onAuthStateChanged(function(user) {
  currentUser = user;
  var loginBtn = document.getElementById('login-btn');
  var userInfo = document.getElementById('user-info');
  if (user) {
    loginBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    var avatar = document.getElementById('user-avatar');
    if (user.photoURL) {
      avatar.src = user.photoURL;
      avatar.style.display = '';
    } else {
      avatar.style.display = 'none';
    }
    var visNavn = user.displayName ? user.displayName.split(' ')[0] : (user.email ? user.email.split('@')[0] : '');
    document.getElementById('user-navn').textContent = visNavn;
    hentFavoritterCache();
  } else {
    loginBtn.style.display = '';
    userInfo.style.display = 'none';
    _favoritter = {};
  }
  oppdaterStjerneknapp();
});

var _authModus = 'login'; // 'login' eller 'register'

function aapneAuthModal() {
  _authModus = 'login';
  oppdaterAuthModal();
  document.getElementById('auth-modal').style.display = 'flex';
  document.getElementById('auth-epost').value = '';
  document.getElementById('auth-passord').value = '';
  document.getElementById('auth-feil').textContent = '';
  setTimeout(function() { document.getElementById('auth-epost').focus(); }, 50);
}

function lukkAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
}

function oppdaterAuthModal() {
  var erReg = _authModus === 'register';
  document.getElementById('auth-modal-tittel').textContent = erReg ? 'Opprett konto' : 'Logg inn';
  document.getElementById('auth-submit-btn').textContent = erReg ? 'Opprett konto' : 'Logg inn';
  document.getElementById('auth-bytt-tekst').textContent = erReg ? 'Har du allerede konto?' : 'Har du ikke konto?';
  document.querySelector('.auth-bytt button').textContent = erReg ? 'Logg inn' : 'Opprett konto';
  document.getElementById('auth-passord').autocomplete = erReg ? 'new-password' : 'current-password';
}

function byttAuthModus() {
  _authModus = _authModus === 'login' ? 'register' : 'login';
  oppdaterAuthModal();
  document.getElementById('auth-feil').textContent = '';
}

function authMedEpost() {
  var epost = document.getElementById('auth-epost').value.trim();
  var passord = document.getElementById('auth-passord').value;
  var feilEl = document.getElementById('auth-feil');
  var btn = document.getElementById('auth-submit-btn');
  if (!epost || !passord) { feilEl.textContent = 'Fyll inn e-post og passord.'; return; }
  btn.disabled = true;
  feilEl.textContent = '';
  var prom = _authModus === 'register'
    ? auth.createUserWithEmailAndPassword(epost, passord)
    : auth.signInWithEmailAndPassword(epost, passord);
  prom.then(function() {
    lukkAuthModal();
  }).catch(function(e) {
    var mld = { 'auth/email-already-in-use': 'E-posten er allerede i bruk.', 'auth/invalid-email': 'Ugyldig e-postadresse.', 'auth/weak-password': 'Passordet er for svakt (min. 6 tegn).', 'auth/user-not-found': 'Fant ingen konto med denne e-posten.', 'auth/wrong-password': 'Feil passord.', 'auth/invalid-credential': 'Feil e-post eller passord.' };
    feilEl.textContent = mld[e.code] || 'Noe gikk galt. Prøv igjen.';
  }).finally(function() { btn.disabled = false; });
}

function loggInn() {
  var modal = document.getElementById('auth-modal');
  if (modal) { aapneAuthModal(); return; }
  var provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(function(e) { console.error(e); });
}

function loggInnGoogle() {
  var provider = new firebase.auth.GoogleAuthProvider();
  lukkAuthModal();
  auth.signInWithPopup(provider).catch(function(e) { console.error(e); });
}

function loggUt() {
  auth.signOut();
}

function hentFavoritterCache() {
  if (!currentUser) return;
  db.collection('users').doc(currentUser.uid).collection('favoritter').get().then(function(snap) {
    _favoritter = {};
    snap.forEach(function(doc) { _favoritter[doc.id] = doc.data(); });
    oppdaterStjerneknapp();
  });
}

function erFavoritt(playerId) {
  return !!_favoritter[String(playerId)];
}

function toggleFavoritt() {
  if (!currentUser) { loggInn(); return; }
  if (!SI) return;
  var pid = String(SI);
  var ref = db.collection('users').doc(currentUser.uid).collection('favoritter').doc(pid);
  if (erFavoritt(pid)) {
    ref.delete().then(function() {
      delete _favoritter[pid];
      oppdaterStjerneknapp();
    });
  } else {
    var data = { navn: SN, klubb: SK, playerId: pid, lagtTil: firebase.firestore.FieldValue.serverTimestamp() };
    ref.set(data).then(function() {
      _favoritter[pid] = data;
      oppdaterStjerneknapp();
    });
  }
}

function lagreHistorikk(playerId, navn, klubb) {
  if (!currentUser) return;
  var pid = String(playerId);
  db.collection('users').doc(currentUser.uid).collection('historikk').doc(pid).set({
    navn: navn, klubb: klubb, playerId: pid,
    sistSokt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function oppdaterStjerneknapp() {
  var btn = document.getElementById('sk-stjerne-btn');
  if (!btn || !SI) return;
  var fav = erFavoritt(String(SI));
  btn.textContent = fav ? '★ Favoritt' : '☆ Lagre';
  btn.classList.toggle('er-favoritt', fav);
}

function visFavoritter() {
  if (!currentUser) { loggInn(); return; }
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-fav-overlay';
  overlay.innerHTML = '<div class="sk-gruppe-panel">'
    + '<div class="sk-gruppe-hdr"><span class="sk-gruppe-tittel">⭐ Favoritter</span>'
    + '<button class="sk-gruppe-xbtn" onclick="document.getElementById(\'sk-fav-overlay\').remove()">×</button></div>'
    + '<div id="sk-fav-liste"><div style="color:#888;font-size:12px;text-align:center;padding:16px">Laster...</div></div>'
    + '<div style="margin-top:12px;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.05em">Historikk</div>'
    + '<div id="sk-hist-liste"><div style="color:#888;font-size:12px;text-align:center;padding:8px">Laster...</div></div>'
    + '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

  var uid = currentUser.uid;
  db.collection('users').doc(uid).collection('favoritter').orderBy('lagtTil', 'desc').get().then(function(snap) {
    var el = document.getElementById('sk-fav-liste');
    if (!el) return;
    if (snap.empty) { el.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:8px">Ingen favoritter ennå</div>'; return; }
    el.innerHTML = snap.docs.map(function(doc) {
      var d = doc.data();
      return '<div class="sk-fav-rad" onclick="aapneMotstander(\'' + d.navn.replace(/'/g, "\\'") + '\',\'' + (d.klubb||'').replace(/'/g, "\\'") + '\');document.getElementById(\'sk-fav-overlay\').remove()">'
        + '<span class="sk-fav-navn">' + d.navn + '</span>'
        + '<span class="sk-fav-klubb">' + (d.klubb || '') + '</span>'
        + '</div>';
    }).join('');
  });

  db.collection('users').doc(uid).collection('historikk').orderBy('sistSokt', 'desc').limit(15).get().then(function(snap) {
    var el = document.getElementById('sk-hist-liste');
    if (!el) return;
    if (snap.empty) { el.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:8px">Ingen historikk ennå</div>'; return; }
    el.innerHTML = snap.docs.map(function(doc) {
      var d = doc.data();
      return '<div class="sk-fav-rad" onclick="aapneMotstander(\'' + d.navn.replace(/'/g, "\\'") + '\',\'' + (d.klubb||'').replace(/'/g, "\\'") + '\');document.getElementById(\'sk-fav-overlay\').remove()">'
        + '<span class="sk-fav-navn">' + d.navn + '</span>'
        + '<span class="sk-fav-klubb">' + (d.klubb || '') + '</span>'
        + '</div>';
    }).join('');
  });
}

// ── End Firebase ──────────────────────────────────────────────────────────

var PROXY = 'https://spillerkort-proxy.chho84.workers.dev';

var SN, SI, SK, SS;
var oliverRanking = [];
var _hentGen = 0;

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

// ── Autocomplete ──────────────────────────────────────────────────────────
var _acTimer = null;
var _acValgt = -1;
var _acSpillere = [];

function onNavnInput() {
  clearTimeout(_acTimer);
  var val = document.getElementById('f-navn').value.trim();
  if (val.length < 3) { lukkDropdown(); return; }
  _acTimer = setTimeout(function() { hentForslag(val); }, 300);
}

function onNavnKeydown(e) {
  var dd = document.getElementById('ac-dropdown');
  var items = dd.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _acValgt = Math.min(_acValgt + 1, items.length - 1);
    oppdaterValgt(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _acValgt = Math.max(_acValgt - 1, -1);
    oppdaterValgt(items);
  } else if (e.key === 'Enter' && _acValgt >= 0) {
    e.preventDefault();
    if (items[_acValgt]) items[_acValgt].click();
  } else if (e.key === 'Escape') {
    lukkDropdown();
  }
}

function oppdaterValgt(items) {
  items.forEach(function(el, i) { el.classList.toggle('ac-item-valgt', i === _acValgt); });
}

function hentForslag(navn) {
  fetch(PROXY + '/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ navn: navn, autocomplete: true })
  }).then(function(r) { return r.json(); }).then(function(d) {
    _acSpillere = d.players || [];
    visDropdown(_acSpillere);
  }).catch(function() {});
}

function visDropdown(spillere) {
  var dd = document.getElementById('ac-dropdown');
  if (!spillere.length) { lukkDropdown(); return; }
  _acValgt = -1;
  dd.innerHTML = spillere.map(function(s, i) {
    return '<div class="ac-item" onmousedown="velgSpiller(' + i + ')">'
      + '<span class="ac-navn">' + s.navn + '</span>'
      + '<span class="ac-klubb">' + (s.klubb || '') + '</span>'
      + '</div>';
  }).join('');
  dd.style.display = 'block';
}

function lukkDropdown() {
  var dd = document.getElementById('ac-dropdown');
  if (dd) dd.style.display = 'none';
  _acSpillere = [];
  _acValgt = -1;
}

function velgSpiller(idx) {
  var s = _acSpillere[idx];
  if (!s) return;
  document.getElementById('f-navn').value = s.navn;
  document.getElementById('f-klubb').value = s.klubb || '';
  lukkDropdown();
  SI = s.id;
  SN = s.navn;
  SK = s.klubb || '';
  hent();
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('#formkort')) lukkDropdown();
});
// ── End Autocomplete ──────────────────────────────────────────────────────

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

var CUP2000_TTL = 2 * 60 * 1000; // 2 min for live-score under turnering
function cup2000Api(tournamentNavn, cup2000Url) {
  var key = 'cup2000:' + tournamentNavn + '|' + SN;
  var e = _cache[key];
  if (e && (Date.now() - e.ts < CUP2000_TTL)) return Promise.resolve(e.val);
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

      // Flett inn lagrede turneringer som ikke kom fra API denne gangen.
      // Utelat turneringer som ble sjekket denne sessionen (tids) men ikke
      // fant spilleren — disse skal ikke gjenopplives fra localStorage.
      var aktiveTids = {};
      aktive.forEach(function(t) { aktiveTids[t.tournamentId] = true; });
      var sjekkdeTids = {};
      tids.forEach(function(tid) { sjekkdeTids[tid] = true; });
      Object.keys(lagrede).forEach(function(tid) {
        if (!aktiveTids[tid] && !sjekkdeTids[tid]) {
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
    if (!regs.length) return null;
    return { tournamentId: tid, registreringer: regs, navn: info.navn, dato: info.dato, dager: info.dager, cup2000Url: info.cup2000Url, klasser: klasserMedSpiller, isPast: !!info.isPast };
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
  var yr = new Date().getFullYear();
  // "DD-MM HH:MM"
  var m = tid.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(yr, parseInt(m[2])-1, parseInt(m[1]), parseInt(m[3]), parseInt(m[4]));
  // "HH:MM DD-MM" (gammelt cache-format)
  var m2 = tid.match(/^(\d{2}):(\d{2})\s+(\d{2})-(\d{2})/);
  if (m2) return new Date(yr, parseInt(m2[4])-1, parseInt(m2[3]), parseInt(m2[1]), parseInt(m2[2]));
  return null;
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
  var liveKnappHtml = t.isPast ? '' : ' <button class="sk-live-btn" id="sk-live-btn-' + t.tournamentId + '" onclick="visLive(\'' + t.tournamentId + '\',\'' + (t.navn||'').replace(/'/g,"\\'") + '\')">📋 Live</button>';
  sec.innerHTML = '<div class="sk-sek-banner"><h3>' + _turDato + ' \u2014 ' + (t.navn || 'Turnering') + '</h3>' + liveKnappHtml + '</div>';
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
  if (!t.registreringer.length || t.isPast) {
    div.innerHTML = '<div id="sk-kl-past-' + t.tournamentId + '" class="sk-kamplist"><div style="font-size:11px;color:#555;text-align:center;padding:2px 0">Laster resultater...</div></div>' + fallbackBtn;
  } else {
    div.innerHTML = rh + fallbackBtn;
  }
  res.appendChild(div);

  // Hent ranking for makkere asynkront (kun kommende turneringer)
  for (var mi = 0; mi < t.registreringer.length && !t.isPast; mi++) {
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
        if (!t.registreringer.length && t.isPast) {
          // Past tournament stub with no cup2000 games — player wasn't in this tournament
          if (sec.parentNode) sec.parentNode.removeChild(sec);
          if (div.parentNode) div.parentNode.removeChild(div);
          return;
        }
        if (t.isPast && t.klasser && t.klasser.length) {
          // Ingen cup2000-kamper, men turneringen er ferdig — hent resultater fra badmintonportalen
          var pastKlEl = document.getElementById('sk-kl-past-' + t.tournamentId);
          if (pastKlEl) pastKlEl.innerHTML = '<div style="font-size:11px;color:#555;text-align:center;padding:2px 0">Henter resultater...</div>';
          Promise.all(t.klasser.map(function(kl) {
            return api('SearchTournamentResults', {
              tournamentclassid: parseInt(kl.id),
              clientselectfunction: 'SelectTournamentClass1'
            }).then(function(res) {
              var html = String((res.d && res.d.Html) || '');
              if (!html) return null;
              var doc2 = new DOMParser().parseFromString(html, 'text/html');
              var h2s = doc2.querySelectorAll('h2');
              var resultatBlokker = [];
              h2s.forEach(function(h2) {
                var table = h2.nextElementSibling;
                while (table && table.tagName !== 'TABLE') table = table.nextElementSibling;
                if (!table) return;
                var rows = table.querySelectorAll('tr:not(.headrow)');
                var sistePlass = '', sistePoeng = '';
                rows.forEach(function(row) {
                  var playerCell = row.querySelector('td.player');
                  var rankCell = row.querySelector('td.rank');
                  var pointsCell = row.querySelector('td.points');
                  if (!playerCell) return;
                  var rankTekst = rankCell ? rankCell.textContent.trim() : '';
                  var poengTekst = pointsCell ? pointsCell.textContent.trim() : '';
                  if (rankTekst) sistePlass = rankTekst;
                  if (poengTekst) sistePoeng = poengTekst;
                  var playerText = playerCell.textContent || '';
                  if (playerText.toLowerCase().indexOf(SN.toLowerCase()) === -1) return;
                  var disc = h2.textContent.trim();
                  // For doubles: poeng kan stå på makkerens rad — bruk sistePoeng som fallback
                  resultatBlokker.push({ disc: disc, plass: sistePlass, poeng: poengTekst || sistePoeng });
                });
              });
              return resultatBlokker.length ? resultatBlokker : null;
            }).catch(function() { return null; });
          })).then(function(alleResultater) {
            var el = document.getElementById('sk-kl-past-' + t.tournamentId);
            if (!el) return;
            var alle = [];
            alleResultater.forEach(function(r) { if (r) r.forEach(function(b) { alle.push(b); }); });
            if (!alle.length) { el.innerHTML = ''; return; }
            var rh = '<div style="font-size:10px;color:#888;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Resultater</div>';
            alle.forEach(function(b) {
              rh += '<div class="sk-row">'
                + '<span class="sk-disc">' + b.disc + '</span>'
                + '<span style="margin-left:8px;color:#7fffd4;font-weight:bold">' + (b.plass ? '#' + b.plass : '') + '</span>'
                + (b.poeng ? '<span style="margin-left:6px;font-size:11px;color:#aaa">' + b.poeng + 'p</span>' : '')
                + '</div>';
            });
            el.innerHTML = rh;
          });
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
      kamper.sort(function(a, b) {
        var ta = parseTid(a.tid), tb = parseTid(b.tid);
        if (ta && tb) return ta - tb;
        return (a.tid || '').localeCompare(b.tid || '');
      });
      // Finn neste kamp (første uten resultat med fremtidig tid)
      var nowT = new Date();
      var nextKampIdx = -1;
      for (var ni = 0; ni < kamper.length; ni++) {
        if (!kamper[ni].res) { var ntd = parseTid(kamper[ni].tid); if (ntd && ntd > nowT) { nextKampIdx = ni; break; } }
      }

      // Bygg disc+ageGroup→regIdx-kart (skiller f.eks. U13 MD fra U15 MD)
      var discToRegIdx = {};
      for (var ri2 = 0; ri2 < t.registreringer.length; ri2++) {
        var rdc = discTilKode(t.registreringer[ri2].disiplin);
        var rag = (t.registreringer[ri2].ageGroup || '').toUpperCase();
        var fullKey = rdc + '|' + rag;
        if (!(fullKey in discToRegIdx)) discToRegIdx[fullKey] = ri2;
        // Fallback: bare disc-kode (for kamper uten ageGroup)
        if (!(rdc in discToRegIdx)) discToRegIdx[rdc] = ri2;
      }

      // Grupper kamper etter disc+ageGroup-nøkkel
      var discGroups = {};
      for (var i = 0; i < kamper.length; i++) {
        var dc = discTilKode(kamper[i].disc) || kamper[i].disc || 'HS';
        var ag = (kamper[i].ageGroup || '').toUpperCase();
        var groupKey = dc + '|' + ag;
        if (!discGroups[groupKey]) discGroups[groupKey] = [];
        discGroups[groupKey].push(i);
      }

      // Render inn i riktig reg-slot (eller pastKl for avsluttede turneringer)
      Object.keys(discGroups).forEach(function(groupKey) {
        var dc = groupKey.split('|')[0];
        // Prøv eksakt match (disc+ageGroup), fall tilbake til bare disc
        var regIdx = (groupKey in discToRegIdx) ? discToRegIdx[groupKey] : discToRegIdx[dc];
        var kl = (regIdx !== undefined) ? document.getElementById('sk-kl-' + t.tournamentId + '-' + regIdx) : null;
        if (!kl && !pastKl) return;
        var entries = discGroups[groupKey];
        var kh = '';
        var _dager = ['søn','man','tir','ons','tor','fre','lør'];
        var _mndK = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
        var lastDag = null, visteSluttspill = false;
        for (var j = 0; j < entries.length; j++) {
          var ki = entries[j];
          var k = kamper[ki];
          // Parser tid-streng: støtter "DD-MM HH:MM" (worker) og "HH:MM" (parseKamper)
          var tidDato = null, tidKl = '--:--';
          if (k.tid) {
            // "DD-MM HH:MM" (worker, nytt format)
            var _tm = k.tid.match(/^(\d{2}-\d{2})\s+(\d{2}:\d{2})/);
            if (_tm) { tidDato = _tm[1]; tidKl = _tm[2]; }
            // "HH:MM DD-MM" (worker, gammelt format i cache)
            else { var _tm2 = k.tid.match(/^(\d{2}:\d{2})\s+(\d{2}-\d{2})/);
            if (_tm2) { tidDato = _tm2[2]; tidKl = _tm2[1]; }
            // "HH:MM" kun (fra HTML-parsing)
            else if (/^\d{2}:\d{2}/.test(k.tid)) { tidKl = k.tid.substring(0, 5); } }
          }
          // Sluttspill-separator (vises én gang før første sluttspill-kamp)
          if (k.sluttspill && !visteSluttspill) {
            visteSluttspill = true;
            kh += '<div class="sk-dag-sep sk-dag-sep-sluttspill">Sluttspill</div>';
          }
          // Dagseparator når datoen skifter
          if (tidDato && tidDato !== lastDag) {
            lastDag = tidDato;
            var _dp = tidDato.split('-');
            var _d = parseInt(_dp[0]), _mo = parseInt(_dp[1]);
            var _dt = new Date(new Date().getFullYear(), _mo - 1, _d);
            var _dagNavn = _dager[_dt.getDay()] + ' ' + _d + '. ' + _mndK[_mo - 1];
            kh += '<div class="sk-dag-sep">' + _dagNavn + '</div>';
          }
          kh += '<div class="sk-kamp' + (ki === nextKampIdx ? ' sk-kamp-next' : '') + (k.sluttspill ? ' sk-kamp-sluttspill' : '') + '">'
            + '<span class="sk-kamp-tid">' + tidKl + '</span>'
            + '<span class="sk-kamp-bane">' + (k.bane || '') + '</span>'
            + '<span class="sk-kamp-mot" id="sk-mot-' + t.tournamentId + '-' + ki + '">'
            + (function(kp, kpi) {
                if ((kp.mot || '').indexOf('Vinner av ') === 0) {
                  return '<span style="font-size:11px;color:#888;font-style:italic">' + kp.mot + '</span>';
                }
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
          kl.innerHTML += kh;
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

var LIVE_TTL = 30 * 1000; // 30 sek cache for live-data
function cup2000LiveApi(tournamentNavn) {
  var key = 'live:' + tournamentNavn;
  var e = _cache[key];
  if (e && (Date.now() - e.ts < LIVE_TTL)) return Promise.resolve(e.val);
  return fetch(PROXY + '/cup2000live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tournamentNavn: tournamentNavn, navn: SN, klubb: SK })
  }).then(function(r) { return r.json(); }).then(function(d) { return cacheSet(key, d); });
}

function visLive(tournamentId, tournamentNavn) {
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-live-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkLive(); };

  overlay.innerHTML = '<div class="sk-gruppe-panel sk-live-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">📋 Kamper nå</span>'
    + '<button class="sk-live-refresh-btn" id="sk-live-refresh" onclick="oppdaterLive(\'' + tournamentNavn.replace(/'/g, "\\'") + '\')">↻</button>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkLive()">✕</button>'
    + '</div>'
    + '<div id="sk-live-innhold" style="font-size:12px;color:#888;text-align:center;padding:20px">Laster...</div>'
    + '</div>';
  document.body.appendChild(overlay);

  cup2000LiveApi(tournamentNavn).then(renderLiveInnhold).catch(function() {
    var innhold = document.getElementById('sk-live-innhold');
    if (innhold) innhold.innerHTML = '<div style="color:#e94560;font-size:12px;text-align:center;padding:16px">Kunne ikke hente data</div>';
  });
}

function renderLiveInnhold(data) {
  var innhold = document.getElementById('sk-live-innhold');
  if (!innhold) return;
  var kamper = data && data.kamper ? data.kamper : [];
  if (!kamper.length) {
    innhold.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:16px">Ingen kamper tilgjengelig</div>';
    return;
  }

  // Grupper etter bane
  var baneMap = {}, baneRekkefølge = [];
  for (var i = 0; i < kamper.length; i++) {
    var b = String(kamper[i].bane || '?');
    if (!baneMap[b]) { baneMap[b] = []; baneRekkefølge.push(b); }
    baneMap[b].push(kamper[i]);
  }

  var html = '';
  for (var bi = 0; bi < baneRekkefølge.length; bi++) {
    var bane = baneRekkefølge[bi];
    var baneKamper = baneMap[bane];
    html += '<div class="sk-live-bane"><div class="sk-live-bane-hdr">Bane ' + bane + '</div>';

    for (var ki = 0; ki < baneKamper.length; ki++) {
      var k = baneKamper[ki];
      var isLive = k.status === 'live';
      var isNext = k.status === 'next';
      var foerAntall = typeof k.status === 'number' ? k.status : null;

      var statusHtml = '';
      if (isLive) statusHtml = '<span class="sk-live-status-live">● LIVE</span>';
      else if (isNext) statusHtml = '<span class="sk-live-status-next">NESTE</span>';
      else if (foerAntall !== null) statusHtml = '<span class="sk-live-status-kø">' + foerAntall + ' før</span>';

      var scoreHtml = '';
      if (k.score && k.score.length) {
        scoreHtml = '<div class="sk-live-score">'
          + k.score.map(function(s) { return '<span>' + s[0] + '<em>–</em>' + s[1] + '</span>'; }).join(' ')
          + '</div>';
      }

      var sp1 = (k.spiller1 || []).map(function(s) { return s.navn; }).join(' / ');
      var sp2 = (k.spiller2 || []).map(function(s) { return s.navn; }).join(' / ');

      html += '<div class="sk-live-kamp' + (k.mine ? ' sk-live-kamp-mine' : '') + (isLive ? ' sk-live-kamp-live' : '') + '">'
        + '<div class="sk-live-kamp-top">'
        + '<span class="sk-live-disc">' + (k.disc || '') + ' ' + (k.ageGroup || '') + '</span>'
        + statusHtml
        + '<span class="sk-live-tid">' + (k.tid ? k.tid.substring(0,5) : '') + '</span>'
        + '</div>'
        + '<div class="sk-live-sp' + (k.mine ? ' sk-live-sp-mine' : '') + '">' + sp1 + '</div>'
        + '<div class="sk-live-vs">vs</div>'
        + '<div class="sk-live-sp">' + sp2 + '</div>'
        + scoreHtml
        + '</div>';
    }
    html += '</div>';
  }
  innhold.innerHTML = html;
}

function oppdaterLive(tournamentNavn) {
  delete _cache['live:' + tournamentNavn];
  var btn = document.getElementById('sk-live-refresh');
  if (btn) { btn.textContent = '↻'; btn.disabled = true; }
  var innhold = document.getElementById('sk-live-innhold');
  if (innhold) innhold.innerHTML = '<div style="font-size:12px;color:#888;text-align:center;padding:20px">Laster...</div>';
  cup2000LiveApi(tournamentNavn).then(function(data) {
    renderLiveInnhold(data);
    if (btn) { btn.disabled = false; }
  }).catch(function() {
    if (innhold) innhold.innerHTML = '<div style="color:#e94560;font-size:12px;text-align:center;padding:16px">Kunne ikke hente data</div>';
    if (btn) btn.disabled = false;
  });
}

function lukkLive() {
  var el = document.getElementById('sk-live-overlay');
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

  var gen = ++_hentGen;

  var now0 = new Date();
  var seasonStart = now0.getMonth() >= 7 ? now0.getFullYear() : now0.getFullYear() - 1;
  SS = '200' + seasonStart;

  var btn = document.getElementById('hent-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Henter...';

  var res = document.getElementById('resultat');
  res.innerHTML = '<div class="sk-status" id="st">Søker etter spiller...</div>';

  sokSpiller(SN, SK).then(function(data) {
    if (gen !== _hentGen) return;
    if (data.error || !data.playerid) {
      sett('Fant ikke spiller: ' + SN + ' / ' + SK);
      btn.disabled = false;
      btn.textContent = '🔍 Hent spillerkort';
      return;
    }
    SI = data.playerid;
    lagreHistorikk(SI, SN, SK);
    sett('Henter spillerinfo...');
    return Promise.all([hentRanking(), finnTurneringer()]).then(function(d) {
      if (gen !== _hentGen) return;
      sett('');
      // Stjerneknapp
      var res2 = document.getElementById('resultat');
      var stjerneDiv = document.createElement('div');
      stjerneDiv.style.cssText = 'text-align:right;margin-bottom:6px';
      stjerneDiv.innerHTML = '<button id="sk-stjerne-btn" class="sk-stjerne-btn" onclick="toggleFavoritt()">☆ Lagre</button>';
      res2.insertBefore(stjerneDiv, res2.firstChild);
      oppdaterStjerneknapp();
      visRanking(d[0]);
      if (!d[1].length) {
        sett('Ingen kommende turneringer funnet.');
      } else {
        d[1].forEach(visTurnering);
      }
    });
  }).catch(function(e) {
    if (gen !== _hentGen) return;
    sett('Feil: ' + e.message);
  }).finally(function() {
    if (gen === _hentGen) {
      btn.disabled = false;
      btn.textContent = '🔍 Hent spillerkort';
    }
  });
}

window.onload = function() {
  laster();
  var n = document.getElementById('f-navn').value;
  var k = document.getElementById('f-klubb').value;
  if (n && k) hent();
};
