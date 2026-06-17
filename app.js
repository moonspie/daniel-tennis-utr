// USTA + UTR Lookup App

const UTR_PROXY = '/api/utr';
const CURRENT_YEAR = new Date().getFullYear();
const LS_JWT_KEY = 'utr_jwt';

// ─── State ────────────────────────────────────────────────────────────────────

let allPlayers = [];    // Accumulated table rows (search adds, paste replaces)
let sortCol = 'singles';
let sortDir = 'desc';
let utrJwt = '';        // Current JWT; empty = not authenticated
let searchGroups = [];  // [{ query, sources[] }] — current candidate groups

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const namesInput    = document.getElementById('namesInput');
const lookupBtn     = document.getElementById('lookupBtn');
const statusEl      = document.getElementById('status');
const titleEl       = document.getElementById('tournamentTitle');
const tableWrap     = document.getElementById('tableWrap');
const tableBody     = document.getElementById('tableBody');
const emptyMsg      = document.getElementById('emptyMsg');
const progressBar   = document.getElementById('progressBar');
const progressFill  = document.getElementById('progressFill');
const tableControls = document.getElementById('tableControls');
const tableCount    = document.getElementById('tableCountLabel');
const clearTableBtn = document.getElementById('clearTableBtn');

// Auth DOM
const authLogin      = document.getElementById('authLogin');
const authConnected  = document.getElementById('authConnected');
const loginEmail     = document.getElementById('loginEmail');
const loginPassword  = document.getElementById('loginPassword');
const loginBtn       = document.getElementById('loginBtn');
const loginError     = document.getElementById('loginError');
const authUserName   = document.getElementById('authUserName');
const authPowerBadge = document.getElementById('authPowerBadge');
const authExpiry     = document.getElementById('authExpiry');
const logoutBtn      = document.getElementById('logoutBtn');
const cookieFallback = document.getElementById('cookieFallback');
const utrCookieInput = document.getElementById('utrCookieInput');
const cookieStatus   = document.getElementById('cookieStatus');

// Table column toggle
const showMatchesChk = document.getElementById('showMatchesChk');
const playerTable    = document.getElementById('playerTable');

// Search DOM
const tabSearch      = document.getElementById('tabSearch');
const tabPaste       = document.getElementById('tabPaste');
const searchSection  = document.getElementById('searchSection');
const pasteSection   = document.getElementById('pasteSection');
const searchNameEl   = document.getElementById('searchName');
const searchBtn      = document.getElementById('searchBtn');
const candidateArea  = document.getElementById('candidateArea');
const candidateMsg   = document.getElementById('candidateMsg');
const candidateList  = document.getElementById('candidateList');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function clearStatus() {
  statusEl.className = '';
  statusEl.textContent = '';
}

function setProgress(pct) {
  progressBar.classList.toggle('visible', pct > 0 && pct < 100);
  progressFill.style.width = pct + '%';
}

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function jwtExpired(token) {
  const p = parseJwt(token);
  if (!p?.exp) return false;
  return p.exp * 1000 < Date.now();
}

function jwtExpiryLabel(token) {
  const p = parseJwt(token);
  if (!p?.exp) return '';
  const d = new Date(p.exp * 1000);
  const days = Math.round((d - Date.now()) / 86400000);
  if (days <= 0)  return '(expired)';
  if (days === 1) return '(expires tomorrow)';
  if (days <= 14) return `(expires in ${days} days)`;
  return '';
}

// ─── Auth State ───────────────────────────────────────────────────────────────

function setAuthConnected(jwt, meData) {
  utrJwt = jwt;
  localStorage.setItem(LS_JWT_KEY, jwt);

  const p = parseJwt(jwt);
  const firstName = p?.firstName || p?.given_name || '';
  const lastName  = p?.lastName  || p?.family_name || '';
  const email     = p?.email || '';
  const name      = [firstName, lastName].filter(Boolean).join(' ') || email || 'UTR User';

  let isPower = false;
  if (meData) {
    isPower = meData.isPoweredBySubscription || meData.isPowered ||
              (meData.subscription?.type || '').toLowerCase().includes('power');
  } else {
    const roles   = (p?.Roles || p?.roles || []);
    const subType = (p?.subscriptionType || p?.SubscriptionType || p?.membershipType || '').toLowerCase();
    isPower = roles.includes('POWER') || roles.includes('Power') ||
              subType.includes('power') || subType === 'premium';
  }

  authUserName.textContent = name;
  authPowerBadge.textContent = isPower ? 'Power' : 'Member';
  authPowerBadge.className = isPower ? 'badge-power' : 'badge-standard';
  authExpiry.textContent = jwtExpiryLabel(jwt);

  authLogin.style.display = 'none';
  cookieFallback.style.display = 'none';
  authConnected.style.display = 'flex';
}

