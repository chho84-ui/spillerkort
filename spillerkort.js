/**
 * SPILLERKORT – badmintonportalen.no
 * Viser kommende turneringer, registreringer og kampprogram for én spiller.
 *
 * Konfigurasjon – endre disse for å bytte spiller:
 */
const SPILLER = {
  playerid: '50161',
  navn: 'Oliver Holmefjord',
  klubb: 'Sotra',
};

const SEASON_ID = '2002025'; // 2025/2026
const DATO_FRA  = new Date().toLocaleDateString('nb-NO', { day:'2-digit', month:'2-digit', year:'numeric' }); // i dag

// ─── Hoved-inngangspunkt ───────────────────────────────────────────────────
async function spillerkortMain() {
  const panel = lagPanel();
  document.body.appendChild(panel);
  setStatus(panel, 'Leter etter turneringer…');

  const ctx = window.SR_CallbackContext;
  if (!ctx) {
    setStatus(panel, '❌ Fant ikke SR_CallbackContext – åpne en side på badmintonportalen.no først.');
    return;
  }

  // 1) Hent spillerprofil (ranking)
  const ranking = await hentRanking(ctx);
  visRanking(panel, ranking);

  // 2) Finn kommende turneringer der spiller er påmeldt
  setStatus(panel, 'Søker i terminliste…');
  const turneringer = await finnTurneringer(ctx);

  if (turneringer.length === 0) {
    setStatus(panel, 'Ingen kommende turneringer funnet.');
    return;
  }

  setStatus(panel, null);
  for (const t of turneringer) {
    visTurnering(panel, t);
  }
}

// ─── API-kall ──────────────────────────────────────────────────────────────

