// USTA + UTR Lookup App

const UTR_PROXY = '/api/utr';
const CURRENT_YEAR = new Date().getFullYear();
const LS_JWT_KEY = 'utr_jwt';

// ─── State ────────────────────────────────────────────────────────────────────

let allPlayers = [];
let sortCol = 'singles';
let sortDir = 'desc';
let utrJwt = '';  // Current JWT; empty = not authenticated

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

// Auth DOM
const authLogin     = document.getElementById('authLogin');
const authConnected = document.getElementById('authConnected');
const loginEmail    = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginBtn      = document.getElementById('loginBtn');
const loginError    = document.getElementById('loginError');
const authUserName  = document.getElementById('authUserName');
const authPowerBadge = document.getElementById('authPowerBadge');
const authExpiry    = document.getElementById('authExpiry');
const logoutBtn     = document.getElementById('logoutBtn');
const cookieToggle  = document.getElementById('cookieToggle');
const cookieFallback = document.getElementById('cookieFallback');
const utrCookieInput = document.getElementById('utrCookieInput');
const cookieStatus  = document.getElementById('cookieStatus');

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
  const now = new Date();
  const days = Math.round((d - now) / 86400000);
  if (days <= 0) return '(expired)';
  if (days === 1) return '(expires tomorrow)';
  if (days <= 14) return `(expires in ${days} days)`;
  return '';
}

// ─── Auth State ───────────────────────────────────────────────────────────────

function setAuthConnected(jwt) {
  utrJwt = jwt;
  localStorage.setItem(LS_JWT_KEY, jwt);

  const p = parseJwt(jwt);
  const firstName = p?.firstName || p?.given_name || '';
  const lastName  = p?.lastName  || p?.family_name || '';
  const email     = p?.email || '';
  const name      = [firstName, lastName].filter(Boolean).join(' ') || email || 'UTR User';

  // Power detection — check common JWT claim names
  const roles    = (p?.Roles || p?.roles || []);
  const subType  = (p?.subscriptionType || p?.SubscriptionType || p?.membershipType || '').toLowerCase();
  const isPower  = roles.includes('POWER') || roles.includes('Power') ||
                   subType.includes('power') || subType === 'premium';

  authUserName.textContent = name;
  authPowerBadge.textContent = isPower ? 'Power' : (subType || 'Member');
  authPowerBadge.className = isPower ? 'badge-power' : 'badge-unknown';
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
  if (jwtExpired(stored)) {
    localStorage.removeItem(LS_JWT_KEY);
    return;
  }
  setAuthConnected(stored);
}

// ─── UTR Login (email/password via proxy) ─────────────────────────────────────

