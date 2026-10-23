function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttrJs(s) { return esc(String(s == null ? '' : s).replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }

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
auth.languageCode = 'no'; // e-poster for nytt passord og innloggingslenke på norsk
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
    hentPreferanser();
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
  // Venter en innloggingslenke (sendt fra denne enheten), vises feltet for å lime den inn.
  var venter = null;
  try { venter = localStorage.getItem(LENKE_EPOST); } catch(e) {}
  document.getElementById('auth-epost').value = venter || '';
  document.getElementById('auth-passord').value = '';
  document.getElementById('auth-lim-felt').value = '';
  visLimFelt(!!venter);
  authMelding('');
  setTimeout(function() { document.getElementById(venter ? 'auth-lim-felt' : 'auth-epost').focus(); }, 50);
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
  document.getElementById('auth-glemt-btn').style.display = erReg ? 'none' : '';
}

function byttAuthModus() {
  _authModus = _authModus === 'login' ? 'register' : 'login';
  oppdaterAuthModal();
  authMelding('');
}

function authMedEpost() {
  var epost = document.getElementById('auth-epost').value.trim();
  var passord = document.getElementById('auth-passord').value;
  var btn = document.getElementById('auth-submit-btn');
  if (!epost || !passord) { authMelding('Fyll inn e-post og passord.'); return; }
  btn.disabled = true;
  authMelding('');
  var prom = _authModus === 'register'
    ? auth.createUserWithEmailAndPassword(epost, passord)
    : auth.signInWithEmailAndPassword(epost, passord);
  prom.then(function() {
    lukkAuthModal();
  }).catch(function(e) {
    authMelding(authFeiltekst(e));
  }).finally(function() { btn.disabled = false; });
}

function authMelding(tekst, ok) {
  var el = document.getElementById('auth-feil');
  el.textContent = tekst || '';
  el.classList.toggle('ok', !!ok);
}

function authFeiltekst(e) {
  var mld = {
    'auth/email-already-in-use': 'E-posten er allerede i bruk.',
    'auth/invalid-email': 'Ugyldig e-postadresse.',
    'auth/missing-email': 'Skriv inn e-posten din.',
    'auth/weak-password': 'Passordet er for svakt (min. 6 tegn).',
    'auth/user-not-found': 'Fant ingen konto med denne e-posten.',
    'auth/wrong-password': 'Feil passord.',
    'auth/invalid-credential': 'Feil e-post eller passord.',
    'auth/too-many-requests': 'For mange forsøk. Vent litt og prøv igjen.',
    'auth/operation-not-allowed': 'Denne innloggingsmåten er ikke slått på ennå.',
    'auth/unauthorized-continue-uri': 'Domenet er ikke godkjent for innlogging.',
    'auth/unauthorized-domain': 'Domenet er ikke godkjent for innlogging.',
    'auth/invalid-action-code': 'Lenken er utløpt eller allerede brukt. Be om en ny.',
    'auth/invalid-email-link': 'Lenken er utløpt eller allerede brukt. Be om en ny.',
    'auth/expired-action-code': 'Lenken er utløpt. Be om en ny.'
  };
  if (e && e.code && !mld[e.code]) console.error(e);
  return (e && mld[e.code]) || 'Noe gikk galt. Prøv igjen.';
}

function epostFraModal() {
  var felt = document.getElementById('auth-epost');
  var epost = felt.value.trim();
  if (!epost) { authMelding('Skriv inn e-posten din først.'); felt.focus(); }
  return epost;
}

function glemtPassord() {
  var epost = epostFraModal();
  if (!epost) return;
  authMelding('Sender...', true);
  auth.sendPasswordResetEmail(epost).then(function() {
    // Firebase sier ikke om kontoen finnes (vern mot oppslag av e-poster).
    authMelding('Finnes det en konto med denne e-posten, får du en lenke for å lage nytt passord. Sjekk også søppelpost.', true);
  }).catch(function(e) { authMelding(authFeiltekst(e)); });
}

// Innlogging uten passord: Firebase sender en lenke som går via firebaseapp.com og
// tilbake hit med ?mode=signIn&oobCode=…. E-posten huskes lokalt så vi slipper å spørre
// når lenken åpnes på samme enhet.
var LENKE_EPOST = 'sk_lenke_epost';

function sendInnloggingslenke() {
  var epost = epostFraModal();
  if (!epost) return;
  authMelding('Sender...', true);
  auth.sendSignInLinkToEmail(epost, { url: location.origin + location.pathname, handleCodeInApp: true }).then(function() {
    try { localStorage.setItem(LENKE_EPOST, epost); } catch(e) {}
    authMelding('Lenke sendt til ' + epost + '. Sjekk også søppelpost.', true);
    visLimFelt(true);
  }).catch(function(e) { authMelding(authFeiltekst(e)); });
}

// E-postapper (Gmail, Outlook …) åpner lenker i sin egen nettleser, og appen på
// hjemskjermen har egen lagring – da havner innloggingen feil sted. Lenken kan i stedet
// kopieres og limes inn her, så innloggingen skjer i appen.
function visLimFelt(vis) {
  document.getElementById('auth-lim').style.display = vis ? '' : 'none';
}

function pakkUtLenke(lenke) {
  // Gmail og andre pakker iblant lenker inn i en videresending (google.com/url?q=…).
  for (var i = 0; i < 3 && !auth.isSignInWithEmailLink(lenke); i++) {
    var m = lenke.match(/[?&](?:q|url|u|link)=([^&]+)/);
    if (!m) break;
    try { lenke = decodeURIComponent(m[1]); } catch(e) { break; }
  }
  return lenke;
}

function loggInnMedLimtLenke() {
  var lenke = pakkUtLenke(document.getElementById('auth-lim-felt').value.trim());
  if (!lenke || !auth.isSignInWithEmailLink(lenke)) {
    authMelding('Det ser ikke ut som innloggingslenken. Kopier hele lenken fra e-posten.');
    return;
  }
  var epost = document.getElementById('auth-epost').value.trim();
  if (!epost) { try { epost = localStorage.getItem(LENKE_EPOST) || ''; } catch(e) {} }
  if (!epost) { authMelding('Skriv inn e-posten du ba om lenken til.'); document.getElementById('auth-epost').focus(); return; }
  var btn = document.getElementById('auth-lim-btn');
  btn.disabled = true;
  authMelding('Logger inn...', true);
  auth.signInWithEmailLink(epost, lenke).then(function() {
    try { localStorage.removeItem(LENKE_EPOST); } catch(e) {}
    lukkAuthModal();
  }).catch(function(e) {
    authMelding(authFeiltekst(e));
  }).finally(function() { btn.disabled = false; });
}

function fullforLenkeInnlogging() {
  var lenke = location.href;
  if (!auth.isSignInWithEmailLink(lenke)) return;
  // Engangskoden skal ikke bli liggende i adresselinjen, historikken eller et bokmerke.
  history.replaceState(null, '', location.pathname);
  var epost = null;
  try { epost = localStorage.getItem(LENKE_EPOST); } catch(e) {}
  if (!epost) epost = (prompt('Bekreft e-posten du ba om innloggingslenke til:') || '').trim();
  if (!epost) return;
  auth.signInWithEmailLink(epost, lenke).then(function() {
    try { localStorage.removeItem(LENKE_EPOST); } catch(e) {}
  }).catch(function(e) {
    aapneAuthModal();
    document.getElementById('auth-epost').value = epost;
    authMelding(authFeiltekst(e));
  });
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
  if (confirm('Vil du logge ut?')) auth.signOut();
}

// ── Preferanser ──────────────────────────────────────────────────────────
// Terminliste-filteret huskes alltid lokalt. Er man innlogget, lagres det også
// på kontoen (users/{uid}/innstillinger/terminliste) og følger med til andre enheter.
function terminPref() {
  var p = null;
  try { p = JSON.parse(localStorage.getItem('sk_termin_pref') || 'null'); } catch(e) {}
  return p && typeof p === 'object' ? p : {};
}

function lagreTerminPref(alder, krets) {
  var p = { alder: alder, krets: krets };
  try { localStorage.setItem('sk_termin_pref', JSON.stringify(p)); } catch(e) {}
  if (!currentUser) return;
  db.collection('users').doc(currentUser.uid).collection('innstillinger').doc('terminliste')
    .set(p).catch(function(e) { console.warn('Kunne ikke lagre preferanser', e); });
}

function hentPreferanser() {
  if (!currentUser) return;
  db.collection('users').doc(currentUser.uid).collection('innstillinger').doc('terminliste').get().then(function(doc) {
    if (doc.exists) {
      var d = doc.data() || {};
      try { localStorage.setItem('sk_termin_pref', JSON.stringify({ alder: d.alder || '0', krets: d.krets || '' })); } catch(e) {}
    } else {
      // Første innlogging: valget fra denne enheten blir kontoens standard.
      var lokal = terminPref();
      if (lokal.alder || lokal.krets) lagreTerminPref(lokal.alder || '0', lokal.krets || '');
    }
  }).catch(function(e) { console.warn('Kunne ikke hente preferanser', e); });
}

function hentFavoritterCache() {
  if (!currentUser) return;
  db.collection('users').doc(currentUser.uid).collection('favoritter').get().then(function(snap) {
    _favoritter = {};
    snap.forEach(function(doc) { _favoritter[doc.id] = doc.data(); });
    oppdaterStjerneknapp();
    visHurtigvalg();
  });
}

// ── Hurtigvalg-chips (favoritter + sist brukte) i infoboksen ──────────────
function lagreSiste(navn, klubb) {
  var liste = [];
  try { liste = JSON.parse(localStorage.getItem('sk_siste') || '[]'); } catch(e) {}
  liste = liste.filter(function(p) { return p && p.navn && p.navn.toLowerCase() !== navn.toLowerCase(); });
  liste.unshift({ navn: navn, klubb: klubb || '' });
  if (liste.length > 5) liste = liste.slice(0, 5);
  try { localStorage.setItem('sk_siste', JSON.stringify(liste)); } catch(e) {}
}

function visHurtigvalg() {
  var boks = document.getElementById('infoboks');
  if (!boks) return;
  var siste = [];
  try { siste = JSON.parse(localStorage.getItem('sk_siste') || '[]'); } catch(e) {}
  var chips = [];
  var sett = {};
  Object.keys(_favoritter).forEach(function(k) {
    var f = _favoritter[k];
    if (!f || !f.navn) return;
    var n = f.navn.toLowerCase();
    if (!sett[n]) { sett[n] = 1; chips.push({ navn: f.navn, klubb: f.klubb || '', fav: true }); }
  });
  siste.forEach(function(s) {
    if (!s || !s.navn) return;
    var n = s.navn.toLowerCase();
    if (!sett[n]) { sett[n] = 1; chips.push({ navn: s.navn, klubb: s.klubb || '', fav: false }); }
  });
  if (!chips.length) return; // ingen historikk — behold intro-teksten
  chips = chips.slice(0, 8);
  boks.innerHTML = '';
  var rad = document.createElement('div');
  rad.className = 'hurtig-rad';
  chips.forEach(function(c) {
    var chip = document.createElement('button');
    chip.className = 'hurtig-chip' + (c.fav ? ' hurtig-chip-fav' : '');
    chip.textContent = (c.fav ? '★ ' : '') + c.navn;
    chip.onclick = function() { aapneMotstander(c.navn, c.klubb); };
    rad.appendChild(chip);
  });
  boks.appendChild(rad);
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
  var tittel = fav ? 'Fjern fra favoritter' : 'Lagre som favoritt';
  btn.textContent = fav ? '★' : '☆';
  btn.title = tittel;
  btn.setAttribute('aria-label', tittel);
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
      return '<div class="sk-fav-rad" onclick="aapneMotstander(\'' + escAttrJs(d.navn) + '\',\'' + escAttrJs(d.klubb||'') + '\');document.getElementById(\'sk-fav-overlay\').remove()">'
        + '<span class="sk-fav-navn">' + esc(d.navn) + '</span>'
        + '<span class="sk-fav-klubb">' + esc(d.klubb || '') + '</span>'
        + '</div>';
    }).join('');
  });

  db.collection('users').doc(uid).collection('historikk').orderBy('sistSokt', 'desc').limit(15).get().then(function(snap) {
    var el = document.getElementById('sk-hist-liste');
    if (!el) return;
    if (snap.empty) { el.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:8px">Ingen historikk ennå</div>'; return; }
    el.innerHTML = snap.docs.map(function(doc) {
      var d = doc.data();
      return '<div class="sk-fav-rad" onclick="aapneMotstander(\'' + escAttrJs(d.navn) + '\',\'' + escAttrJs(d.klubb||'') + '\');document.getElementById(\'sk-fav-overlay\').remove()">'
        + '<span class="sk-fav-navn">' + esc(d.navn) + '</span>'
        + '<span class="sk-fav-klubb">' + esc(d.klubb || '') + '</span>'
        + '</div>';
    }).join('');
  });
}