async function apiFetch(method, body) {
  const r = await fetch(`/SportsResults/Components/WebService1.asmx/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function hentRanking(ctx) {
  const res = await apiFetch('GetPlayerProfile', {
    callbackcontextkey: ctx,
    seasonid: SEASON_ID,
    playerid: SPILLER.playerid,
    getplayerdata: false,
    showUserProfile: true,
    showheader: false,
  });
  const html = String((res.d && res.d.Html) || res.d || '');

  // Parse rankingtabellen
  const rows = [];
  const re = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const disiplin = m[1].trim();
    const klasse   = m[2].trim();
    const plass    = m[3].trim();
    if (/^\d+$/.test(plass)) {
      rows.push({ disiplin, klasse, plass });
    }
  }
  // Alternativ: bruk <table> struktur
  if (rows.length === 0) {
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    while ((m = trRe.exec(html)) !== null) {
      const tdRe = /<td[^>]*>\s*([\s\S]*?)\s*<\/td>/g;
      const cells = [];
      let cm;
      while ((cm = tdRe.exec(m[1])) !== null) {
        cells.push(cm[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length >= 3 && /^\d+$/.test(cells[cells.length - 1])) {
        rows.push({ disiplin: cells[0], klasse: cells[1], plass: cells[cells.length - 1] });
      }
    }
  }
  return rows;
}

async function finnTurneringer(ctx) {
  // GetSeasonPlan med playerid for kun å få turneringer spiller er påmeldt
  // (parameter playerid filtrerer ikke alltid – vi scanner alle og sjekker)
  const res = await apiFetch('GetSeasonPlan', {
    callbackcontextkey: ctx,
    seasonid: SEASON_ID,
    regionids: null,
    agegroupids: null,
    classids: null,
    strfrom: DATO_FRA,
    strto: '31.12.2026',
    strweekno: '',
    strweekno2: '',
    georegionids: null,
    clubid: '',
    disciplines: null,
    playerid: null,
    birthdate: null,
    age: null,
    points: null,
    gender: null,
    publicseasonplan: true,
    showleague: false,
    selectclientfunction: 'SeasonPlan.SelectTournament',
    page: 0,
  });
  const html = String((res.d && res.d.Html) || res.d || '');

  // Trekk ut alle unike (tournamentId, tournamentClassId) par
  const classRe = /SeasonPlan\.SelectTournament\((\d+),\s*(\d+)\)/g;
  const klasseMap = {}; // tournamentId → [classIds]
  let m;
  while ((m = classRe.exec(html)) !== null) {
    const tid  = m[1];
    const cid  = m[2];
    if (!klasseMap[tid]) klasseMap[tid] = { klasser: [], navn: '', dato: '' };
    klasseMap[tid].klasser.push(cid);
  }

  // Trekk ut turnerings-navn og dato fra HTML
  const navnRe = /SeasonPlan\.SelectTournament\((\d+),\d+\)[^>]*>([\s\S]*?)(?=<\/tr>)/g;
  while ((m = navnRe.exec(html)) !== null) {
    const tid  = m[1];
    const tekst = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (klasseMap[tid] && !klasseMap[tid].navn) {
      // Prøv å hente dato og navn
      const datoM = tekst.match(/\d{2}\.\d{2}\.\d{4}/);
      if (datoM) klasseMap[tid].dato = datoM[0];
      klasseMap[tid].navn = tekst.substring(0, 80);
    }
  }

  // For hvert tournament, sjekk om Oliver er påmeldt
  const funnet = [];
  const tids = Object.keys(klasseMap);
  setStatus(null, `Sjekker ${tids.length} turneringer…`);

  for (const tid of tids) {
    const info = klasseMap[tid];
    const registreringer = [];

    for (const cid of info.klasser) {
      const regRes = await apiFetch('SearchRegistrationsByClass', {
        callbackcontextkey: ctx,
        tournamentclassid: parseInt(cid),
        clientselectfunction: 'SelectTournamentClass1',
      });
      const regHtml = String((regRes.d && regRes.d.Html) || '');

      if (regHtml.indexOf(SPILLER.playerid) !== -1 || regHtml.indexOf(SPILLER.navn) !== -1) {
        const klasse = parseKlasseRegistrering(regHtml, SPILLER.playerid, cid);
        if (klasse) registreringer.push(klasse);

        // Sjekk cup2000-lenke
        const cup2000M = regHtml.match(/cup2000\.dk[^\s"']+tournamentid=(\d+)/i);
        if (cup2000M && !info.cup2000Id) {
          info.cup2000Id  = cup2000M[1];
          info.cup2000Url = 'https://' + cup2000M[0];
        }
      }
    }

    if (registreringer.length > 0) {
      funnet.push({ ...info, tournamentId: tid, registreringer });
    }
  }

  return funnet;
}

function parseKlasseRegistrering(html, playerid, classId) {
  // Finn disiplin-overskrift nærmest spiller-ID
  const idx = html.indexOf(playerid);
  if (idx === -1) return null;

  const before = html.substring(0, idx);
  const h3Idx  = before.lastIndexOf('<h3>');
  const h3End  = before.lastIndexOf('</h3>');
  const disiplin = h3Idx !== -1 ? before.substring(h3Idx + 4, h3End).trim() : 'Ukjent';

  // Finn makker (doubles)
  const rowEnd = html.indexOf('</tr>', idx);
  const rowHtml = html.substring(idx, rowEnd);
  const makkerM = rowHtml.match(/VisSpiller\/#(\d+)'[^>]+>([^<]+)<\/a>/);
  const makker = makkerM ? makkerM[2].trim() : null;

  // Bekreftet?
  const bekreftet = rowHtml.indexOf('checkmark.gif') !== -1;

  return { disiplin, classId, makker, bekreftet };
}

// ─── UI ────────────────────────────────────────────────────────────────────

function lagPanel() {
  // Fjern eksisterende panel
  document.getElementById('spillerkort-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'spillerkort-panel';
  panel.innerHTML = `
    <style>
      #spillerkort-panel {
        position: fixed; top: 0; right: 0; width: 380px; max-width: 100vw;
        height: 100vh; background: #1a1a2e; color: #e0e0e0;
        font-family: -apple-system, Roboto, sans-serif; font-size: 14px;
        z-index: 999999; box-shadow: -4px 0 20px rgba(0,0,0,0.6);
        display: flex; flex-direction: column; overflow: hidden;
      }
      #sk-header {
        background: #16213e; padding: 14px 16px; display: flex;
        justify-content: space-between; align-items: center;
        border-bottom: 2px solid #0f3460;
      }
      #sk-header h2 { margin: 0; font-size: 16px; color: #e94560; }
      #sk-header small { color: #888; font-size: 11px; }
      #sk-close {
        cursor: pointer; color: #888; font-size: 20px; line-height: 1;
        padding: 4px 8px; border-radius: 4px; user-select: none;
      }
      #sk-close:hover { background: #e94560; color: #fff; }
      #sk-body { flex: 1; overflow-y: auto; padding: 12px; }
      .sk-status { color: #aaa; font-style: italic; padding: 8px 0; }
      .sk-section { margin-bottom: 16px; }
      .sk-section h3 {
        font-size: 12px; text-transform: uppercase; letter-spacing: 1px;
        color: #0f3460; background: #16213e; padding: 6px 10px;
        border-left: 3px solid #e94560; margin: 0 0 8px;
      }
      .sk-ranking-grid {
        display: grid; grid-template-columns: 1fr 1fr 1fr;
        gap: 6px; margin-bottom: 8px;
      }
      .sk-rank-chip {
        background: #16213e; border-radius: 8px; padding: 8px;
        text-align: center; border: 1px solid #0f3460;
      }
      .sk-rank-chip .r-disc { font-size: 10px; color: #888; }
      .sk-rank-chip .r-class { font-size: 11px; color: #ccc; }
      .sk-rank-chip .r-plass { font-size: 22px; font-weight: bold; color: #e94560; }
      .sk-turnering {
        background: #16213e; border-radius: 10px; padding: 12px;
        margin-bottom: 10px; border: 1px solid #0f3460;
      }
      .sk-turnering h4 { margin: 0 0 8px; color: #53d8fb; font-size: 13px; }
      .sk-reg-row {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 0; border-top: 1px solid #0f3460;
      }
      .sk-badge {
        font-size: 10px; padding: 2px 6px; border-radius: 10px;
        background: #0f3460; white-space: nowrap;
      }
      .sk-badge.bekreftet { background: #1a7a4e; color: #7fffd4; }
      .sk-disc { flex: 1; font-size: 13px; }
      .sk-makker { font-size: 11px; color: #888; }
      .sk-cup2000-btn {
        display: block; text-align: center; background: #e94560;
        color: #fff; text-decoration: none; padding: 8px; border-radius: 6px;
        margin-top: 8px; font-size: 12px; font-weight: bold;
      }
      .sk-cup2000-btn:hover { background: #c73652; }
      .sk-match-row {
        font-size: 12px; padding: 4px 0;
        border-top: 1px solid #0f3460; display: flex; gap: 8px;
      }
      .sk-match-time { color: #53d8fb; font-weight: bold; min-width: 50px; }
      .sk-match-bane { color: #888; min-width: 40px; }
    </style>
    <div id="sk-header">
      <div>
        <h2>🏸 Spillerkort</h2>
        <small id="sk-player-name">Laster…</small>
      </div>
      <span id="sk-close">✕</span>
    </div>
    <div id="sk-body">
      <div id="sk-status" class="sk-status"></div>
    </div>
  `;

  panel.querySelector('#sk-close').onclick = () => panel.remove();
  panel.querySelector('#sk-player-name').textContent = `${SPILLER.navn} · ${SPILLER.klubb}`;
  return panel;
}

function setStatus(panel, tekst) {
  const el = document.getElementById('sk-status');
  if (el) el.textContent = tekst || '';
}

function visRanking(panel, rows) {
  if (!rows || rows.length === 0) return;
  const body = document.getElementById('sk-body');

  // Filtrer kun HS/HD/MD (Herre- / Blandet-)
  const relevant = rows.filter(r => {
    const d = r.disiplin.toLowerCase();
    return d.includes('single') || d.includes('double') || d.includes('mix') || d.includes('blandet');
  });
  if (relevant.length === 0) return;

  const sec = document.createElement('div');
  sec.className = 'sk-section';
  sec.innerHTML = '<h3>Ranking ' + new Date().getFullYear() + '</h3><div class="sk-ranking-grid" id="sk-rank-grid"></div>';
  body.appendChild(sec);

  const grid = sec.querySelector('#sk-rank-grid');
  for (const r of relevant) {
    const chip = document.createElement('div');
    chip.className = 'sk-rank-chip';
    chip.innerHTML = `
      <div class="r-disc">${r.disiplin}</div>
      <div class="r-class">${r.klasse}</div>
      <div class="r-plass">#${r.plass}</div>
    `;
    grid.appendChild(chip);
  }
}

function visTurnering(panel, t) {
  const body = document.getElementById('sk-body');
  const div = document.createElement('div');
  div.className = 'sk-turnering';

  const rows = t.registreringer.map(r => `
    <div class="sk-reg-row">
      <span class="sk-badge ${r.bekreftet ? 'bekreftet' : ''}">${r.bekreftet ? '✓' : '?'}</span>
      <span class="sk-disc">${r.disiplin}</span>
      ${r.makker ? `<span class="sk-makker">m/ ${r.makker}</span>` : ''}
    </div>
  `).join('');

  const programBtn = t.cup2000Url
    ? `<a class="sk-cup2000-btn" href="${t.cup2000Url}&search=1" target="_blank">📅 Se kampprogram (Cup2000)</a>`
    : `<div style="font-size:11px;color:#666;margin-top:8px;text-align:center">Program ikke publisert ennå</div>`;

  div.innerHTML = `
    <h4>📍 ${t.navn}</h4>
    ${rows}
    ${programBtn}
    <div id="sk-matches-${t.tournamentId}"></div>
  `;
  body.appendChild(div);
}

// ─── Start ─────────────────────────────────────────────────────────────────
spillerkortMain().catch(e => setStatus(null, '❌ Feil: ' + e.message));