async function loginUTR(email, password) {
  const res = await fetch(`${UTR_PROXY}?path=/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || `Login failed (${res.status})`);
  }
  const jwt = data._jwt || data.jwt || data.token || data.accessToken || '';
  if (!jwt) throw new Error('No token returned — email/password login may not be supported. Use the cookie fallback below.');
  return jwt;
}

// ─── UTR API Proxy ────────────────────────────────────────────────────────────

function utrHeaders() {
  const h = {};
  // Build cookie string from stored JWT
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
    const nameCol = cols[0] || '';
    const nameMatch = nameCol.match(/^([A-Z][A-Z\s\-']*),\s*(.+)$/);
    if (!nameMatch) continue;

    const lastName  = toTitleCase(nameMatch[1].trim());
    const firstName = nameMatch[2].trim();

    let event = '', city = '', state = '';
    if (cols.length >= 4) {
      event = cols[1]?.trim() || '';
      const cityState = cols[2]?.trim() || '';
      const csMatch = cityState.match(/^(.+),\s*([A-Z]{2})$/);
      if (csMatch) { city = csMatch[1].trim(); state = csMatch[2].trim(); }
      else { city = cityState; }
    } else if (cols.length >= 2) {
      event = cols[1]?.trim() || '';
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
    const locParts = locDisplay.split(',');
    const srcCity  = normCity(src.location?.city || locParts[0]);
    const srcState = (src.location?.state || locParts[1] || '').toLowerCase().trim();

    if (targetCity && srcCity  && srcCity  === targetCity)  score += 20;
    if (targetState && srcState && srcState === targetState) score += 10;
    return { src, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.src || null;
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
  if (isReal(src.singlesUtrDisplay)) player.singlesDisplay = src.singlesUtrDisplay;
  else if (src.singlesUtrDisplay && !player.singlesDisplay) player.singlesDisplay = src.singlesUtrDisplay;
  if (isReal(src.doublesUtrDisplay)) player.doublesDisplay = src.doublesUtrDisplay;
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
          oppUtr:        opponent?.singlesUtr || 0,
          oppUtrDisplay: opponent?.singlesUtrDisplay || '--',
          score:         formatScore(score),
          date,
          eventName:     event.name,
        });
      }
    }
  }

  matches.sort((a, b) => new Date(b.date) - new Date(a.date));
  return matches.slice(0, maxMatches);
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

function ratingBadge(status) {
  if (!status) return '';
  const cls = status === 'Rated' ? 'rated' : status === 'Projected' ? 'projected' : 'unrated';
  return `<span class="utr-badge badge-${cls}">${status}</span>`;
}

function renderTable(players) {
  const sorted = [...players].sort((a, b) => {
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
    tr.innerHTML = renderRow(p, i + 1);
    tableBody.appendChild(tr);
  });

  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function renderRow(p, rank) {
  const location = [p.city, p.state].filter(Boolean).join(', ');
  const utrUrl   = p.utrProfileId ? `https://app.universaltennis.com/profiles/${p.utrProfileId}` : null;
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

  const winsCell   = p.loading ? '' : (p.wins   != null ? `<span class="wl-num wins">${p.wins}</span>`   : '--');
  const lossesCell = p.loading ? '' : (p.losses != null ? `<span class="wl-num losses">${p.losses}</span>` : '--');

  const matchesCell = p.loading ? '' : (p.matches || []).map(m => {
    const wl = m.won ? `<span class="match-win">W</span>` : `<span class="match-loss">L</span>`;
    return `<div>${wl} <span class="match-opp">${m.oppName}</span> <span class="match-score">(${m.oppUtrDisplay})</span> <span class="match-score">${m.score}</span> <span class="match-date">${formatDate(m.date)}</span></div>`;
  }).join('');

  return `
    <td class="rank">${rank}</td>
    <td class="name">${nameCell}${eventTag}${location ? `<div class="location">${location}</div>` : ''}</td>
    <td>${singlesCell}</td>
    <td>${doublesCell}</td>
    <td class="wl">${winsCell}</td>
    <td class="wl">${lossesCell}</td>
    <td class="matches">${matchesCell}</td>
  `;
}

// ─── Main Lookup Flow ─────────────────────────────────────────────────────────

async function runLookup(names) {
  lookupBtn.disabled = true;
  tableWrap.style.display = 'none';
  emptyMsg.style.display = 'none';
  titleEl.style.display = 'none';
  clearStatus();
  setProgress(5);

  titleEl.textContent = `Lookup — ${names.length} player${names.length !== 1 ? 's' : ''}`;
  titleEl.style.display = 'block';
  showStatus(`Looking up ${names.length} players on UTR...`);
  tableWrap.style.display = 'block';

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

  const isUstaDump = raw.split('\n').some(l => /^[A-Z][A-Z\s\-']*,\s+[A-Z][a-z]/.test(l.trim()));

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

// ─── Event Listeners ──────────────────────────────────────────────────────────

lookupBtn.addEventListener('click', handleLookup);
namesInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleLookup();
});

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

// Login form
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
    setAuthConnected(jwt);
  } catch (err) {
    loginError.textContent = err.message;
    loginError.style.display = 'inline';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

loginPassword.addEventListener('keydown', e => {
  if (e.key === 'Enter') loginBtn.click();
});

logoutBtn.addEventListener('click', setAuthDisconnected);

// Cookie fallback toggle
cookieToggle.addEventListener('click', () => {
  const open = cookieFallback.style.display === 'block';
  cookieFallback.style.display = open ? 'none' : 'block';
});

utrCookieInput.addEventListener('input', () => {
  const cookie = utrCookieInput.value.trim();
  if (!cookie) { cookieStatus.textContent = ''; return; }

  const jwtMatch = cookie.match(/\bjwt=([^;]+)/);
  if (jwtMatch) {
    const jwt = jwtMatch[1];
    try {
      const p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      cookieStatus.textContent = `Found JWT for ${p.email || 'unknown'} — click Apply to log in.`;
      cookieStatus.style.color = '#2e7d32';

      // Show an apply button
      let applyBtn = document.getElementById('cookieApplyBtn');
      if (!applyBtn) {
        applyBtn = document.createElement('button');
        applyBtn.id = 'cookieApplyBtn';
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = 'margin-left:8px;padding:4px 10px;background:#0a2342;color:white;border:none;border-radius:4px;font-size:0.8rem;cursor:pointer';
        cookieStatus.after(applyBtn);
      }
      applyBtn.onclick = () => setAuthConnected(jwt);
    } catch {
      cookieStatus.textContent = 'Could not parse JWT. Check that you copied the full Cookie header.';
      cookieStatus.style.color = '#c62828';
    }
  } else {
    cookieStatus.textContent = 'No UTR JWT found in this cookie string.';
    cookieStatus.style.color = '#c62828';
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadStoredAuth();