// ── End Firebase ──────────────────────────────────────────────────────────

var PROXY = 'https://spillerkort-proxy.chho84.workers.dev';
var VAPID_PUBLIC_KEY = 'BF3Tug5KZcXIB2kgpJDdgjx9lbL9R9L6SQHFvHbkktdmwxKWLldKyDP9OIu5pjM1Cpvl6jkMIMKJiTXS2t-PM2U';

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

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
      + '<span class="ac-navn">' + esc(s.navn) + '</span>'
      + '<span class="ac-klubb">' + esc(s.klubb || '') + '</span>'
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

// fersk = true: workeren hopper over sin cache (for data som kan endre seg under en turnering).
function api(method, data, fersk) {
  return fetch(PROXY + '/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: method, data: data, fersk: !!fersk })
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
      // Badmintonportalen bruker U+2011 non-breaking hyphen i dagintervallet ("19.‑20."),
      // ikke ASCII-bindestrek. Uten hele dash-spekteret her faller endDay tilbake til
      // startdagen, og pågående turneringer blir feilaktig markert som ferdigspilt.
      var dayM = dager.match(/(\d+)\.?\s*[-\u2010-\u2015\u2212]\s*(\d+)/);
      var startDag = parseInt(parts[0]);
      var endDay = dayM ? parseInt(dayM[2]) : startDag;
      // 'dager' er kun dagtall, s\u00e5 en turnering over m\u00e5nedsskiftet ser ut som "30.\u201101.".
      // Uten m\u00e5nedsrulling havner sluttdatoen en m\u00e5ned for tidlig, og turneringen
      // b\u00e5de merkes som ferdig og filtreres bort mens den p\u00e5g\u00e5r.
      var endDate = new Date(year, month + (endDay < startDag ? 1 : 0), endDay);
      var startDate = new Date(year, month, startDag);
      kmap[tid].isPast = (endDate < today);
      kmap[tid].harStartet = (startDate <= today);
      return endDate >= cutoff;
    });
    sett('Sjekker ' + tids.length + ' turneringer...');
    _turFeilet = 0;

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
          lt.harStartet = true;
          aktive.push(lt);
        }
      });

      return aktive;
    });
  });
}

// Oppslag mot badmintonportalen kan feile når mange turneringer sjekkes samtidig. Workeren
// svarer da med { error } (HTTP 500), som før ble lest som «ingen påmeldinger» – turneringen
// forsvant stille. Nå prøves det én gang til, og det som fortsatt feiler telles i _turFeilet.
var _turFeilet = 0;

function medNyttForsok(fn) {
  return fn().catch(function() {
    return new Promise(function(r) { setTimeout(r, 800); }).then(fn);
  });
}

function hentAlleKlasser(tournamentId) {
  return medNyttForsok(function() {
    return appApi({ command: 18, unionid: 200, tournamentid: parseInt(tournamentId), commandversion: 6 })
      .then(function(data) {
        if (!data || data.error) throw new Error('klasser');
        return data;
      });
  })
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
    .catch(function() { _turFeilet++; return [{ id: String(tournamentId), name: '' }]; });
}