function setAuthDisconnected() {
  utrJwt = '';
  localStorage.removeItem(LS_JWT_KEY);
  authConnected.style.display = 'none';
  authLogin.style.display = 'flex';
  loginEmail.value = '';
  loginPassword.value = '';
  loginError.style.display = 'none';
}

function loadStoredAuth() {
  const stored = localStorage.getItem(LS_JWT_KEY);
  if (!stored) return;
  if (jwtExpired(stored)) { localStorage.removeItem(LS_JWT_KEY); return; }
  setAuthConnected(stored, null);
  fetchMe(stored).then(me => { if (me) setAuthConnected(stored, me); }).catch(() => {});
}

// ─── UTR Auth API ─────────────────────────────────────────────────────────────

async function fetchMe(jwt) {
  try {
    const res = await fetch(`${UTR_PROXY}?path=/api/v1/me`, {
      headers: { 'X-Utr-Cookie': `jwt=${jwt}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function loginUTR(email, password) {
  const res = await fetch(`${UTR_PROXY}?path=/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.Message || data.message || data.error || '';
    throw new Error(msg || `Login failed (${res.status})`);
  }
  const jwt = data._jwt || data.jwt || data.token || data.accessToken || '';
  if (!jwt) throw new Error('Login succeeded but no token was returned. Try the cookie method instead.');
  return jwt;
}

// ─── UTR API Proxy ────────────────────────────────────────────────────────────

function utrHeaders() {
  const h = {};
  if (utrJwt) h['X-Utr-Cookie'] = `jwt=${utrJwt}`;
  return h;
}

async function utrFetch(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`${UTR_PROXY}?${qs}`, { headers: utrHeaders() });
  if (!res.ok) throw new Error(`UTR API error: ${res.status}`);
  return res.json();
}

// ─── USTA Paste Parser ────────────────────────────────────────────────────────

function toTitleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function abbreviateEvent(event) {
  if (!event) return '';
  const m = event.match(/(Boys|Girls)'?\s+(\d+)\s*&\s*under/i);
  if (!m) return '';
  return m[1][0].toUpperCase() + m[2];
}

function parseUstaDump(raw) {
  const players = [];
  const seen = new Set();

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    const cols = trimmed.split(/\s{2,}|\t+/);

    // USTA adds a leading rank/seed number column before tournament starts
    const offset = /^\d+$/.test(cols[0] || '') ? 1 : 0;

    const nameCol = cols[offset] || '';
    const nameMatch = nameCol.match(/^([A-Z][A-Z\s\-']*),\s*(.+)$/);
    if (!nameMatch) continue;

    const lastName  = toTitleCase(nameMatch[1].trim());
    const firstName = nameMatch[2].trim();

    let event = '', city = '', state = '';
    if (cols.length >= offset + 4) {
      event = cols[offset + 1]?.trim() || '';
      const cityState = cols[offset + 2]?.trim() || '';
      const csMatch = cityState.match(/^(.+),\s*([A-Z]{2})$/);
      if (csMatch) { city = csMatch[1].trim(); state = csMatch[2].trim(); }
      else { city = cityState; }
    } else if (cols.length >= offset + 2) {
      event = cols[offset + 1]?.trim() || '';
    }

    const key = `${firstName} ${lastName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    players.push({ firstName, lastName, event, city, state });
  }

  return players;
}

// ─── UTR Player Search ────────────────────────────────────────────────────────

function normCity(c) {
  return (c || '').toLowerCase().replace(/\s+/g, '');
}

// Returns the single best match (for bulk paste lookup)
async function searchUtrPlayer(firstName, lastName, city = '', state = '') {
  const baseName = `${firstName} ${lastName}`.trim();
  const hits = ((await utrFetch('/api/v2/search/players', { query: baseName, top: 10 })).hits) || [];
  if (!hits.length) return null;

  const nameLower   = baseName.toLowerCase();
  const targetCity  = normCity(city);
  const targetState = (state || '').toLowerCase().trim();

  const scored = hits.map(h => {
    const src = h.source;
    const fullName = `${src.firstName} ${src.lastName}`.toLowerCase();
    let score = 0;
    if (fullName === nameLower) score += 100;

    const locDisplay = src.location?.display || '';
    const locParts   = locDisplay.split(',');
    const srcCity    = normCity(src.location?.city || src.location?.cityName || locParts[0]);
    const srcState   = (src.location?.state || src.location?.stateName || locParts[1] || '').toLowerCase().trim();

    if (targetCity && srcCity  && srcCity  === targetCity)  score += 20;
    if (targetState && srcState && srcState === targetState) score += 10;
    return { src, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.src || null;
}

// Parse one search line: "Name" | "Name, City" | "Name, Age" | "Name, City, Age"
// Age tokens: "12", "B12", "G14", "16", etc.
function parseSearchLine(line) {
  const parts = line.split(',').map(s => s.trim()).filter(Boolean);
  const name = parts[0] || '';
  let city = '', ageHint = '';
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (/^[BGbg]?\d+$/.test(p)) {
      ageHint = p.replace(/^[BGbg]/i, '');  // "B12" -> "12"
    } else {
      city = p;
    }
  }
  return { name, city, ageHint };
}

// Map UTR's ageRange (e.g. "U13") to standard junior category (e.g. "12")
// Only returns recognized values; hides "U3" and other data artefacts
function normalizeAgeRange(ageRange) {
  if (!ageRange) return '';
  const m = ageRange.match(/^U(\d+)$/i);
  if (m) {
    const n = parseInt(m[1]) - 1;  // U13 -> 12, U15 -> 14, U17 -> 16
    const valid = [10, 12, 14, 16, 18];
    return valid.includes(n) ? String(n) : '';
  }
  if (/^\d+-\d+$/.test(ageRange)) return ageRange;  // "14-18"
  return '';
}

// Returns top N candidates scored by city + age hints
async function searchUtrCandidates(name, city = '', ageHint = '') {
  const hits = ((await utrFetch('/api/v2/search/players', { query: name.trim(), top: 8 })).hits) || [];
  let sources = hits.map(h => h.source);

  if (!city && !ageHint) return sources.slice(0, 5);

  const targetCity = normCity(city);
  const targetAge  = parseInt(ageHint) || 0;

  const scored = sources.map(src => {
    let score = 0;
    const srcCity = normCity(src.location?.cityName || src.location?.display?.split(',')[0]);
    if (targetCity && srcCity && srcCity === targetCity) score += 20;

    if (targetAge) {
      const normalized = normalizeAgeRange(src.ageRange || '');
      if (normalized && parseInt(normalized) === targetAge) score += 15;
    }
    return { src, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map(s => s.src);
}

async function fetchUtrProfile(utrId) {
  try { return await utrFetch(`/api/v2/player/${utrId}`); } catch { return null; }
}

async function fetchUtrResults(utrId, year = CURRENT_YEAR) {
  try {
    return await utrFetch(`/api/v1/player/${utrId}/results`, { type: 'singles', year });
  } catch { return null; }
}

function applyUtrRating(player, src) {
  if (!src) return;
  const isReal = v => v && !String(v).includes('.xx');
  if (src.singlesUtr)  player.singles  = src.singlesUtr;
  if (src.doublesUtr)  player.doubles  = src.doublesUtr;
  if (isReal(src.singlesUtrDisplay))          player.singlesDisplay = src.singlesUtrDisplay;
  else if (src.singlesUtrDisplay && !player.singlesDisplay) player.singlesDisplay = src.singlesUtrDisplay;
  if (isReal(src.doublesUtrDisplay))          player.doublesDisplay = src.doublesUtrDisplay;
  else if (src.doublesUtrDisplay && !player.doublesDisplay) player.doublesDisplay = src.doublesUtrDisplay;
  if (src.ratingStatusSingles) player.singlesStatus = src.ratingStatusSingles;
  if (src.ratingStatusDoubles) player.doublesStatus = src.ratingStatusDoubles;
}

function formatScore(scoreObj) {
  if (!scoreObj) return '';
  return Object.values(scoreObj)
    .map(s => `${s.winner}-${s.loser}${s.tiebreak != null ? `(${s.tiebreak})` : ''}`)
    .join(', ');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function parseRecentMatches(resultsData, utrId, maxMatches = 5) {
  if (!resultsData?.events) return [];
  const matches = [];
  const uid = String(utrId);

  for (const event of resultsData.events) {
    for (const draw of event.draws || []) {
      for (const result of draw.results || []) {
        const { players, score, date } = result;
        if (!players) continue;
        const isWinner = (players.winner1?.id === uid || players.winner2?.id === uid);
        const isLoser  = (players.loser1?.id  === uid || players.loser2?.id  === uid);
        if (!isWinner && !isLoser) continue;
        const opponent = isWinner
          ? (players.loser1  || players.loser2)
          : (players.winner1 || players.winner2);
        matches.push({
          won: isWinner,
          oppName:       opponent ? `${opponent.firstName} ${opponent.lastName}` : '?',
          oppUtrDisplay: opponent?.singlesUtrDisplay || '--',
          score:         formatScore(score),
          date,
        });
      }
    }
  }

  matches.sort((a, b) => new Date(b.date) - new Date(a.date));
  return matches.slice(0, maxMatches);
}

// ─── Candidate Cards ──────────────────────────────────────────────────────────

function candidateCardHtml(src, gi, ci) {
  const loc      = src.location?.display || '';
  const ageLabel = normalizeAgeRange(src.ageRange || '');
  const utrHint  = (src.threeMonthRating && src.threeMonthRating > 0)
    ? `~${src.threeMonthRating.toFixed(1)}`
    : (src.utrRange ? `${src.utrRange.minUtr}–${src.utrRange.maxUtr}` : '?');
  const added = allPlayers.some(p => String(p.utrProfileId) === String(src.id));
  return `<div class="candidate-card${added ? ' added' : ''}" data-gi="${gi}" data-ci="${ci}">
    <div class="c-name">${src.firstName} ${src.lastName}</div>
    <div class="c-loc">${loc || 'Unknown location'}</div>
    <div class="c-utr">UTR ${utrHint}${ageLabel ? `<span class="c-age"> &middot; ${ageLabel}</span>` : ''}</div>
    <span class="c-add">${added ? 'x Remove' : '+ Add'}</span>
  </div>`;
}

function renderSearchGroups(groups) {
  searchGroups = groups;
  candidateArea.style.display = 'block';

  const hasAny = groups.some(g => g.sources.length > 0);
  if (!hasAny) {
    candidateMsg.textContent = 'No players found. Try a different spelling.';
    candidateList.innerHTML = '';
    return;
  }

  candidateMsg.textContent = groups.length === 1
    ? 'Click the correct player to add to the table:'
    : `Results for ${groups.length} names — click each correct player to add:`;

  candidateList.innerHTML = groups.map((group, gi) => {
    const cards = group.sources.map((src, ci) => candidateCardHtml(src, gi, ci)).join('');

    if (groups.length === 1) {
      // Single query: no group label needed
      return `<div class="group-cards">${cards}</div>`;
    }

    const countTag = group.sources.length === 0
      ? '<span class="g-none">no results</span>'
      : `<span class="g-count">${group.sources.length} result${group.sources.length > 1 ? 's' : ''}</span>`;

    return `<div class="search-group">
      <div class="group-label"><span class="g-query">${group.query}</span>${countTag}</div>
      <div class="group-cards">${cards}</div>
    </div>`;
  }).join('');
}

// ─── Add Player from Search ───────────────────────────────────────────────────

async function addFromCandidate(src) {
  // Ignore click if already added
  if (allPlayers.some(p => String(p.utrProfileId) === String(src.id))) return;

  const player = {
    firstName:    src.firstName,
    lastName:     src.lastName,
    city:         src.location?.cityName || src.location?.display?.split(',')[0]?.trim() || '',
    state:        src.location?.stateName || src.location?.display?.split(',')[1]?.trim() || '',
    utrProfileId: src.id,
    event:        src.ageRange || '',
    loading:      true,
    singles:      -1,
    doubles:      -1,
  };

  // Apply whatever the search result already has (will be masked)
  applyUtrRating(player, src);

  allPlayers.push(player);
  showTable();
  renderTable(allPlayers);
  // Refresh cards to show "Added" state
  if (searchGroups.length) renderSearchGroups(searchGroups);

  try {
    const [profile, results] = await Promise.all([
      fetchUtrProfile(src.id),
      fetchUtrResults(src.id),
    ]);
    applyUtrRating(player, profile);
    if (results) {
      player.wins    = results.wins;
      player.losses  = results.losses;
      player.matches = parseRecentMatches(results, src.id);
      applyUtrRating(player, results);
    }
  } catch (err) {
    console.warn(`UTR fetch failed for ${src.firstName} ${src.lastName}:`, err.message);
  }

  player.loading = false;
  renderTable(allPlayers);
  if (searchGroups.length) renderSearchGroups(searchGroups);
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

function ratingBadge(status) {
  if (!status) return '';
  const cls = status === 'Rated' ? 'rated' : status === 'Projected' ? 'projected' : 'unrated';
  return `<span class="utr-badge badge-${cls}">${status}</span>`;
}

function showTable() {
  tableWrap.style.display = 'block';
  tableControls.style.display = 'flex';
  emptyMsg.style.display = 'none';
}

function hideTable() {
  tableWrap.style.display = 'none';
  tableControls.style.display = 'none';
}

function updateTableCount() {
  const n = allPlayers.length;
  tableCount.textContent = `${n} player${n !== 1 ? 's' : ''} in table`;
}

function removePlayer(idx) {
  allPlayers.splice(idx, 1);
  if (!allPlayers.length) {
    hideTable();
    clearStatus();
    titleEl.style.display = 'none';
  } else {
    renderTable(allPlayers);
    if (searchGroups.length) renderSearchGroups(searchGroups);
  }
}

function renderTable(players) {
  updateTableCount();

  const sorted = [...players].map((p, origIdx) => ({ ...p, _origIdx: origIdx }))
    .sort((a, b) => {
      let va = a[sortCol] ?? -1;
      let vb = b[sortCol] ?? -1;
      if (sortCol === 'name') {
        va = `${a.lastName} ${a.firstName}`.toLowerCase();
        vb = `${b.lastName} ${b.firstName}`.toLowerCase();
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });

  tableBody.innerHTML = '';
  sorted.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = renderRow(p, i + 1, p._origIdx);
    tableBody.appendChild(tr);
  });

  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function renderRow(p, rank, origIdx) {
  const location = [p.city, p.state].filter(Boolean).join(', ');
  const utrUrl   = p.utrProfileId ? `https://app.utrsports.net/profiles/${p.utrProfileId}` : null;
  const nameCell = utrUrl
    ? `<a href="${utrUrl}" target="_blank">${p.firstName} ${p.lastName}</a>`
    : `${p.firstName} ${p.lastName}`;

  const eventAbbr = abbreviateEvent(p.event);
  const eventTag  = eventAbbr
    ? `<span class="event-tag" title="${p.event || ''}">${eventAbbr}</span>`
    : '';

  const singlesCell = p.loading
    ? `<span class="loading-cell">loading...</span>`
    : p.utrProfileId
      ? `<span class="utr-score">${p.singlesDisplay || '--'}</span>${ratingBadge(p.singlesStatus)}`
      : `<span class="no-utr">Not found</span>`;

  const doublesCell = p.loading ? ''
    : p.utrProfileId
      ? `<span class="utr-score">${p.doublesDisplay || '--'}</span>${ratingBadge(p.doublesStatus)}`
      : '';

  const wlCell = p.loading ? '' : `<span class="wl-num wins">${p.wins != null ? p.wins : '--'}</span> / <span class="wl-num losses">${p.losses != null ? p.losses : '--'}</span>`;

  const matchesCell = p.loading ? '' : (p.matches || []).map(m => {
    const wl = m.won ? `<span class="match-win">W</span>` : `<span class="match-loss">L</span>`;
    return `<div>${wl} <span class="match-opp">${m.oppName}</span> <span class="match-score">(${m.oppUtrDisplay})</span> <span class="match-score">${m.score}</span> <span class="match-date">${formatDate(m.date)}</span></div>`;
  }).join('');

  return `
    <td class="rank">${rank}</td>
    <td class="name">${nameCell}${eventTag}${location ? `<div class="location">${location}</div>` : ''}</td>
    <td>${singlesCell}</td>
    <td>${doublesCell}</td>
    <td class="wl">${wlCell}</td>
    <td class="matches matches-col">${matchesCell}</td>
    <td class="remove-col"><button class="remove-btn" data-orig="${origIdx}" title="Remove">x</button></td>
  `;
}

// ─── Bulk Paste Lookup Flow ───────────────────────────────────────────────────

async function runLookup(names) {
  lookupBtn.disabled = true;
  hideTable();
  emptyMsg.style.display = 'none';
  titleEl.style.display = 'none';
  clearStatus();
  setProgress(5);

  titleEl.textContent = `Lookup — ${names.length} player${names.length !== 1 ? 's' : ''}`;
  titleEl.style.display = 'block';
  showStatus(`Looking up ${names.length} players on UTR...`);
  showTable();

  // Paste mode replaces current table
  allPlayers = names.map(n => ({ ...n, loading: true, singles: -1, doubles: -1 }));
  renderTable(allPlayers);

  const BATCH = 5;
  let done = 0;

  for (let i = 0; i < allPlayers.length; i += BATCH) {
    const batch = allPlayers.slice(i, i + BATCH);
    await Promise.all(batch.map(async (player) => {
      try {
        const utrPlayer = await searchUtrPlayer(player.firstName, player.lastName, player.city, player.state);
        if (utrPlayer) {
          player.utrProfileId = utrPlayer.id;
          applyUtrRating(player, utrPlayer);
          const [profile, results] = await Promise.all([
            fetchUtrProfile(utrPlayer.id),
            fetchUtrResults(utrPlayer.id),
          ]);
          applyUtrRating(player, profile);
          if (results) {
            player.wins    = results.wins;
            player.losses  = results.losses;
            player.matches = parseRecentMatches(results, utrPlayer.id);
            applyUtrRating(player, results);
          }
        }
      } catch (err) {
        console.warn(`UTR lookup failed for ${player.firstName} ${player.lastName}:`, err.message);
      }
      player.loading = false;
      done++;
      setProgress(5 + Math.round((done / allPlayers.length) * 93));
    }));
    renderTable(allPlayers);
  }

  setProgress(100);
  const found = allPlayers.filter(p => p.utrProfileId).length;
  showStatus(`Done. Found UTR profiles for ${found} of ${allPlayers.length} players.`, 'success');
  setTimeout(() => setProgress(0), 800);
  lookupBtn.disabled = false;
}

async function handleLookup() {
  const raw = namesInput.value.trim();
  if (!raw) { showStatus('Please paste at least one player name.', 'error'); return; }

  const isUstaDump = raw.split('\n').some(l => /^(?:\d+\s+)?[A-Z][A-Z\s\-']*,\s+[A-Z][a-z]/.test(l.trim()));

  let names;
  if (isUstaDump) {
    names = parseUstaDump(raw);
    if (!names.length) {
      showStatus('Could not parse player names. Make sure you copied from the USTA Players tab.', 'error');
      return;
    }
  } else {
    names = raw.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s+/);
        return { firstName: parts.slice(0, -1).join(' ') || parts[0], lastName: parts.slice(-1)[0] || '' };
      });
  }

  await runLookup(names);
}

// ─── Name Search ─────────────────────────────────────────────────────────────

async function handleSearch() {
  const raw = searchNameEl.value.trim();
  if (!raw) return;

  // Split into lines; each line is one query (name, or "Name City" for better matching)
  const queries = raw.split('\n').map(l => l.trim()).filter(Boolean);

  searchBtn.disabled = true;
  searchBtn.textContent = queries.length > 1 ? `Searching ${queries.length}...` : 'Searching...';
  candidateArea.style.display = 'none';

  try {
    // Parse each line and run all queries in parallel
    const groups = await Promise.all(
      queries.map(async (q) => {
        try {
          const { name, city, ageHint } = parseSearchLine(q);
          const sources = await searchUtrCandidates(name, city, ageHint);
          return { query: q, sources };
        } catch {
          return { query: q, sources: [] };
        }
      })
    );
    renderSearchGroups(groups);
  } catch (err) {
    candidateArea.style.display = 'block';
    candidateMsg.textContent = `Search failed: ${err.message}`;
    candidateList.innerHTML = '';
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// Tab switching
tabSearch.addEventListener('click', () => {
  tabSearch.classList.add('active');
  tabPaste.classList.remove('active');
  searchSection.style.display = 'block';
  pasteSection.style.display = 'none';
});

tabPaste.addEventListener('click', () => {
  tabPaste.classList.add('active');
  tabSearch.classList.remove('active');
  pasteSection.style.display = 'block';
  searchSection.style.display = 'none';
});

// Search
searchBtn.addEventListener('click', handleSearch);
// Ctrl/Cmd+Enter triggers search from textarea (Enter = newline for multi-line)
searchNameEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSearch();
});

// Candidate card click (delegated) — toggle: click to add, click again to remove
candidateList.addEventListener('click', e => {
  const card = e.target.closest('.candidate-card');
  if (!card) return;
  const gi  = parseInt(card.dataset.gi, 10);
  const ci  = parseInt(card.dataset.ci, 10);
  const src = searchGroups[gi]?.sources[ci];
  if (!src) return;

  if (card.classList.contains('added')) {
    // Toggle off: find and remove from table
    const idx = allPlayers.findIndex(p => String(p.utrProfileId) === String(src.id));
    if (idx >= 0) removePlayer(idx);
  } else {
    addFromCandidate(src);
  }
});

// Clear paste input
document.getElementById('clearInputBtn').addEventListener('click', () => {
  namesInput.value = '';
  namesInput.focus();
});

// Paste lookup
lookupBtn.addEventListener('click', handleLookup);
namesInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleLookup();
});

// Sort
document.querySelectorAll('thead th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'name' ? 'asc' : 'desc';
    }
    renderTable(allPlayers);
  });
});