function sjekkTurnering(tid, info) {
  var klasserMedSpiller = [];
  return Promise.all(info.klasser.map(function(kl) {
    var cid = kl.id || kl;  // bakoverkompatibel med bare-streng
    var klasseNavn = kl.name || '';
    var ageGroupM = klasseNavn.match(/^(U\d+|Senior|Junior|SEN)/i);
    var ageGroup = ageGroupM ? ageGroupM[1].toUpperCase() : '';
    return medNyttForsok(function() {
      return api('SearchRegistrationsByClass', {
        tournamentclassid: parseInt(cid),
        clientselectfunction: 'SelectTournamentClass1'
      }).then(function(res) {
        if (!res || res.error || res.d == null) throw new Error('påmeldinger');
        return res;
      });
    }).then(function(res) {
      var html = String((res.d && res.d.Html) || '');
      // En turnering kan være delt på flere cup2000-turneringer (f.eks. to haller), én per klasse.
      var reId = /cup2000\.dk[^\s"']*?tournamentid=(\d+)/gi, mId;
      while ((mId = reId.exec(html)) !== null) {
        info.cup2000Ider = info.cup2000Ider || [];
        if (info.cup2000Ider.indexOf(mId[1]) === -1) info.cup2000Ider.push(mId[1]);
      }
      if (html.indexOf(SI) === -1 && html.indexOf(SN) === -1) return [];
      var cupM = html.match(/cup2000\.dk[^\s"']*/i);
      if (cupM && !info.cup2000Url) info.cup2000Url = 'https://' + cupM[0];
      klasserMedSpiller.push(kl);
      return parseKlasse(html, ageGroup);
    }).catch(function() { info.feilet = true; return []; });
  })).then(function(alleRegs) {
    if (info.feilet) _turFeilet++;
    var regs = [];
    for (var i = 0; i < alleRegs.length; i++) {
      for (var j = 0; j < alleRegs[i].length; j++) regs.push(alleRegs[i][j]);
    }
    if (!regs.length) return null;
    return { tournamentId: tid, registreringer: regs, navn: info.navn, dato: info.dato, dager: info.dager, cup2000Url: info.cup2000Url, cup2000Ider: info.cup2000Ider || [], klasser: klasserMedSpiller, alleKlasser: info.klasser || [], isPast: !!info.isPast, harStartet: !!info.harStartet };
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

      var pid = pidM[1];
      if (!allMatches.length) return { plass: null, rankingliste: '', fodt: fodt, pid: pid };
      if (ageGroupNorm) {
        var ageMatch = allMatches.find(function(m) { return m.rankingliste.toUpperCase().indexOf(ageGroupNorm) === 0; });
        if (ageMatch) { ageMatch.fodt = fodt; ageMatch.pid = pid; return ageMatch; }
      }
      // Fallback: første treff
      allMatches[0].fodt = fodt;
      allMatches[0].pid = pid;
      return allMatches[0];
    });
  }).then(function(r) { return cacheSet(key, r); }).catch(function() { return cacheSet(key, null); });
}

function sett(tekst) {
  document.getElementById('st').textContent = tekst;
}

function visRanking(rows) {
  rows = rows || [];
  var res = document.getElementById('resultat');
  var sec = document.createElement('div');
  sec.className = 'sk-sek';
  sec.innerHTML = '<div class="sk-sek-banner sk-rank-banner"><h3>Ranking</h3>'
    + '<button id="sk-stjerne-btn" class="sk-live-btn sk-stjerne-btn" onclick="toggleFavoritt()">☆</button>'
    + '<button class="sk-live-btn" onclick="visResultater()">📈 Siste kamper</button></div>'
    + (rows.length ? '<div class="sk-grid" id="sk-rg"></div>' : '');
  res.appendChild(sec);
  oppdaterStjerneknapp();
  var grid = document.getElementById('sk-rg');
  for (var i = 0; i < rows.length; i++) {
    var c = document.createElement('div');
    c.className = 'sk-chip';
    var inner = '<div class="r-d">' + esc(rows[i].disiplin) + '</div>'
      + '<div class="r-k">' + esc(rows[i].klasse) + '</div>'
      + '<div class="r-p">#' + esc(rows[i].plass) + '</div>';
    var chipUrl = rows[i].url || 'https://badmintonportalen.no/NBF/Ranglister/';
    c.style.cursor = 'pointer';
    c.title = 'Åpne rankingliste';
    c.onclick = (function(url) { return function() { window.open(url, '_blank'); }; })(chipUrl);
    c.innerHTML = inner;
    grid.appendChild(c);
  }
}

function justerAarsskifte(d) {
  if (!d) return d;
  var seksMndMs = 183 * 24 * 60 * 60 * 1000;
  var diff = d.getTime() - Date.now();
  if (diff < -seksMndMs) d.setFullYear(d.getFullYear() + 1);
  else if (diff > seksMndMs) d.setFullYear(d.getFullYear() - 1);
  return d;
}

function parseTid(tid) {
  if (!tid) return null;
  var yr = new Date().getFullYear();
  // "DD-MM HH:MM"
  var m = tid.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) return justerAarsskifte(new Date(yr, parseInt(m[2])-1, parseInt(m[1]), parseInt(m[3]), parseInt(m[4])));
  // "HH:MM DD-MM" (gammelt cache-format)
  var m2 = tid.match(/^(\d{2}):(\d{2})\s+(\d{2})-(\d{2})/);
  if (m2) return justerAarsskifte(new Date(yr, parseInt(m2[4])-1, parseInt(m2[3]), parseInt(m2[1]), parseInt(m2[2])));
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
  var liveKnappHtml = (t.isPast || !t.harStartet) ? '' :
    ' <button class="sk-live-btn" id="sk-live-btn-' + t.tournamentId + '" onclick="visLive(\'' + escAttrJs(t.navn||'') + '\',\'live\',\'' + escAttrJs((t.cup2000Ider || []).join(',')) + '\')">📋 Live</button>'
    + '<button class="sk-live-btn" onclick="visLive(\'' + escAttrJs(t.navn||'') + '\',\'resultater\',\'' + escAttrJs((t.cup2000Ider || []).join(',')) + '\')">🏆 Resultater</button>';
  // Turneringssiden hos badmintonportalen (info, invitasjon, klasser) for spillerens første klasse
  var klasseId = t.klasser && t.klasser[0] && String(t.klasser[0].id || '').replace(/\D/g, '');
  var tittel = esc(_turDato) + ' \u2014 ' + esc(t.navn || 'Turnering');
  if (klasseId) tittel = '<a class="sk-tur-lenke" href="https://badmintonportalen.no/NBF/Turnering/VisInfo/#' + klasseId + '"'
    + ' target="_blank" rel="noopener" title="Åpne turneringen på badmintonportalen">' + tittel + ' <span class="sk-tur-lenke-ikon">↗</span></a>';
  // Deltakere er mest nyttig før programmet er klart (hvem er påmeldt, hvem mangler makker).
  // Når programmet er publisert, erstatter Program-knappen den.
  var alleKl = (t.alleKlasser && t.alleKlasser.length) ? t.alleKlasser : (t.klasser || []);
  _turKlasser[t.tournamentId] = { alle: alleKl, mine: t.klasser || [] };
  var deltKnappHtml = alleKl.length
    ? ' <button class="sk-live-btn" onclick="visDeltakere(\'' + escAttrJs(t.tournamentId) + '\')">👥 Deltakere</button>'
    : '';
  // Program: badmintonportalen lenker til cup2000 når arrangøren har publisert det.
  var progKnappHtml = '';
  if (t.cup2000Ider && t.cup2000Ider.length) {
    _turProgram[t.tournamentId] = { ider: t.cup2000Ider, navn: t.navn || '', mine: t.registreringer || [] };
    progKnappHtml = '<button class="sk-live-btn" onclick="visProgram(\'' + escAttrJs(t.tournamentId) + '\')">📅 Program</button>';
  }
  // Med flere knapper får ikke tittel og knapper plass på én linje på mobil.
  // Da får tittelen egen linje og knappene deler raden under.
  var knapper = liveKnappHtml + (progKnappHtml || deltKnappHtml);
  var antKnapper = (knapper.match(/<button/g) || []).length;
  sec.innerHTML = antKnapper > 1
    ? '<div class="sk-sek-banner sk-tur-banner-full"><h3>' + tittel + '</h3><div class="sk-banner-knapper">' + knapper + '</div></div>'
    : '<div class="sk-sek-banner"><h3>' + tittel + '</h3>' + knapper + '</div>';
  // Pågående turnering: hent live-data i bakgrunnen, så Live/Resultater åpner uten venting.
  if (liveKnappHtml) cup2000LiveApi(t.navn || '', false, (t.cup2000Ider || []).join(',')).catch(function() {});
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
          return '<span class="sk-mot-link" onclick="aapneMotstander(\'' + escAttrJs(m.navn) + '\',\'' + escAttrJs(m.klubb||'') + '\')">' + esc(m.navn) + '</span>'
            + (m.klubb ? ' <span style="opacity:.7">(' + esc(m.klubb) + ')</span>' : '');
        }).join(', ');
        makkerHtml = '<span class="sk-makker">m ' + makkerNavn
          + ' <span class="sk-rank-mini" id="sk-mkr-' + t.tournamentId + '-' + i + '"></span></span>';
      }
    }
    rh += '<div class="sk-row">'
      + '<span class="sk-bk' + (r.bekreftet ? ' ok' : '') + '">' + (r.bekreftet ? 'OK' : '?') + '</span>'
      + '<span class="sk-disc">' + esc(r.disiplin) + '</span>'
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
        if (!ranking || !ranking.plass) return;
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
          var pid = String(SI);
          // Grener spilleren er påmeldt ("Damesingle", "Mixeddouble" …); tom liste = alle grener.
          var paameldt = (t.registreringer || []).map(function(r) { return (r.disiplin || '').toLowerCase(); });
          Promise.all(t.klasser.map(function(kl) {
            return api('SearchTournamentResults', {
              tournamentclassid: parseInt(kl.id),
              clientselectfunction: 'SelectTournamentClass1'
            }, true).then(function(res) {
              var html = String((res.d && res.d.Html) || '');
              if (!html) return null;
              var doc2 = new DOMParser().parseFromString(html, 'text/html');
              var blokker = [];
              doc2.querySelectorAll('h2').forEach(function(h2) {
                var disc = h2.textContent.trim();
                var blokk = { disc: disc, klasse: kl.name || '', plass: '', poeng: '', eid: '' };
                var el2 = h2.nextElementSibling;
                while (el2 && el2.tagName !== 'TABLE' && el2.tagName !== 'H2') {
                  var em = (el2.getAttribute && el2.getAttribute('onclick') || '').match(/SelectEvent\('\d+',\s*'(\d+)'\)/);
                  if (em) blokk.eid = em[1];
                  el2 = el2.nextElementSibling;
                }
                if (el2 && el2.tagName === 'TABLE') {
                  var sistePlass = '', sistePoeng = '';
                  el2.querySelectorAll('tr:not(.headrow)').forEach(function(row) {
                    var playerCell = row.querySelector('td.player');
                    if (!playerCell) return;
                    var rankTekst = (row.querySelector('td.rank') || {}).textContent;
                    var poengTekst = (row.querySelector('td.points') || {}).textContent;
                    rankTekst = (rankTekst || '').trim(); poengTekst = (poengTekst || '').trim();
                    // Ny rad med plass = ny spiller/par; rad uten plass = makker i samme par
                    if (rankTekst) { sistePlass = rankTekst; sistePoeng = poengTekst; }
                    var link = playerCell.querySelector('a[href*="VisSpiller"]');
                    var erMeg = (link && (link.getAttribute('href') || '').indexOf('VisSpiller/#' + pid) !== -1)
                      || (playerCell.textContent || '').toLowerCase().indexOf(SN.toLowerCase()) !== -1;
                    if (!erMeg) return;
                    blokk.plass = sistePlass;
                    blokk.poeng = rankTekst ? poengTekst : sistePoeng;
                  });
                }
                var discL = disc.toLowerCase();
                var aktuell = blokk.plass || !paameldt.length || paameldt.some(function(p) { return p && (p.indexOf(discL) !== -1 || discL.indexOf(p) !== -1); });
                if (aktuell) blokker.push(blokk);
              });
              // Spillerens kamper i hver aktuell gren (seier/tap), også når hun ikke fikk plassering
              return Promise.all(blokker.map(function(b) {
                if (!b.eid) return Promise.resolve(b);
                return h2hKamper(kl.id, b.eid, pid).then(function(ks) {
                  b.seire = ks.filter(function(k) { return !k.wo && k.vant; }).length;
                  b.tap = ks.filter(function(k) { return !k.wo && !k.vant; }).length;
                  b.kamper = ks.length;
                  return b;
                }).catch(function() { return b; });
              })).then(function(bs) {
                return bs.filter(function(b) { return b.plass || b.kamper; });
              });
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
                + '<span class="sk-disc">' + esc(b.disc) + (b.klasse ? ' <span style="opacity:.6;font-size:11px">' + esc(b.klasse) + '</span>' : '') + '</span>'
                + '<span style="margin-left:8px;color:#7fffd4;font-weight:bold">' + (b.plass ? '#' + esc(b.plass) : '') + '</span>'
                + (b.poeng ? '<span style="margin-left:6px;font-size:11px;color:#aaa">' + esc(b.poeng) + 'p</span>' : '')
                + (b.kamper ? '<span style="margin-left:auto;font-size:11px;color:#aaa">' + b.seire + '–' + b.tap + '</span>' : '')
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

      // Portalen lenker ikke alltid til cup2000 (f.eks. Haugerud), men kampprogrammet ble
      // funnet via navneoppslag – da er programmet publisert, og Program erstatter Deltakere.
      if (!_turProgram[t.tournamentId]) leggTilProgramKnapp(sec, t);

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
        // Fallback for sammenslåtte doubles-klasser (f.eks. HD-klasse inkluderer DD/MD-spillere):
        // Arrangøren kan slå sammen HD+DD til én "Herredouble"-klasse på cup2000, mens spilleren
        // er påmeldt "Damedouble" på badmintonportalen. Da prøver vi andre doubles-varianter.
        if (regIdx === undefined && (dc === 'HD' || dc === 'DD' || dc === 'MD')) {
          var _dblOrder = ['HD', 'DD', 'MD'];
          for (var _di = 0; _di < _dblOrder.length; _di++) {
            if (_dblOrder[_di] !== dc && _dblOrder[_di] in discToRegIdx) {
              regIdx = discToRegIdx[_dblOrder[_di]]; break;
            }
          }
        }
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
            + '<span class="sk-kamp-bane">' + esc(k.bane || '') + '</span>'
            + '<span class="sk-kamp-mot" id="sk-mot-' + t.tournamentId + '-' + ki + '">'
            + (function(kp, kpi) {
                if ((kp.mot || '').indexOf('Vinner av ') === 0) {
                  return '<span style="font-size:11px;color:#888;font-style:italic">' + esc(kp.mot) + '</span>';
                }
                var spillere = kp.motSpillere && kp.motSpillere.length > 1 ? kp.motSpillere : null;
                if (spillere) {
                  return spillere.map(function(s, si) {
                    return '<span id="sk-mot-' + t.tournamentId + '-' + kpi + '-p' + si
                      + '" class="sk-mot-link" onclick="aapneMotstander(\'' + escAttrJs(s.navn) + '\',\'' + escAttrJs(s.klubb||'') + '\')">' + esc(s.navn) + '</span>';
                  }).join(' ');
                }
                return '<span class="sk-mot-link" onclick="aapneMotstander(\'' + escAttrJs(kp.mot||'') + '\',\'' + escAttrJs(kp.motKlubb||'') + '\')">' + esc(kp.mot || '') + '</span>';
              })(k, ki)
            + (k.motKlubb ? '<span class="sk-kamp-mot-sub">' + esc(k.motKlubb) + '</span>' : '')
            + '</span>'
            + (k.res ? '<span class="sk-kamp-res" style="' + (k.vant === true ? 'color:#7fffd4' : k.vant === false ? 'color:#e94560' : '') + '">' + esc(k.res) + '</span>' : '')
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
              (function(gData, tNavn, tUrl) {
                gruppeBtn.onclick = function() {
                  visGruppe(gData, function() {
                    delete _cache['cup2000:' + tNavn + '|' + SN];
                    return cup2000Api(tNavn, tUrl).then(function(d) {
                      var gr = (d && d.grupper) || [];
                      var ny = gr.find(function(x) { return x.disc === gData.disc && x.ageGroup === gData.ageGroup; })
                        || gr.find(function(x) { return x.disc === gData.disc; });
                      if (ny) ny.klasser = gData.klasser;
                      return ny;
                    });
                  });
                };
              })(g, t.navn, t.cup2000Url);
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
                if (ranking.pid && String(ranking.pid) !== String(SI)) {
                  var h2hChip = document.createElement('span');
                  h2hChip.className = 'sk-h2h-mini';
                  h2hChip.textContent = 'H2H';
                  h2hChip.title = 'Tidligere kamper mot ' + sNavn;
                  h2hChip.onclick = function(e) { e.stopPropagation(); visH2H(ranking.pid, sNavn); };
                  if (spillere.length > 1) motEl.appendChild(h2hChip);
                  else motEl.insertBefore(h2hChip, motEl.querySelector('.sk-kamp-mot-sub'));
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

function aktiverPushVarsel(tournamentNavn, cup2000Url, statusEl) {
  return Notification.requestPermission().then(function(perm) {
    if (perm !== 'granted') {
      statusEl.textContent = 'Varsler er blokkert i nettleseren';
      return;
    }
    return navigator.serviceWorker.ready.then(function(reg) {
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }).then(function(sub) {
      return fetch(PROXY + '/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          tournamentNavn: tournamentNavn,
          cup2000Url: cup2000Url || '',
          navn: SN || '',
          klubb: SK || ''
        })
      }).then(function(r) {
        return r.json().then(function(d) { return { ok: r.ok, d: d }; });
      });
    }).then(function(res) {
      if (!res.ok || !res.d || !res.d.ok) throw new Error('push-feil');
      statusEl.style.color = '#7fffd4';
      statusEl.textContent = '✓ Du får push-varsel når programmet er klart!';
    });
  }).catch(function(err) {
    console.error('Push-feil:', err);
    if (err && err.name === 'NotAllowedError') {
      statusEl.textContent = 'Varsler er blokkert i nettleseren';
    } else if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      statusEl.textContent = 'På iPhone: legg først appen til hjemskjermen (Del-knappen → Legg til på Hjem-skjerm)';
    } else {
      statusEl.textContent = 'Kunne ikke aktivere push-varsel.';
    }
  });
}

function visVarsleSkjema(tournamentNavn, cup2000Url, container) {
  // Bytt ut knappen med inline-skjema
  var form = document.createElement('div');
  form.className = 'sk-varsle-form';

  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    var pushBtn = document.createElement('button');
    pushBtn.className = 'sk-varsle-send';
    pushBtn.textContent = '\uD83D\uDD14 Push-varsel p\u00e5 denne enheten';
    var pushStatus = document.createElement('div');
    pushStatus.style.cssText = 'font-size:11px;color:#aaa;margin-top:6px;min-height:14px';
    pushBtn.onclick = function() {
      pushBtn.disabled = true;
      pushStatus.style.color = '#aaa';
      pushStatus.textContent = 'Aktiverer...';
      aktiverPushVarsel(tournamentNavn, cup2000Url, pushStatus).finally(function() {
        pushBtn.disabled = false;
      });
    };
    form.appendChild(pushBtn);
    form.appendChild(pushStatus);
  } else {
    var ustottet = document.createElement('div');
    ustottet.style.cssText = 'font-size:11px;color:#aaa';
    ustottet.textContent = 'Nettleseren din st\u00f8tter ikke push-varsler.';
    form.appendChild(ustottet);
  }

  // Fjern eksisterende varsle-knapper i denne containeren
  var existing = container.querySelectorAll('.sk-varsle-btn, .sk-varsle-mini, .sk-varsle-form');
  existing.forEach(function(el) { el.remove(); });
  container.appendChild(form);
}

// hentNy (valgfri): funksjon som henter gruppen på nytt og returnerer Promise<g>.
function visGruppe(g, hentNy) {
  var DISC_FULL = { HS: 'Herresingle', DS: 'Damesingle', HD: 'Herredouble', DD: 'Damedouble', MD: 'Mixed' };
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-gruppe-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkGruppe(); };

  var navnLower = SN.split(' ').pop().toLowerCase();

  function gruppefaseHTML() {
    var rows = g.spillere.map(function(s) {
      return '<tr class="' + (s.erMeg ? 'meg' : '') + '">'
        + '<td class="pos">' + esc(s.pos) + '</td>'
        + '<td>' + esc(s.navn) + (s.klubb ? '<br><span style="font-size:10px;color:#888">' + esc(s.klubb) + '</span>' : '') + '</td>'
        + '<td class="score">' + esc(s.kV) + '-' + esc(s.kT) + '</td>'
        + '<td class="score">' + esc(s.sV) + '-' + esc(s.sT) + '</td>'
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
        + '<td class="pos">' + esc(s.plass || '') + '</td>'
        + '<td>' + esc(s.navn) + (s.klubb ? '<br><span style="font-size:10px;color:#888">' + esc(s.klubb) + '</span>' : '') + '</td>'
        + '<td class="score">' + (s.poeng ? esc(s.poeng) + 'p' : '') + '</td>'
        + '</tr>';
    }).join('');
    return '<div style="font-size:10px;color:#888;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.05em">Sluttresultat</div>'
      + '<table class="sk-gruppe-tabell">'
      + '<thead><tr><th>#</th><th>Spiller</th><th>Poeng</th></tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  }

  var sisteSlutt = null;
  function oppdater(sluttRows) {
    var panel = overlay.querySelector('.sk-gruppe-panel');
    if (!panel) return;
    if (sluttRows) sisteSlutt = sluttRows;
    var content = gruppefaseHTML();
    if (sisteSlutt) content += sluttresultatHTML(sisteSlutt);
    panel.querySelector('.sk-gruppe-innhold').innerHTML = content;
  }

  overlay.innerHTML = '<div class="sk-gruppe-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">' + esc(g.disc) + ' ' + esc(g.ageGroup) + ' \u2014 Gruppestilling</span>'
    + (hentNy ? '<button class="sk-live-refresh-btn" title="Oppdater">\u21bb</button>' : '')
    + '<button class="sk-gruppe-xbtn" onclick="lukkGruppe()">\u2715</button>'
    + '</div>'
    + '<div class="sk-gruppe-innhold">' + gruppefaseHTML() + '</div>'
    + '</div>';
  document.body.appendChild(overlay);

  var refreshBtn = overlay.querySelector('.sk-live-refresh-btn');
  if (refreshBtn) refreshBtn.onclick = function() {
    refreshBtn.disabled = true;
    hentNy().then(function(ny) {
      if (ny) g = ny;
      oppdater();
      return hentSlutt();
    }).catch(function() {}).then(function() { refreshBtn.disabled = false; });
  };

  hentSlutt();

  function hentSlutt() {
    var kl = g.klasser && g.klasser.find(function(k) { return k.name === g.ageGroup; });
    if (!kl) return Promise.resolve();
    return api('SearchTournamentResults', {
      tournamentclassid: parseInt(kl.id),
      clientselectfunction: 'SelectTournamentClass1'
    }, true).then(function(res) {
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
}

function lukkGruppe() {
  var el = document.getElementById('sk-gruppe-overlay');
  if (el) el.remove();
}

var LIVE_TTL = 30 * 1000; // 30 sek cache for live-data
// ider: kommaseparerte cup2000-ID-er (standard: de til åpent panel). fersk: hopp over cache (↻).
// Pågående henting for samme nøkkel gjenbrukes, så forhåndshenting og trykk på knappen ikke dobler kallet.
var _liveVenter = {};
function cup2000LiveApi(tournamentNavn, fersk, ider) {
  ider = ider === undefined ? _liveIder : ider;
  var key = 'live:' + tournamentNavn + '|' + ider;
  var e = _cache[key];
  if (!fersk && e && (Date.now() - e.ts < LIVE_TTL)) return Promise.resolve(e.val);
  if (!fersk && _liveVenter[key]) return _liveVenter[key];
  var p = fetch(PROXY + '/cup2000live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tournamentNavn: tournamentNavn, navn: SN, klubb: SK, cup2000Ider: ider ? ider.split(',') : [], fersk: !!fersk })
  }).then(function(r) { return r.json(); }).then(function(d) { return cacheSet(key, d); });
  _liveVenter[key] = p;
  p.catch(function() {}).then(function() { delete _liveVenter[key]; });
  return p;
}

var _liveModus = 'live';
var _liveIder = '';

// ider: kommaseparerte cup2000-turnerings-ID-er fra badmintonportalen (flere hvis turneringen er delt på flere haller).
function visLive(tournamentNavn, modus, ider) {
  _liveModus = modus === 'resultater' ? 'resultater' : 'live';
  _liveIder = ider || '';
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-live-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkLive(); };

  overlay.innerHTML = '<div class="sk-gruppe-panel sk-live-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">' + (_liveModus === 'resultater' ? '🏆 Siste resultater' : '📋 Kamper nå') + '</span>'
    + '<button class="sk-live-refresh-btn" id="sk-live-refresh" onclick="oppdaterLive(\'' + escAttrJs(tournamentNavn) + '\')">↻</button>'
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

// Vises når live-panelet er tomt: hvilke cup2000-turneringer som ble spurt, og hva de ga.
function liveKildeInfo(data, visning) {
  if (!data) return '';
  if (data.ikkeFunnet) return '<div class="sk-live-kilde">Fant ikke turneringen hos cup2000</div>';
  return (data.kilder || []).map(function(k) {
    var url = 'https://www.cup2000.dk/turnerings-system/Vis-turneringer/?tournamentid=' + encodeURIComponent(k.id) + '&' + visning;
    var raa = 'https://www.cup2000.dk/Publisher/SearchTournamentsService.aspx?tournamentid=' + encodeURIComponent(k.id) + '&' + visning;
    return '<div class="sk-live-kilde">cup2000 #' + esc(k.id) + (k.hall ? ' (' + esc(k.hall) + ')' : '') + ': '
      + k.igang + ' i gang, ' + k.neste + ' neste, ' + k.resultater + ' resultater' + (k.feil ? ', feil ved henting' : '')
      + ' · <a href="' + url + '" target="_blank" rel="noopener">åpne</a> · <a href="' + raa + '" target="_blank" rel="noopener">rådata</a>'
      + (k.valgt ? '<br>Spillested: ' + esc(k.valgt) : '') + (k.sesjon === false ? '<br>Ingen sesjon hos cup2000' : '')
      + (k.struktur ? '<br><span style="opacity:.6">' + esc(k.struktur) + '</span>' : '') + '</div>';
  }).join('');
}

function renderResultater(innhold, data) {
  var naa = new Date();
  var idag = String(naa.getDate()).padStart(2, '0') + '-' + String(naa.getMonth() + 1).padStart(2, '0');
  var res = data && data.resultater ? data.resultater : [];
  if (!res.length) {
    innhold.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:16px">Ingen resultater ennå' + liveKildeInfo(data, 'lr=1') + '</div>';
    return;
  }
  function navn(sp) { return (sp || []).map(function(s) { return esc(s.navn); }).join(' / '); }
  var html = '';
  for (var i = 0; i < res.length; i++) {
    var k = res[i];
    var tid = String(k.tid || '').split(' ');
    html += '<div class="sk-live-kamp' + (k.mine ? ' sk-live-kamp-mine' : '') + '">'
      + '<div class="sk-live-kamp-top">'
      + '<span class="sk-live-disc">' + esc(k.discFull || ((k.disc || '') + ' ' + (k.ageGroup || ''))) + (k.hall ? ' · ' + esc(k.hall) : '') + '</span>'
      + '<span class="sk-live-tid">' + esc(tid.length > 1 && tid[0] !== idag ? tid[0] + ' ' + tid[1] : tid[tid.length - 1]) + '</span>'
      + '</div>'
      + '<div class="sk-live-sp' + (k.vinner === 1 ? ' sk-res-vinner' : '') + '">' + navn(k.spiller1) + '</div>'
      + '<div class="sk-live-sp' + (k.vinner === 2 ? ' sk-res-vinner' : '') + '">' + navn(k.spiller2) + '</div>'
      + '<div class="sk-res-sett">' + esc((k.sett || []).join(', ')) + '</div>'
      + '</div>';
  }
  innhold.innerHTML = html + liveKildeInfo(data, 'lr=1');
}

function renderLiveInnhold(data) {
  var innhold = document.getElementById('sk-live-innhold');
  if (!innhold) return;
  if (_liveModus === 'resultater') { renderResultater(innhold, data); return; }
  var kamper = data && data.kamper ? data.kamper : [];
  if (!kamper.length) {
    innhold.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:16px">Ingen kamper tilgjengelig' + liveKildeInfo(data, 'o=1') + '</div>';
    return;
  }

  // 'tid' er "DD-MM HH:MM" — vis klokkeslettet, ikke datoen.
  function klokke(t) { var d = String(t || '').split(' '); return d.length > 1 ? d[1] : d[0]; }

  function kampKort(k, hdr) {
    var isLive = k.status === 'live';
    var statusHtml;
    if (isLive) statusHtml = '<span class="sk-live-status-live">● LIVE</span>';
    else if (k.status === 'next') statusHtml = '<span class="sk-live-status-next">NESTE</span>';
    else statusHtml = '<span class="sk-live-status-kø">' + esc(k.status) + ' før</span>';

    var hoyre = isLive
      ? (k.startet ? '<span class="sk-live-tid">fra ' + esc(k.startet) + '</span>' : '')
      : '<span class="sk-live-tid">' + esc(klokke(k.tid)) + '</span>';

    var sp1 = (k.spiller1 || []).map(function(s) { return esc(s.navn); }).join(' / ');
    var sp2 = (k.spiller2 || []).map(function(s) { return esc(s.navn); }).join(' / ');

    return (hdr || '')
      + '<div class="sk-live-kamp' + (k.mine ? ' sk-live-kamp-mine' : '') + (isLive ? ' sk-live-kamp-live' : '') + '">'
      + '<div class="sk-live-kamp-top">'
      + '<span class="sk-live-disc">' + esc(k.disc || '') + ' ' + esc(k.ageGroup || '') + (k.hall ? ' · ' + esc(k.hall) : '') + '</span>'
      + statusHtml + hoyre
      + '</div>'
      + '<div class="sk-live-sp' + (k.mine ? ' sk-live-sp-mine' : '') + '">' + sp1 + '</div>'
      + '<div class="sk-live-vs">vs</div>'
      + '<div class="sk-live-sp">' + sp2 + '</div>'
      + '</div>';
  }

  var igang = kamper.filter(function(k) { return k.status === 'live'; })
    .sort(function(a, b) { return (parseInt(a.bane) || 0) - (parseInt(b.bane) || 0); });
  var koe = kamper.filter(function(k) { return k.status !== 'live'; })
    .sort(function(a, b) {
      var av = a.status === 'next' ? -1 : a.status, bv = b.status === 'next' ? -1 : b.status;
      return av - bv;
    });

  var html = '';
  if (igang.length) {
    html += '<div class="sk-live-seksjon">Kamper i gang</div>';
    for (var i = 0; i < igang.length; i++) {
      var k = igang[i];
      html += kampKort(k, '<div class="sk-live-bane-hdr">' + (k.bane ? 'Bane ' + esc(k.bane) : 'På bane') + '</div>');
    }
  }
  if (koe.length) {
    html += '<div class="sk-live-seksjon">Neste kamper</div>';
    for (var j = 0; j < koe.length; j++) html += kampKort(koe[j], '');
  }
  innhold.innerHTML = html + liveKildeInfo(data, 'o=1');
}

function oppdaterLive(tournamentNavn) {
  var btn = document.getElementById('sk-live-refresh');
  if (btn) { btn.textContent = '↻'; btn.disabled = true; }
  var innhold = document.getElementById('sk-live-innhold');
  if (innhold) innhold.innerHTML = '<div style="font-size:12px;color:#888;text-align:center;padding:20px">Laster...</div>';
  cup2000LiveApi(tournamentNavn, true).then(function(data) {
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

// ── Deltakerliste ─────────────────────────────────────────────────────────
// SearchRegistrationsByClass gir alle påmeldte i én turneringsklasse. Samme kall
// som sjekkTurnering() bruker; her beholdes alle rader, ikke bare spillerens.
// Klassene legges i _turKlasser når turneringen rendres, så onclick slipper å
// bære hele lista.
var _turKlasser = {};

function deltakereApi(klasseId) {
  var key = 'delt:' + klasseId;
  var truffet = cacheGet(key);
  if (truffet) return Promise.resolve(truffet);
  return api('SearchRegistrationsByClass', {
    tournamentclassid: parseInt(klasseId),
    clientselectfunction: 'SelectTournamentClass1'
  }).then(function(res) {
    return cacheSet(key, parseDeltakere(String((res.d && res.d.Html) || '')));
  });
}

function parseDeltakere(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var h3s = doc.querySelectorAll('h3');
  var grener = [];
  for (var i = 0; i < h3s.length; i++) {
    var tabell = h3s[i].nextElementSibling;
    if (!tabell) continue;
    var trs = tabell.querySelectorAll('tr');
    var rader = [];
    for (var j = 0; j < trs.length; j++) {
      var tr = trs[j];
      var lenker = tr.querySelectorAll('a[href*="VisSpiller"]');
      if (!lenker.length) continue; // hopper over overskriftsraden
      var spillere = [];
      for (var k = 0; k < lenker.length; k++) {
        var idM = (lenker[k].getAttribute('href') || '').match(/VisSpiller\/#(\d+)/);
        var etter = lenker[k].nextSibling;
        var klubb = etter && etter.nodeType === 3
          ? etter.textContent.replace(/^[,\s]+/, '').replace(/^br\s*\/?.*/i, '').trim() : '';
        spillere.push({ id: idM ? idM[1] : '', navn: lenker[k].textContent.trim(), klubb: klubb });
      }
      rader.push({
        spillere: spillere,
        xmakker: tr.innerHTML.indexOf('X-makker') !== -1,
        bekreftet: tr.innerHTML.indexOf('checkmark.gif') !== -1
      });
    }
    if (rader.length) grener.push({ disiplin: h3s[i].textContent.trim(), rader: rader });
  }
  return grener;
}

function visDeltakere(tournamentId) {
  var info = _turKlasser[tournamentId];
  if (!info || !info.alle.length) return;
  // Åpne på spillerens egen klasse når han har en
  var start = (info.mine[0] && info.mine[0].id) || info.alle[0].id;
  aapneDeltakere(info.alle, start, 'Deltakere');
}

// Fra terminlista har vi bare klasse-ID-en portalen lenker til, ikke hele klasselista.
function visDeltakereKlasse(klasseId, tittel) {
  aapneDeltakere([], klasseId, tittel || 'Deltakere');
}

// Terminlista lenker bare til én klasse (som regel den øverste), så panelet åpnes med
// den med én gang og klassevelgeren fylles ut når hele klasselista er hentet.
function visDeltakereTur(tid, klasseId, tittel) {
  aapneDeltakere([], klasseId, tittel || 'Deltakere');
  hentAlleKlasser(tid).then(function(klasser) {
    if (klasser.length < 2 || !document.getElementById('sk-delt-overlay')) return;
    settDeltakerKlasser(klasser, klasseId);
  }).catch(function() {});
}

function settDeltakerKlasser(klasser, valgt) {
  var panel = document.querySelector('#sk-delt-overlay .sk-gruppe-panel');
  var innhold = document.getElementById('sk-delt-innhold');
  if (!panel || !innhold || panel.querySelector('.sk-delt-velg')) return;
  var finnes = false;
  for (var i = 0; i < klasser.length; i++) if (String(klasser[i].id) === String(valgt)) finnes = true;
  if (!finnes) valgt = klasser[0].id;
  var velger = document.createElement('select');
  velger.className = 'sk-delt-velg';
  velger.onchange = function() { lastDeltakere(this.value); };
  velger.innerHTML = klasser.map(function(k) {
    return '<option value="' + esc(k.id) + '"' + (String(k.id) === String(valgt) ? ' selected' : '') + '>'
      + esc(k.name || ('Klasse ' + k.id)) + '</option>';
  }).join('');
  panel.insertBefore(velger, innhold);
  if (!finnes) lastDeltakere(valgt);
}

function aapneDeltakere(klasser, start, tittel) {
  lukkDeltakere();
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-delt-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkDeltakere(); };
  var velger = '';
  if (klasser.length > 1) {
    velger = '<select class="sk-delt-velg" onchange="lastDeltakere(this.value)">' + klasser.map(function(k) {
      return '<option value="' + esc(k.id) + '"' + (String(k.id) === String(start) ? ' selected' : '') + '>'
        + esc(k.name || ('Klasse ' + k.id)) + '</option>';
    }).join('') + '</select>';
  }
  overlay.innerHTML = '<div class="sk-gruppe-panel sk-live-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">\uD83D\uDC65 ' + esc(tittel) + '</span>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkDeltakere()">\u2715</button>'
    + '</div>'
    + velger
    + '<div id="sk-delt-innhold" style="font-size:12px;color:#888;text-align:center;padding:20px">Laster...</div>'
    + '</div>';
  document.body.appendChild(overlay);
  lastDeltakere(start);
}

function lastDeltakere(klasseId) {
  var innhold = document.getElementById('sk-delt-innhold');
  if (!innhold) return;
  innhold.innerHTML = '<div style="font-size:12px;color:#888;text-align:center;padding:20px">Laster...</div>';
  deltakereApi(klasseId).then(function(grener) {
    var el = document.getElementById('sk-delt-innhold');
    if (el) el.innerHTML = renderDeltakere(grener);
  }).catch(function() {
    var el = document.getElementById('sk-delt-innhold');
    if (el) el.innerHTML = '<div style="color:#e94560;font-size:12px;text-align:center;padding:16px">Kunne ikke hente deltakere</div>';
  });
}

function renderDeltakere(grener) {
  if (!grener.length) return '<div style="color:#888;font-size:12px;text-align:center;padding:16px">Ingen påmeldte i denne klassen</div>';
  var html = '';
  for (var i = 0; i < grener.length; i++) {
    var g = grener[i];
    html += '<div class="sk-live-seksjon">' + esc(g.disiplin)
      + ' <span class="sk-disc-count">(' + g.rader.length + ')</span></div>';
    for (var j = 0; j < g.rader.length; j++) {
      var r = g.rader[j];
      var erMeg = false;
      for (var m = 0; m < r.spillere.length; m++) {
        if (String(r.spillere[m].id) === String(SI) || r.spillere[m].navn === SN) erMeg = true;
      }
      var navnHtml = r.spillere.map(function(s) {
        var klubb = s.klubb ? ' <span class="sk-delt-klubb">' + esc(s.klubb) + '</span>' : '';
        var egen = String(s.id) === String(SI) || s.navn === SN;
        if (s.id && !egen) {
          return '<span class="sk-mot-link" onclick="visH2H(\'' + escAttrJs(s.id) + '\',\'' + escAttrJs(s.navn) + '\')">'
            + esc(s.navn) + '</span>' + klubb;
        }
        return '<span class="sk-delt-meg">' + esc(s.navn) + '</span>' + klubb;
      }).join('<br>');
      if (r.xmakker) navnHtml += '<br><span class="sk-delt-xmakker">søker makker</span>';
      html += '<div class="sk-delt-rad' + (erMeg ? ' sk-delt-rad-meg' : '') + '">'
        + '<span class="sk-bk' + (r.bekreftet ? ' ok' : '') + '">' + (r.bekreftet ? 'OK' : '?') + '</span>'
        + '<span class="sk-delt-navn">' + navnHtml + '</span>'
        + '</div>';
    }
  }
  return html;
}

// ── Program ──────────────────────────────────────────────────────────────
// Hele kampprogrammet fra cup2000, én klasse om gangen (som deltakerlista). Knappen vises
// når badmintonportalen lenker til cup2000, dvs. når arrangøren har publisert programmet.
var _turProgram = {};
var _prog = null; // { ider, klasser, valgt, mine }

function programApi(body, fersk) {
  var key = 'prog:' + JSON.stringify(body);
  var e = _cache[key];
  // Klasselista caches som annet (10 min), kampene kort siden resultater kommer underveis.
  var ttl = body.id ? CUP2000_TTL : CACHE_TTL;
  if (!fersk && e && (Date.now() - e.ts < ttl)) return Promise.resolve(e.val);
  return fetch(PROXY + '/cup2000program', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ fersk: !!fersk }, body))
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.error) throw new Error(d.error);
    return cacheSet(key, d);
  });
}

function visProgram(tournamentId) {
  var p = _turProgram[tournamentId];
  if (p) aapneProgram(p.ider, p.navn, p.mine);
}

// Uten cup2000-ID-er fra portalen: workeren finner turneringen på navn (som /cup2000).
function leggTilProgramKnapp(sec, t) {
  _turProgram[t.tournamentId] = { ider: [], navn: t.navn || '', mine: t.registreringer || [] };
  var btn = document.createElement('button');
  btn.className = 'sk-live-btn';
  btn.textContent = '📅 Program';
  btn.onclick = function() { visProgram(t.tournamentId); };
  var delt = sec.querySelector('.sk-sek-banner button[onclick^="visDeltakere("]');
  if (delt) { delt.parentNode.replaceChild(btn, delt); return; }
  var plass = sec.querySelector('.sk-banner-knapper') || sec.querySelector('.sk-sek-banner');
  if (plass) plass.appendChild(btn);
}

// Fra terminlista: cup2000-lenken i raden har turnerings-ID-en.
function visProgramCup(cupId, tittel) {
  aapneProgram([cupId], tittel, []);
}

function aapneProgram(ider, tittel, mine) {
  lukkProgram();
  _prog = { ider: ider, klasser: [], valgt: 0, mine: mine || [] };
  var sporring = ider.length ? { cup2000Ider: ider } : { tournamentNavn: tittel };
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-prog-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkProgram(); };
  overlay.innerHTML = '<div class="sk-gruppe-panel sk-live-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">📅 Program</span>'
    + '<button class="sk-live-refresh-btn" onclick="lastProgramKlasse(true)" title="Oppdater">↻</button>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkProgram()">✕</button>'
    + '</div>'
    + (tittel ? '<div class="sk-prog-tur">' + esc(tittel) + '</div>' : '')
    + '<div id="sk-prog-velger"></div>'
    + '<div id="sk-prog-innhold" class="sk-prog-tom">Henter klasser...</div>'
    + '</div>';
  document.body.appendChild(overlay);
  programApi(sporring).then(function(d) {
    if (!document.getElementById('sk-prog-overlay')) return;
    var klasser = d.klasser || [];
    if (!klasser.length) {
      document.getElementById('sk-prog-innhold').innerHTML = 'Programmet er ikke publisert ennå.';
      return;
    }
    _prog.klasser = klasser;
    _prog.valgt = programStartKlasse(klasser, _prog.mine);
    document.getElementById('sk-prog-velger').innerHTML = klasser.length > 1
      ? '<select class="sk-delt-velg" onchange="_prog.valgt = +this.value; lastProgramKlasse()">' + klasser.map(function(k, i) {
          return '<option value="' + i + '"' + (i === _prog.valgt ? ' selected' : '') + '>' + esc(k.navn + (k.hall ? ' (' + k.hall + ')' : '')) + '</option>';
        }).join('') + '</select>'
      : '';
    lastProgramKlasse();
  }).catch(function() {
    var el = document.getElementById('sk-prog-innhold');
    if (el) el.innerHTML = '<span style="color:#e94560">Kunne ikke hente programmet</span>';
  });
}

// Åpne på klassen den søkte spilleren er påmeldt i (f.eks. «U15» + «Herresingle»).
function programStartKlasse(klasser, mine) {
  for (var r = 0; r < mine.length; r++) {
    var disc = String(mine[r].disiplin || '').toLowerCase(), ag = String(mine[r].ageGroup || '').toLowerCase();
    for (var i = 0; i < klasser.length; i++) {
      var n = klasser[i].navn.toLowerCase();
      if (disc && n.indexOf(disc) !== -1 && (!ag || n.indexOf(ag) !== -1)) return i;
    }
  }
  return 0;
}

function lastProgramKlasse(fersk) {
  var innhold = document.getElementById('sk-prog-innhold');
  if (!innhold || !_prog || !_prog.klasser.length) return;
  var k = _prog.klasser[_prog.valgt] || _prog.klasser[0];
  innhold.className = 'sk-prog-tom';
  innhold.textContent = 'Laster...';
  programApi({ id: k.id, c: k.c, e: k.e }, fersk).then(function(d) {
    var el = document.getElementById('sk-prog-innhold');
    if (!el || _prog.klasser[_prog.valgt] !== k) return;
    var kamper = d.kamper || [];
    if (!kamper.length) { el.textContent = 'Ingen kamper i programmet for denne klassen ennå.'; return; }
    el.className = '';
    el.innerHTML = renderProgram(kamper);
    // Under turneringen: hopp til første kamp uten resultat.
    var neste = el.querySelector('.sk-prog-neste');
    var panel = el.closest('.sk-gruppe-panel');
    if (neste && panel && el.querySelector('.sk-res-sett')) panel.scrollTop += neste.getBoundingClientRect().top - panel.getBoundingClientRect().top - 60;
  }).catch(function() {
    var el = document.getElementById('sk-prog-innhold');
    if (el) el.innerHTML = '<span style="color:#e94560">Kunne ikke hente kampene</span>';
  });
}