// Remove row (delegated)
tableBody.addEventListener('click', e => {
  const btn = e.target.closest('.remove-btn');
  if (!btn) return;
  const origIdx = parseInt(btn.dataset.orig, 10);
  removePlayer(origIdx);
});

// Clear table
clearTableBtn.addEventListener('click', () => {
  allPlayers = [];
  hideTable();
  clearStatus();
  titleEl.style.display = 'none';
  // Refresh cards to un-mark "Added" state
  if (searchGroups.length) renderSearchGroups(searchGroups);
});

// Login
loginBtn.addEventListener('click', async () => {
  const email    = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) {
    loginError.textContent = 'Please enter email and password.';
    loginError.style.display = 'inline';
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';
  loginError.style.display = 'none';
  try {
    const jwt = await loginUTR(email, password);
    setAuthConnected(jwt, null);
    const me = await fetchMe(jwt);
    if (me) setAuthConnected(jwt, me);
  } catch (err) {
    loginError.textContent = err.message;
    loginError.style.display = 'inline';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); });
logoutBtn.addEventListener('click', setAuthDisconnected);

// Cookie fallback
utrCookieInput.addEventListener('input', () => {
  const cookie = utrCookieInput.value.trim();
  if (!cookie) { cookieStatus.textContent = ''; return; }

  const jwtMatch = cookie.match(/\bjwt=([^;]+)/);
  if (jwtMatch) {
    const jwt = jwtMatch[1];
    try {
      const p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      cookieStatus.textContent = `Found JWT for ${p.email || 'unknown'} — `;
      cookieStatus.style.color = '#2e7d32';
      let applyBtn = document.getElementById('cookieApplyBtn');
      if (!applyBtn) {
        applyBtn = document.createElement('button');
        applyBtn.id = 'cookieApplyBtn';
        applyBtn.textContent = 'Apply & Sign In';
        applyBtn.style.cssText = 'margin-left:2px;padding:3px 10px;background:#0a2342;color:white;border:none;border-radius:4px;font-size:0.78rem;cursor:pointer';
        cookieStatus.after(applyBtn);
      }
      applyBtn.onclick = () => {
        setAuthConnected(jwt, null);
        fetchMe(jwt).then(me => { if (me) setAuthConnected(jwt, me); }).catch(() => {});
      };
    } catch {
      cookieStatus.textContent = 'Could not parse JWT. Check that you copied the full Cookie header value.';
      cookieStatus.style.color = '#c62828';
    }
  } else {
    cookieStatus.textContent = 'No UTR JWT found. Make sure you copied the Cookie: header value (not the URL).';
    cookieStatus.style.color = '#c62828';
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

namesInput.value = '';
searchNameEl.value = '';

showMatchesChk.addEventListener('change', () => {
  playerTable.classList.toggle('hide-matches', !showMatchesChk.checked);
});

loadStoredAuth();