function erSoktSpiller(navn) {
  var deler = String(SN || '').toLowerCase().split(/\s+/).filter(Boolean);
  var n = String(navn || '').toLowerCase();
  if (!deler.length) return false;
  return deler.length > 1 ? n.indexOf(deler[0]) !== -1 && n.indexOf(deler[deler.length - 1]) !== -1 : n.indexOf(deler[0]) !== -1;
}

function renderProgram(kamper) {
  var dager = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
  var mnd = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
  function lag(sp, vant) {
    var mine = sp.some(function(s) { return erSoktSpiller(s.navn); });
    var navn = sp.map(function(s) { return esc(s.navn); }).join(' / ') || '–';
    var klubb = sp.map(function(s) { return s.klubb; }).filter(function(x, i, a) { return x && a.indexOf(x) === i; }).join(' / ');
    return '<div class="sk-live-sp' + (mine ? ' sk-live-sp-mine' : '') + (vant ? ' sk-res-vinner' : '') + '">' + navn
      + (klubb ? ' <span class="sk-delt-klubb">' + esc(klubb) + '</span>' : '') + '</div>';
  }
  var html = '', dag = null, nesteMerket = false;
  for (var i = 0; i < kamper.length; i++) {
    var k = kamper[i];
    if (k.dato !== dag) {
      dag = k.dato;
      var p = String(dag).split('-');
      var dt = p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null;
      html += '<div class="sk-live-seksjon">' + (dt ? dager[dt.getDay()] + ' ' + dt.getDate() + '. ' + mnd[dt.getMonth()] : 'Uten tidspunkt') + '</div>';
    }
    var spilt = k.sett && k.sett.length;
    var mine = k.sp1.concat(k.sp2).some(function(s) { return erSoktSpiller(s.navn); });
    var neste = !spilt && !nesteMerket;
    if (neste) nesteMerket = true;
    html += '<div class="sk-live-kamp' + (mine ? ' sk-live-kamp-mine' : '') + (neste ? ' sk-prog-neste' : '') + '">'
      + '<div class="sk-live-kamp-top">'
      + '<span class="sk-live-disc">' + esc(k.runde || '') + '</span>'
      + '<span class="sk-live-tid">' + esc(k.kl || '') + (k.nr ? ' · #' + esc(k.nr) : '') + '</span>'
      + '</div>'
      + lag(k.sp1, k.vinner === 1)
      + lag(k.sp2, k.vinner === 2)
      + (spilt ? '<div class="sk-res-sett">' + esc(k.sett.join(', ')) + '</div>' : '')
      + '</div>';
  }
  return html;
}

function lukkProgram() {
  var el = document.getElementById('sk-prog-overlay');
  if (el) el.remove();
  _prog = null;
}

function lukkDeltakere() {
  var el = document.getElementById('sk-delt-overlay');
  if (el) el.remove();
}

// ── Terminliste ───────────────────────────────────────────────────────────
// GetSeasonPlan med portalens egen payload-form: agegroupids/classids må være
// arrayer av *strenger*, og classids må være satt (['0'] = alle) – ellers
// ignorerer tjenesten filtrene og returnerer hele sesongen. Svaret er én tabell
// der tr.grouphdr starter en ny måned og tr.row er turneringene under den.
var ALDERSKLASSER = [['0','Alle klasser'],['2001','SEN'],['2002','U9'],['2003','U11'],['2004','U13'],
  ['2005','U15'],['2006','U17'],['2007','U19'],['2017','Åpen'],['2008','O35'],['2009','O40'],
  ['2010','O45'],['2011','O50'],['2012','O55'],['2013','O60'],['2014','O65'],['2015','O70'],
  ['2016','O75'],['2018','O80']];
var KRETSER = [['','Hele landet'],['200001','Norges Badmintonforbund (nasjonale)'],['200002','Badmintonkretsen Sør'],['200003','Badmintonkretsen Vest'],
  ['200004','Finnmark'],['200006','Hålogaland'],['200005','Innlandet'],['200007','Midtnorsk Nord'],
  ['200008','Midtnorsk Sør'],['200009','Oslofjorden'],['200011','VBT']];

function sesongId() {
  if (SS) return String(SS);
  var n = new Date();
  return '200' + (n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1);
}

function terminlisteApi(alder, krets) {
  var sesong = sesongId();
  var key = 'termin:' + sesong + ':' + alder + ':' + krets;
  var truffet = cacheGet(key);
  if (truffet) return Promise.resolve(truffet);
  function hent(scf) {
    return api('GetSeasonPlan', {
      seasonid: sesong,
      regionids: krets ? [String(krets)] : null,
      agegroupids: (alder && alder !== '0') ? [String(alder)] : null,
      classids: ['0'],
      strfrom: '', strto: '', strweekno: '', strweekno2: '', georegionids: null,
      clubid: '', disciplines: null, playerid: null, birthdate: null, age: null,
      points: null, gender: null, publicseasonplan: true, showleague: true,
      selectclientfunction: scf, page: 0
    }).then(function(res) { return String((res.d && (res.d.html || res.d.Html)) || res.d || ''); });
  }
  // Visningsvarianten har månedsoverskrifter, frist og lenker, men ingen turnerings-ID.
  // onclick-varianten har SeasonPlan.SelectTournament(tid, cid). Samme filter gir samme
  // rader, så de flettes på tittel – tid trengs for å liste alle klassene i turneringen.
  return Promise.all([hent(null), hent('SeasonPlan.SelectTournament')]).then(function(svar) {
    var grupper = parseTerminliste(svar[0]);
    var tidPerTittel = turneringsIder(svar[1]);
    for (var i = 0; i < grupper.length; i++) {
      for (var j = 0; j < grupper[i].turneringer.length; j++) {
        var t = grupper[i].turneringer[j];
        t.tid = tidPerTittel[t.tittel] || '';
      }
    }
    return cacheSet(key, grupper);
  });
}

function turneringsIder(html) {
  var kart = {};
  var re = /<tr[^>]*onclick=["'][^"']*SeasonPlan\.SelectTournament\((\d+),\s*(\d+)\)[^"']*["'][^>]*>([\s\S]*?)<\/tr>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var doc = new DOMParser().parseFromString('<table><tr>' + m[3] + '</tr></table>', 'text/html');
    var tds = doc.querySelectorAll('td');
    var tittel = tds[3] ? tds[3].textContent.replace(/\s+/g, ' ').trim() : '';
    if (tittel && !kart[tittel]) kart[tittel] = m[1];
  }
  return kart;
}

function parseTerminliste(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var trs = doc.querySelectorAll('tr');
  var grupper = [];
  var naa = null;
  for (var i = 0; i < trs.length; i++) {
    var tr = trs[i];
    var kl = tr.className || '';
    if (kl.indexOf('grouphdr') !== -1) {
      naa = { maaned: tr.textContent.trim(), turneringer: [] };
      grupper.push(naa);
      continue;
    }
    // tablehdr og de nøstede radene i klasse-tabellen har ingen 'row'-klasse
    if (kl.indexOf('row') === -1 || !naa) continue;
    var celle = function(navn) {
      var el = tr.querySelector('td.' + navn);
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    };
    var infoId = '', deltakerId = '', program = '';
    var lenker = tr.querySelectorAll('td.links a');
    for (var j = 0; j < lenker.length; j++) {
      var href = lenker[j].getAttribute('href') || '';
      var m = href.match(/VisInfo\/#(\d+)/);
      if (m) { infoId = m[1]; continue; }
      m = href.match(/DeltagerListe\/#(\d+)/);
      if (m) { deltakerId = m[1]; continue; }
      if (href.indexOf('cup2000') !== -1) program = href.trim();
    }
    var klasser = [];
    var kn = tr.querySelectorAll('td.classnames');
    for (var k = 0; k < kn.length; k++) klasser.push(kn[k].textContent.replace(/\s+/g, ' ').trim());
    naa.turneringer.push({
      uke: celle('week'), dato: celle('date'), tittel: celle('title'),
      frist: celle('lastregistration'), klasser: klasser,
      avlyst: kl.indexOf('cancelled') !== -1,
      infoId: infoId, deltakerId: deltakerId, program: program
    });
  }
  return grupper.filter(function(g) { return g.turneringer.length; });
}

function fristMerke(frist) {
  var d = (frist || '').split('.');
  if (d.length < 3) return '';
  var dato = new Date(parseInt(d[2]), parseInt(d[1]) - 1, parseInt(d[0]));
  var idag = new Date(); idag.setHours(0, 0, 0, 0);
  var dager = Math.round((dato - idag) / 86400000);
  if (dager < 0) return '<span class="sk-termin-frist utgatt">frist gikk ut ' + esc(frist) + '</span>';
  if (dager === 0) return '<span class="sk-termin-frist idag">frist i dag</span>';
  if (dager <= 7) return '<span class="sk-termin-frist snart">frist om ' + dager + ' dag' + (dager === 1 ? '' : 'er') + '</span>';
  return '<span class="sk-termin-frist">frist ' + esc(frist) + '</span>';
}

function visTerminliste() {
  lukkTerminliste();
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-termin-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkTerminliste(); };
  var valg = function(liste, id) {
    return '<select class="sk-delt-velg" id="' + id + '" onchange="terminFilterEndret()">'
      + liste.map(function(v) { return '<option value="' + esc(v[0]) + '">' + esc(v[1]) + '</option>'; }).join('')
      + '</select>';
  };
  overlay.innerHTML = '<div class="sk-gruppe-panel sk-live-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">📅 Terminliste</span>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkTerminliste()">✕</button>'
    + '</div>'
    + '<div class="sk-termin-filtre">' + valg(ALDERSKLASSER, 'sk-termin-alder') + valg(KRETSER, 'sk-termin-krets') + '</div>'
    + '<div id="sk-termin-innhold" style="font-size:12px;color:#888;text-align:center;padding:20px">Laster...</div>'
    + '</div>';
  document.body.appendChild(overlay);
  var pref = terminPref();
  var sett = function(id, liste, verdi) {
    var finnes = liste.some(function(v) { return v[0] === verdi; });
    if (finnes) document.getElementById(id).value = verdi;
  };
  sett('sk-termin-alder', ALDERSKLASSER, String(pref.alder || '0'));
  sett('sk-termin-krets', KRETSER, String(pref.krets || ''));
  lastTerminliste();
}

function terminFilterEndret() {
  lagreTerminPref(document.getElementById('sk-termin-alder').value, document.getElementById('sk-termin-krets').value);
  lastTerminliste();
}

function lastTerminliste() {
  var innhold = document.getElementById('sk-termin-innhold');
  if (!innhold) return;
  var alder = (document.getElementById('sk-termin-alder') || {}).value || '0';
  var krets = (document.getElementById('sk-termin-krets') || {}).value || '';
  innhold.innerHTML = '<div style="font-size:12px;color:#888;text-align:center;padding:20px">Laster...</div>';
  terminlisteApi(alder, krets).then(function(grupper) {
    var el = document.getElementById('sk-termin-innhold');
    if (!el) return;
    el.innerHTML = renderTerminliste(grupper);
    // Sesongen starter i juli, så uten dette åpner lista på måneder som er passert.
    var mnd = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
    var naa = new Date();
    var seksjon = el.querySelector('[data-mnd="' + mnd[naa.getMonth()] + ' ' + naa.getFullYear() + '"]');
    var panel = el.parentNode;
    if (seksjon && panel) panel.scrollTop += seksjon.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  }).catch(function() {
    var el = document.getElementById('sk-termin-innhold');
    if (el) el.innerHTML = '<div style="color:#e94560;font-size:12px;text-align:center;padding:16px">Kunne ikke hente terminlista</div>';
  });
}

function renderTerminliste(grupper) {
  if (!grupper.length) return '<div style="color:#888;font-size:12px;text-align:center;padding:16px">Ingen turneringer</div>';
  var html = '';
  for (var i = 0; i < grupper.length; i++) {
    html += '<div class="sk-live-seksjon" data-mnd="' + esc(grupper[i].maaned) + '">' + esc(grupper[i].maaned) + '</div>';
    var ts = grupper[i].turneringer;
    for (var j = 0; j < ts.length; j++) {
      var t = ts[j];
      var handlinger = '';
      // Når programmet er publisert, erstatter det deltakerlista.
      var cupId = (String(t.program || '').match(/tournamentid=(\d+)/i) || [])[1];
      if (cupId) {
        handlinger += '<button class="sk-termin-btn" onclick="visProgramCup(\'' + escAttrJs(cupId) + '\',\'' + escAttrJs(t.tittel) + '\')">Program</button>';
      } else if (t.deltakerId && t.tid) {
        handlinger += '<button class="sk-termin-btn" onclick="visDeltakereTur(\'' + escAttrJs(t.tid) + '\',\'' + escAttrJs(t.deltakerId) + '\',\'' + escAttrJs(t.tittel) + '\')">Deltakere</button>';
      } else if (t.deltakerId) {
        handlinger += '<button class="sk-termin-btn" onclick="visDeltakereKlasse(\'' + escAttrJs(t.deltakerId) + '\',\'' + escAttrJs(t.tittel) + '\')">Deltakere</button>';
      }
      if (t.infoId) {
        handlinger += '<a class="sk-termin-btn" target="_blank" rel="noopener" href="https://badmintonportalen.no/NBF/Turnering/VisInfo/#' + esc(t.infoId) + '">Info ↗</a>';
      }
      html += '<div class="sk-termin-rad' + (t.avlyst ? ' avlyst' : '') + '">'
        + '<div class="sk-termin-tittel">' + esc(t.tittel)
        + (t.avlyst ? ' <span class="sk-termin-avlyst">avlyst</span>' : '') + '</div>'
        + '<div class="sk-termin-meta">'
        + '<span class="sk-termin-dato">' + esc(t.dato) + '</span>'
        + '<span class="sk-termin-uke">uke ' + esc(t.uke) + '</span>'
        + fristMerke(t.frist)
        + '</div>'
        + (t.klasser.length ? '<div class="sk-termin-klasser">' + t.klasser.map(esc).join(' · ') + '</div>' : '')
        + (handlinger ? '<div class="sk-termin-handlinger">' + handlinger + '</div>' : '')
        + '</div>';
    }
  }
  return html;
}

function lukkTerminliste() {
  var el = document.getElementById('sk-termin-overlay');
  if (el) el.remove();
}

// ── Head-to-head ─────────────────────────────────────────────────────────
// Kjører oppgaver (funksjoner som returnerer Promise) med maks n samtidig.
function h2hPool(oppgaver, n) {
  var res = new Array(oppgaver.length), i = 0;
  function neste() {
    if (i >= oppgaver.length) return Promise.resolve();
    var idx = i++;
    return oppgaver[idx]().then(function(r) { res[idx] = r; }, function() { res[idx] = null; }).then(neste);
  }
  var arbeidere = [];
  for (var w = 0; w < Math.min(n, oppgaver.length); w++) arbeidere.push(neste());
  return Promise.all(arbeidere).then(function() { return res; });
}

function apiHtml(method, data) {
  var key = 'bp:' + method + ':' + JSON.stringify(data);
  var hit = cacheGet(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return api(method, data).then(function(res) {
    return cacheSet(key, String((res.d && (res.d.Html || res.d.html)) || ''));
  });
}

// Profilens "Turneringer"-tabell: klasse-ID → { dato, turnering, klasse }
function h2hProfil(pid, seasonid) {
  return apiHtml('GetPlayerProfile', { seasonid: seasonid, playerid: pid, getplayerdata: true, showUserProfile: true, showheader: false })
    .then(function(html) {
      var fodtM = html.match(/dt<\/h2>\s*(\d{4})/i);
      var klasser = {};
      var i = html.indexOf('<h2>Turneringer</h2>');
      if (i !== -1) {
        var doc = new DOMParser().parseFromString(html.slice(i), 'text/html');
        doc.querySelectorAll('tr').forEach(function(tr) {
          var tds = tr.querySelectorAll('td');
          if (tds.length < 4) return;
          tds[3].querySelectorAll('a').forEach(function(a) {
            var m = (a.getAttribute('href') || '').match(/VisResultater\/#(\d+)/);
            if (m) klasser[m[1]] = { dato: tds[0].textContent.trim(), turnering: tds[2].textContent.trim(), klasse: a.textContent.trim() };
          });
        });
      }
      return { fodt: fodtM ? parseInt(fodtM[1]) : null, klasser: klasser };
    });
}

// Grener i klassen der A (og B, hvis oppgitt) står på resultatlisten: [{ eid, gren }]
function h2hGrener(cid, idA, idB) {
  return apiHtml('SearchTournamentResults', { tournamentclassid: parseInt(cid), clientselectfunction: 'SelectTournamentClass1' })
    .then(function(html) {
      var grener = [];
      html.split('<h2>').slice(1).forEach(function(del) {
        var em = del.match(/SelectEvent\('\d+',\s*'(\d+)'\)/);
        if (em && del.indexOf('VisSpiller/#' + idA + "'") !== -1 && (!idB || del.indexOf('VisSpiller/#' + idB + "'") !== -1)) {
          grener.push({ eid: em[1], gren: del.slice(0, del.indexOf('</h2>')).trim() });
        }
      });
      return grener;
    });
}

// Kamper i en gren der A spilte (og B, hvis oppgitt, sto på andre siden av nettet).
function h2hKamper(cid, eid, idA, idB) {
  return apiHtml('SearchTournamentMatches', { tournamentclassid: String(cid), tournamenteventid: String(eid), clientselectfunction: 'SelectTournamentClass1' })
    .then(function(html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var runde = '', ut = [];
      doc.querySelectorAll('table.matchlist tr').forEach(function(tr) {
        if (tr.classList.contains('headrow')) { runde = tr.textContent.trim(); return; }
        var tds = tr.querySelectorAll('td.player');
        if (tds.length !== 2) return;
        var sider = [0, 1].map(function(si) {
          var spillere = [];
          tds[si].querySelectorAll('a').forEach(function(a) {
            var m = (a.getAttribute('href') || '').match(/VisSpiller\/#(\d+)/);
            spillere.push({ id: m ? m[1] : '', navn: a.textContent.trim() });
          });
          return { spillere: spillere, vinner: tds[si].classList.contains('winner') };
        });
        function har(side, id) { return sider[side].spillere.some(function(p) { return p.id === id; }); }
        var a = har(0, idA) && (!idB || har(1, idB)) ? 0 : har(1, idA) && (!idB || har(0, idB)) ? 1 : -1;
        if (a < 0) return;
        var resEl = tr.querySelector('td.result');
        var score = resEl ? resEl.textContent.trim() : '';
        var wo = /w\.?\s*o/i.test(score);
        var sett = wo ? [] : score.split(',').map(function(s) {
          var p = s.trim().split('/');
          return p.length === 2 ? (a === 0 ? p[0] + '-' + p[1] : p[1] + '-' + p[0]) : s.trim();
        }).filter(Boolean);
        ut.push({ runde: runde, meg: sider[a].spillere, mot: sider[1 - a].spillere, vant: sider[a].vinner, wo: wo, sett: sett });
      });
      return ut;
    });
}

function hentH2H(idA, idB) {
  idA = String(idA); idB = String(idB);
  var naa = parseInt(String(SS).slice(3));
  return Promise.all([h2hProfil(idA, SS), h2hProfil(idB, SS)]).then(function(p) {
    // Ingen vits å lete i sesonger før den yngste var gammel nok til å spille.
    var fodt = Math.max(p[0].fodt || 0, p[1].fodt || 0);
    var fra = Math.max(2013, fodt ? fodt + 6 : 2013);
    var sesonger = [];
    for (var y = naa - 1; y >= fra; y--) sesonger.push('200' + y);
    var oppg = [];
    sesonger.forEach(function(s) {
      oppg.push(function() { return h2hProfil(idA, s); });
      oppg.push(function() { return h2hProfil(idB, s); });
    });
    return h2hPool(oppg, 4).then(function(r) {
      var par = [[p[0], p[1]]];
      for (var i = 0; i < r.length; i += 2) par.push([r[i], r[i + 1]]);
      var felles = [];
      par.forEach(function(pp) {
        if (!pp[0] || !pp[1]) return;
        Object.keys(pp[0].klasser).forEach(function(cid) {
          if (pp[1].klasser[cid]) felles.push(Object.assign({ cid: cid }, pp[0].klasser[cid]));
        });
      });
      return h2hPool(felles.map(function(k) {
        return function() {
          return h2hGrener(k.cid, idA, idB).then(function(grener) {
            return Promise.all(grener.map(function(g) {
              return h2hKamper(k.cid, g.eid, idA, idB).then(function(ks) {
                return ks.map(function(x) {
                  x.gren = g.gren; x.dato = k.dato; x.turnering = k.turnering; x.klasse = k.klasse;
                  return x;
                });
              });
            }));
          });
        };
      }), 4).then(function(res) {
        var alle = [];
        res.forEach(function(perKlasse) { (perKlasse || []).forEach(function(ks) { (ks || []).forEach(function(k) { alle.push(k); }); }); });
        function dkey(d) { var s = String(d || '').split('.'); return (s[2] || '') + (s[1] || '') + (s[0] || ''); }
        alle.sort(function(x, y) { return dkey(y.dato).localeCompare(dkey(x.dato)); });
        return { kamper: alle, fraSesong: fra, tilSesong: naa };
      });
    });
  });
}

function visH2H(motId, motNavn) {
  lukkH2H();
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-h2h-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkH2H(); };
  overlay.innerHTML = '<div class="sk-gruppe-panel sk-live-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">H2H: ' + esc(SN) + ' – ' + esc(motNavn) + '</span>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkH2H()">✕</button>'
    + '</div>'
    + '<div id="sk-h2h-innhold" style="font-size:12px;color:#888;text-align:center;padding:20px">Henter historikk…</div>'
    + '</div>';
  document.body.appendChild(overlay);

  hentH2H(SI, motId).then(function(data) {
    var innhold = document.getElementById('sk-h2h-innhold');
    if (!innhold) return;
    innhold.innerHTML = renderH2H(data, motNavn);
  }).catch(function() {
    var innhold = document.getElementById('sk-h2h-innhold');
    if (innhold) innhold.innerHTML = '<div style="color:#e94560;font-size:12px;text-align:center;padding:16px">Kunne ikke hente historikk</div>';
  });
}

function renderH2H(data, motNavn) {
  if (!data.kamper.length) {
    var periode = data.fraSesong + '/' + String(data.fraSesong + 1).slice(2) + ' – ' + data.tilSesong + '/' + String(data.tilSesong + 1).slice(2);
    return '<div style="color:#888;font-size:12px;text-align:center;padding:16px">Ingen tidligere kamper mot ' + esc(motNavn)
      + '<br><span style="font-size:10px">Sjekket sesongene ' + esc(periode) + '</span></div>';
  }
  var seire = 0, tap = 0;
  data.kamper.forEach(function(k) { if (k.wo) return; if (k.vant) seire++; else tap++; });
  function navn(sp) { return sp.map(function(s) { return esc(s.navn); }).join(' / '); }
  var html = '<div class="sk-h2h-sum"><span class="sk-h2h-tall">' + seire + ' – ' + tap + '</span>'
    + '<span class="sk-h2h-sub">' + esc(SN) + ' mot ' + esc(motNavn) + '</span></div>';
  data.kamper.forEach(function(k) {
    html += '<div class="sk-live-kamp">'
      + '<div class="sk-live-kamp-top">'
      + '<span class="sk-live-disc">' + esc(k.gren) + ' ' + esc(k.klasse) + ' · ' + esc(k.runde) + '</span>'
      + '<span class="sk-live-tid">' + esc(k.dato) + '</span>'
      + '</div>'
      + '<div class="sk-live-disc" style="margin-bottom:3px">' + esc(k.turnering) + '</div>'
      + '<div class="sk-live-sp' + (k.vant ? ' sk-res-vinner' : '') + '">' + navn(k.meg) + '</div>'
      + '<div class="sk-live-sp' + (!k.vant ? ' sk-res-vinner' : '') + '">' + navn(k.mot) + '</div>'
      + '<div class="sk-res-sett">' + (k.wo ? 'W.O.' : esc(k.sett.join(', '))) + '</div>'
      + '</div>';
  });
  return html;
}

function lukkH2H() {
  var el = document.getElementById('sk-h2h-overlay');
  if (el) el.remove();
}

// ── Spillerens siste resultater ─────────────────────────────────────────
var RES_SIDE = 5;
var _res = null;

function visResultater() {
  lukkResultater();
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-resh-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkResultater(); };
  overlay.innerHTML = '<div class="sk-gruppe-panel sk-live-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">📈 ' + esc(SN) + '</span>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkResultater()">✕</button>'
    + '</div>'
    + '<div id="sk-resh-sum"></div>'
    + '<div id="sk-resh-liste"></div>'
    + '<div id="sk-resh-mer" style="font-size:12px;color:#888;text-align:center;padding:16px">Henter resultater…</div>'
    + '</div>';
  document.body.appendChild(overlay);
  _res = { pid: String(SI), sesong: parseInt(String(SS).slice(3)), klasser: [], vist: 0, seire: 0, tap: 0, turneringer: 0 };
  lastFlereResultater();
}

// Fyller _res.klasser (nyeste først) til det finnes nok uviste klasser, eller sesongene er brukt opp.
function resFyllKlasser(st) {
  if (st.klasser.length - st.vist >= RES_SIDE || st.sesong < 2013) return Promise.resolve();
  var sesong = st.sesong--;
  return h2hProfil(st.pid, '200' + sesong).then(function(p) {
    function dkey(d) { var s = String(d || '').split('.'); return (s[2] || '') + (s[1] || '') + (s[0] || ''); }
    var nye = Object.keys(p.klasser).map(function(cid) { return Object.assign({ cid: cid }, p.klasser[cid]); });
    nye.sort(function(x, y) { return dkey(y.dato).localeCompare(dkey(x.dato)); });
    st.klasser = st.klasser.concat(nye);
    if (p.fodt && sesong <= p.fodt + 6) st.sesong = 0;
    return resFyllKlasser(st);
  });
}

function lastFlereResultater() {
  var st = _res;
  var mer = document.getElementById('sk-resh-mer');
  if (mer) mer.innerHTML = 'Henter resultater…';
  resFyllKlasser(st).then(function() {
    var side = st.klasser.slice(st.vist, st.vist + RES_SIDE);
    return h2hPool(side.map(function(k) {
      return function() {
        return h2hGrener(k.cid, st.pid).then(function(grener) {
          return Promise.all(grener.map(function(g) {
            return h2hKamper(k.cid, g.eid, st.pid).then(function(ks) {
              ks.forEach(function(x) { x.gren = g.gren; });
              return ks;
            });
          }));
        }).then(function(perGren) {
          var kamper = [];
          perGren.forEach(function(ks) { ks.forEach(function(x) { kamper.push(x); }); });
          return { k: k, kamper: kamper };
        });
      };
    }), 3).then(function(res) {
      if (st !== _res) return;
      st.vist += side.length;
      var liste = document.getElementById('sk-resh-liste');
      if (!liste) return;
      res.forEach(function(r) {
        if (!r || !r.kamper.length) return;
        st.turneringer++;
        r.kamper.forEach(function(x) { if (x.wo) return; if (x.vant) st.seire++; else st.tap++; });
        liste.insertAdjacentHTML('beforeend', renderResTurnering(r.k, r.kamper, st.pid));
      });
      var sum = document.getElementById('sk-resh-sum');
      if (sum && st.turneringer) {
        sum.innerHTML = '<div class="sk-h2h-sum"><span class="sk-h2h-tall">' + st.seire + ' – ' + st.tap + '</span>'
          + '<span class="sk-h2h-sub">seire og tap i ' + st.turneringer + (st.turneringer === 1 ? ' turnering' : ' turneringer') + '</span></div>';
      }
      var flere = st.vist < st.klasser.length || st.sesong >= 2013;
      if (!mer) return;
      if (flere) mer.innerHTML = '<button class="sk-live-btn" onclick="lastFlereResultater()">Vis flere</button>';
      else mer.innerHTML = st.turneringer ? '' : 'Ingen resultater funnet';
    });
  }).catch(function() {
    if (mer && st === _res) mer.innerHTML = '<span style="color:#e94560">Kunne ikke hente resultater</span>';
  });
}

function renderResTurnering(k, kamper, pid) {
  function navn(sp, klikk) {
    return sp.map(function(s) {
      if (!klikk || !s.id) return esc(s.navn);
      return '<span class="sk-mot-link" onclick="visH2H(\'' + escAttrJs(s.id) + '\',\'' + escAttrJs(s.navn) + '\')">' + esc(s.navn) + '</span>';
    }).join(' / ');
  }
  var html = '<div class="sk-resh-tur">'
    + '<div class="sk-resh-tur-hdr"><span>' + esc(k.turnering) + '</span><span class="sk-live-tid">' + esc(k.dato) + '</span></div>';
  kamper.forEach(function(x) {
    var makker = x.meg.filter(function(s) { return s.id !== pid; });
    html += '<div class="sk-live-kamp">'
      + '<div class="sk-live-kamp-top">'
      + '<span class="sk-live-disc">' + esc(x.gren) + ' ' + esc(k.klasse) + ' · ' + esc(x.runde) + '</span>'
      + '<span class="' + (x.wo ? 'sk-resh-wo' : x.vant ? 'sk-resh-v' : 'sk-resh-t') + '">' + (x.wo ? 'W.O.' : x.vant ? 'Seier' : 'Tap') + '</span>'
      + '</div>'
      + (makker.length ? '<div class="sk-live-disc">med ' + navn(makker, false) + '</div>' : '')
      + '<div class="sk-live-sp">mot ' + navn(x.mot, true) + '</div>'
      + (x.sett.length ? '<div class="sk-res-sett">' + esc(x.sett.join(', ')) + '</div>' : '')
      + '</div>';
  });
  return html + '</div>';
}

function lukkResultater() {
  _res = null;
  var el = document.getElementById('sk-resh-overlay');
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

  if (!SN) { sett('Fyll inn spillernavn.'); return; }

  lagre();

  var gen = ++_hentGen;

  var now0 = new Date();
  var seasonStart = now0.getMonth() >= 6 ? now0.getFullYear() : now0.getFullYear() - 1;
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
      btn.textContent = '🔍 Søk';
      return;
    }
    SI = data.playerid;
    lagreHistorikk(SI, SN, SK);
    lagreSiste(SN, SK);
    visHurtigvalg();
    sett('Henter spillerinfo...');
    return Promise.all([hentRanking(), finnTurneringer()]).then(function(d) {
      if (gen !== _hentGen) return;
      sett('');
      visRanking(d[0]);
      if (!d[1].length) {
        sett('Ingen kommende turneringer funnet.');
      } else {
        d[1].forEach(visTurnering);
      }
      if (_turFeilet) {
        var st = document.getElementById('st');
        st.textContent = (st.textContent ? st.textContent + ' ' : '') + '⚠️ ' + _turFeilet
          + (_turFeilet === 1 ? ' turnering' : ' turneringer') + ' kunne ikke sjekkes. Søk på nytt for å prøve igjen.';
      }
    });
  }).catch(function(e) {
    if (gen !== _hentGen) return;
    sett('Feil: ' + e.message);
  }).finally(function() {
    if (gen === _hentGen) {
      btn.disabled = false;
      btn.textContent = '🔍 Søk';
    }
  });
}

window.onload = function() {
  fullforLenkeInnlogging();
  laster();
  visHurtigvalg();
  sjekkInstallerHjelp();
  var n = document.getElementById('f-navn').value;
  if (n) hent();
};
// ── Installer som app ─────────────────────────────────────────────────────
// Chrome, Samsung Internet og Edge på Android sender beforeinstallprompt når siden
// kan installeres. Da viser vi en egen knapp i stedet for å stole på at folk finner
// det i nettlesermenyen. iOS har ingen slik hendelse, og innebygde nettlesere
// (Facebook, Instagram, Messenger …) kan ikke installere, så der forklarer knappen
// hva man gjør. Banneret vises bare på mobil, aldri i installert app, og «✕» skjuler
// det i INSTALLER_PAUSE_DAGER.
var _installPrompt = null;
var INSTALLER_PAUSE_DAGER = 30;

function erInstallert() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

function erIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function erMobil() {
  return erIOS() || /Android|Mobi/i.test(navigator.userAgent);
}

function erInnebygdNettleser() {
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger|Snapchat|LinkedInApp|Line\/|; wv\)/i.test(navigator.userAgent);
}

function installerPauset() {
  var t = 0;
  try { t = parseInt(localStorage.getItem('sk_installer_skjult') || '0', 10) || 0; } catch(e) {}
  return Date.now() - t < INSTALLER_PAUSE_DAGER * 86400000;
}

function visInstallerBanner(tekst, knapp) {
  if (erInstallert() || !erMobil() || installerPauset()) return;
  var el = document.getElementById('installer-banner');
  if (!el) return;
  document.getElementById('installer-tekst').textContent = tekst || 'Installer Goodminton som app på telefonen';
  document.getElementById('installer-btn').textContent = knapp || 'Installer';
  el.style.display = 'flex';
}

function skjulInstaller(pause) {
  var el = document.getElementById('installer-banner');
  if (el) el.style.display = 'none';
  if (pause) { try { localStorage.setItem('sk_installer_skjult', String(Date.now())); } catch(e) {} }
}

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _installPrompt = e;
  visInstallerBanner();
});

window.addEventListener('appinstalled', function() {
  _installPrompt = null;
  skjulInstaller(false);
});

// Kalles fra window.onload: plattformer uten beforeinstallprompt får veiledning i stedet.
function sjekkInstallerHjelp() {
  if (_installPrompt) return;
  if (erInnebygdNettleser()) visInstallerBanner('Åpne goodminton.no i nettleseren for å installere appen', 'Slik gjør du');
  else if (erIOS()) visInstallerBanner('Legg Goodminton på hjemskjermen som en app', 'Slik gjør du');
}

function installerApp() {
  if (_installPrompt) {
    var p = _installPrompt;
    _installPrompt = null;
    p.prompt();
    // Avbryter man, kan nettleseren sende en ny hendelse senere – da kommer knappen tilbake.
    p.userChoice.then(function() { skjulInstaller(false); }).catch(function() {});
    return;
  }
  visInstallerHjelp();
}

function visInstallerHjelp() {
  lukkInstallerHjelp();
  var steg;
  if (erInnebygdNettleser()) {
    steg = ['Trykk på menyen (<b>⋯</b> eller <b>⋮</b>) i appen du åpnet lenken fra',
            'Velg <b>«Åpne i nettleser»</b> (eller «Åpne i Safari» / «Åpne i Chrome»)',
            'Trykk <b>Installer</b> i banneret øverst på goodminton.no'];
  } else if (erIOS()) {
    steg = ['Trykk på <b>Del</b>-knappen (firkant med pil opp ⬆︎) i Safari',
            'Bla ned og velg <b>«Legg til på Hjem-skjerm»</b>',
            'Trykk <b>Legg til</b>. Goodminton ligger nå blant appene dine'];
  } else {
    steg = ['Åpne nettleserens meny (<b>⋮</b> eller <b>☰</b>)',
            'Velg <b>«Installer app»</b> eller <b>«Legg til på startskjerm»</b>'];
  }
  var overlay = document.createElement('div');
  overlay.className = 'sk-gruppe-overlay';
  overlay.id = 'sk-installer-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) lukkInstallerHjelp(); };
  overlay.innerHTML = '<div class="sk-gruppe-panel">'
    + '<div class="sk-gruppe-hdr">'
    + '<span class="sk-gruppe-tittel">📲 Installer Goodminton</span>'
    + '<button class="sk-gruppe-xbtn" onclick="lukkInstallerHjelp()">✕</button>'
    + '</div>'
    + '<ol class="sk-installer-steg">' + steg.map(function(s) { return '<li>' + s + '</li>'; }).join('') + '</ol>'
    + '<div class="sk-installer-fordel">Appen åpner i fullskjerm uten adresselinje, og du finner den igjen på hjemskjermen.</div>'
    + '</div>';
  document.body.appendChild(overlay);
}

function lukkInstallerHjelp() {
  var el = document.getElementById('sk-installer-overlay');
  if (el) el.remove();
}
