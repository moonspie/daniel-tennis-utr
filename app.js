// USTA + UTR Lookup App

const USTA_GRAPHQL = 'https://prd-usta-kube-tournamentdesk-public-api.clubspark.pro/graphql';
const UTR_PROXY = '/api/utr';
const CURRENT_YEAR = new Date().getFullYear();

// ─── State ────────────────────────────────────────────────────────────────────

let allPlayers = [];
let sortCol = 'singles';
let sortDir = 'desc';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const urlInput = document.getElementById('urlInput');
const loadBtn = document.getElementById('loadBtn');
const loadBtn2 = document.getElementById('loadBtn2');
const namesInput = document.getElementById('namesInput');
const tabUrl = document.getElementById('tabUrl');
const tabManual = document.getElementById('tabManual');
const tabBookmarklet = document.getElementById('tabBookmarklet');
const urlSection = document.getElementById('urlSection');
const manualSection = document.getElementById('manualSection');
const bookmarkletSection = document.getElementById('bookmarkletSection');
const statusEl = document.getElementById('status');
const titleEl = document.getElementById('tournamentTitle');
const tableWrap = document.getElementById('tableWrap');
const tableBody = document.getElementById('tableBody');
const emptyMsg = document.getElementById('emptyMsg');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

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

function extractTournamentId(url) {
  const m = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

function ratingBadge(status) {
  if (!status) return '';
  const cls = status === 'Rated' ? 'rated' : status === 'Projected' ? 'projected' : 'unrated';
  return `<span class="utr-badge badge-${cls}">${status}</span>`;
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

// ─── USTA API ─────────────────────────────────────────────────────────────────

async function fetchUstaParticipants(tournamentId) {
  const query = `
    query getTournamentParticipants($tournamentId: ID!) {
      getTournamentParticipants(tournamentId: $tournamentId) {
        participantId
        participantType
        participantName
        participantStatus
        person {
          personId
          standardGivenName
          standardFamilyName
          sex
          addresses { city state }
        }
        individualParticipants {
          participantId
          participantType
          person {
            personId
            standardGivenName
            standardFamilyName
            sex
            addresses { city state }
          }
        }
      }
    }
  `;

  const res = await fetch(USTA_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { tournamentId } })
  });

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data.getTournamentParticipants || [];
}

async function fetchUstaEvents(tournamentId) {
  const query = `
    query {
      tournamentEventsInfo(tournamentId: "${tournamentId}") {
        eventId
        eventName
        drawCount
      }
    }
  `;
  const res = await fetch(USTA_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const json = await res.json();
  if (json.errors) return [];
  return json.data.tournamentEventsInfo || [];
}

// Extract unique individual players from USTA participants list
function extractPlayers(participants) {
  const seen = new Set();
  const players = [];

  for (const p of participants) {
    // Singles player (INDIVIDUAL type)
    if (p.participantType === 'INDIVIDUAL' && p.person) {
      const key = p.person.personId || p.participantId;
      if (!seen.has(key)) {
        seen.add(key);
        players.push({
          ustaId: p.person.personId,
          firstName: p.person.standardGivenName,
          lastName: p.person.standardFamilyName,
          sex: p.person.sex,
          city: p.person.addresses?.[0]?.city,
          state: p.person.addresses?.[0]?.state,
          status: p.participantStatus,
        });
      }
    }
    // PAIR/TEAM — expand individualParticipants
    if (p.individualParticipants?.length) {
      for (const ip of p.individualParticipants) {
        if (!ip.person) continue;
        const key = ip.person.personId || ip.participantId;
        if (!seen.has(key)) {
          seen.add(key);
          players.push({
            ustaId: ip.person.personId,
            firstName: ip.person.standardGivenName,
            lastName: ip.person.standardFamilyName,
            sex: ip.person.sex,
            city: ip.person.addresses?.[0]?.city,
            state: ip.person.addresses?.[0]?.state,
            status: p.participantStatus,
          });
        }
      }
    }
  }

  return players;
}

// ─── UTR API ──────────────────────────────────────────────────────────────────

async function utrFetch(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`${UTR_PROXY}?${qs}`);
  if (!res.ok) throw new Error(`UTR API error: ${res.status}`);
  return res.json();
}

async function searchUtrPlayer(firstName, lastName) {
  const query = `${firstName} ${lastName}`.trim();
  const data = await utrFetch('/api/v2/search/players', { query, top: 5 });
  const hits = data.hits || [];

  // Try to find exact name match first
  const nameLower = query.toLowerCase();
  const exact = hits.find(h => {
    const src = h.source;
    const full = `${src.firstName} ${src.lastName}`.toLowerCase();
    return full === nameLower;
  });

  if (exact) return exact.source;

  // Fall back to best fuzzy match (first result with a non-zero UTR or any result)
  const rated = hits.find(h => h.source.singlesUtr > 0);
  return (rated || hits[0])?.source || null;
}

async function fetchUtrResults(utrId, year = CURRENT_YEAR) {
  try {
    const data = await utrFetch(`/api/v1/player/${utrId}/results`, { type: 'singles', year });
    return data;
  } catch {
    return null;
  }
}

// Parse recent matches from results data (up to N matches)
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
        const isLoser = (players.loser1?.id === uid || players.loser2?.id === uid);
        if (!isWinner && !isLoser) continue;

        const opponent = isWinner
          ? (players.loser1 || players.loser2)
          : (players.winner1 || players.winner2);

        matches.push({
          won: isWinner,
          oppName: opponent ? `${opponent.firstName} ${opponent.lastName}` : '?',
          oppUtr: opponent?.singlesUtr || 0,
          oppUtrDisplay: opponent?.singlesUtrDisplay || '—',
          score: formatScore(score),
          date,
          eventName: event.name,
        });
      }
    }
  }

  // Sort by date descending
  matches.sort((a, b) => new Date(b.date) - new Date(a.date));
  return matches.slice(0, maxMatches);
}

// ─── Table Rendering ──────────────────────────────────────────────────────────

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
    tr.dataset.id = p.utrId;
    tr.innerHTML = renderRow(p, i + 1);
    tableBody.appendChild(tr);
  });

  // Update sort indicators
  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function renderRow(p, rank) {
  const location = [p.city, p.state].filter(Boolean).join(', ');
  const utrProfileUrl = p.utrId
    ? `https://app.universaltennis.com/profiles/${p.utrId}`
    : null;

  const nameCell = utrProfileUrl
    ? `<a href="${utrProfileUrl}" target="_blank">${p.firstName} ${p.lastName}</a>`
    : `${p.firstName} ${p.lastName}`;

  const singlesCell = p.loading
    ? `<span class="loading-cell">loading…</span>`
    : p.utrProfileId
      ? `<span class="utr-score">${p.singlesDisplay || '—'}</span>${ratingBadge(p.singlesStatus)}`
      : `<span class="no-utr">Not found</span>`;

  const doublesCell = p.loading
    ? ''
    : p.utrProfileId
      ? `<span class="utr-score">${p.doublesDisplay || '—'}</span>${ratingBadge(p.doublesStatus)}`
      : '';

  const winsCell = p.loading ? '' : (p.wins != null ? `<span class="wl-num wins">${p.wins}</span>` : '—');
  const lossesCell = p.loading ? '' : (p.losses != null ? `<span class="wl-num losses">${p.losses}</span>` : '—');

  const matchesCell = p.loading
    ? ''
    : (p.matches || []).map(m => {
        const wl = m.won ? `<span class="match-win">W</span>` : `<span class="match-loss">L</span>`;
        return `<div>${wl} <span class="match-opp">${m.oppName}</span> <span class="match-score">(${m.oppUtrDisplay})</span> <span class="match-score">${m.score}</span> <span class="match-date">${formatDate(m.date)}</span></div>`;
      }).join('');

  return `
    <td class="rank">${rank}</td>
    <td class="name">${nameCell}${location ? `<div class="location">${location}</div>` : ''}</td>
    <td>${singlesCell}</td>
    <td>${doublesCell}</td>
    <td class="wl">${winsCell}</td>
    <td class="wl">${lossesCell}</td>
    <td class="matches">${matchesCell}</td>
  `;
}

// ─── Main Load Flow ───────────────────────────────────────────────────────────

async function loadTournament() {
  const url = urlInput.value.trim();
  if (!url) { showStatus('Please paste a USTA tournament URL.', 'error'); return; }

  const tournamentId = extractTournamentId(url);
  if (!tournamentId) {
    showStatus('Could not find a tournament ID (UUID) in the URL. Please check and try again.', 'error');
    return;
  }

  loadBtn.disabled = true;
  tableWrap.style.display = 'none';
  emptyMsg.style.display = 'none';
  titleEl.style.display = 'none';
  clearStatus();
  setProgress(5);

  try {
    showStatus(`Fetching player list for tournament ${tournamentId}…`);

    const [participants, events] = await Promise.all([
      fetchUstaParticipants(tournamentId),
      fetchUstaEvents(tournamentId),
    ]);

    setProgress(20);

    if (!participants.length) {
      showStatus(
        'No players found. USTA removes past tournament data — this only works for upcoming or recently-started tournaments. Try a URL from playtennis.usta.com for an event that hasn\'t ended yet.',
        'error'
      );
      emptyMsg.style.display = 'block';
      setProgress(0);
      return;
    }

    const players = extractPlayers(participants);

    if (!players.length) {
      showStatus('Player list is empty.', 'error');
      emptyMsg.style.display = 'block';
      setProgress(0);
      return;
    }

    const eventNames = events.map(e => e.eventName).join(', ');
    titleEl.textContent = eventNames
      ? `Tournament: ${eventNames}`
      : `Tournament ID: ${tournamentId}`;
    titleEl.style.display = 'block';

    showStatus(`Found ${players.length} players. Fetching UTR data…`);
    tableWrap.style.display = 'block';

    // Init players with loading state
    allPlayers = players.map(p => ({ ...p, loading: true, singles: -1, doubles: -1 }));
    renderTable(allPlayers);

    // Fetch UTR data for each player concurrently (batched to avoid hammering)
    const BATCH = 5;
    let done = 0;

    for (let i = 0; i < allPlayers.length; i += BATCH) {
      const batch = allPlayers.slice(i, i + BATCH);
      await Promise.all(batch.map(async (player) => {
        try {
          const utrPlayer = await searchUtrPlayer(player.firstName, player.lastName);
          if (utrPlayer) {
            player.utrProfileId = utrPlayer.id;
            player.singles = utrPlayer.singlesUtr || 0;
            player.doubles = utrPlayer.doublesUtr || 0;
            player.singlesDisplay = utrPlayer.singlesUtrDisplay || '—';
            player.doublesDisplay = utrPlayer.doublesUtrDisplay || '—';
            player.singlesStatus = utrPlayer.ratingStatusSingles;
            player.doublesStatus = utrPlayer.ratingStatusDoubles;

            // Fetch results
            const results = await fetchUtrResults(utrPlayer.id);
            if (results) {
              player.wins = results.wins;
              player.losses = results.losses;
              player.matches = parseRecentMatches(results, utrPlayer.id);
            }
          }
        } catch (err) {
          console.warn(`UTR lookup failed for ${player.firstName} ${player.lastName}:`, err.message);
        }
        player.loading = false;
        done++;
        setProgress(20 + Math.round((done / allPlayers.length) * 78));
      }));

      renderTable(allPlayers);
    }

    setProgress(100);
    const found = allPlayers.filter(p => p.utrProfileId).length;
    showStatus(`Done. Found UTR profiles for ${found} of ${allPlayers.length} players.`, 'success');
    setTimeout(() => setProgress(0), 800);

  } catch (err) {
    const msg = err.message.includes('not found')
      ? 'Tournament not found — USTA only keeps data for upcoming/active tournaments. Paste a URL for an event that hasn\'t ended yet.'
      : `Error: ${err.message}`;
    showStatus(msg, 'error');
    setProgress(0);
    console.error(err);
  } finally {
    loadBtn.disabled = false;
  }
}

// ─── Manual Mode ─────────────────────────────────────────────────────────────

async function loadManual() {
  const raw = namesInput.value.trim();
  if (!raw) { showStatus('Please paste at least one player name.', 'error'); return; }

  const names = raw.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split(/\s+/);
      return { firstName: parts.slice(0, -1).join(' ') || parts[0], lastName: parts.slice(-1)[0] || '' };
    });

  loadBtn2.disabled = true;
  tableWrap.style.display = 'none';
  emptyMsg.style.display = 'none';
  titleEl.style.display = 'none';
  clearStatus();
  setProgress(5);

  titleEl.textContent = `Manual lookup — ${names.length} players`;
  titleEl.style.display = 'block';
  showStatus(`Looking up ${names.length} players on UTR…`);
  tableWrap.style.display = 'block';

  allPlayers = names.map(n => ({ ...n, loading: true, singles: -1, doubles: -1 }));
  renderTable(allPlayers);

  const BATCH = 5;
  let done = 0;

  for (let i = 0; i < allPlayers.length; i += BATCH) {
    const batch = allPlayers.slice(i, i + BATCH);
    await Promise.all(batch.map(async (player) => {
      try {
        const utrPlayer = await searchUtrPlayer(player.firstName, player.lastName);
        if (utrPlayer) {
          player.utrProfileId = utrPlayer.id;
          player.singles = utrPlayer.singlesUtr || 0;
          player.doubles = utrPlayer.doublesUtr || 0;
          player.singlesDisplay = utrPlayer.singlesUtrDisplay || '—';
          player.doublesDisplay = utrPlayer.doublesUtrDisplay || '—';
          player.singlesStatus = utrPlayer.ratingStatusSingles;
          player.doublesStatus = utrPlayer.ratingStatusDoubles;
          const results = await fetchUtrResults(utrPlayer.id);
          if (results) {
            player.wins = results.wins;
            player.losses = results.losses;
            player.matches = parseRecentMatches(results, utrPlayer.id);
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
  loadBtn2.disabled = false;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// ─── Bookmarklet ──────────────────────────────────────────────────────────────

function buildBookmarklet() {
  const siteUrl = window.location.origin;
  // This script runs on the USTA Players page in the user's browser.
  // It finds player name elements rendered by the React SPA, collects them,
  // then opens our site with those names pre-filled.
  const script = `(function(){
    var names=new Set();
    // Try multiple selectors that USTA's venue-tournaments app uses for player names
    var selectors=[
      'a[href*="/profiles/"]',
      '[class*="playerName"]',
      '[class*="player-name"]',
      '[class*="participantName"]',
      'td a',
      '[class*="name"] a',
      '[class*="player"] strong',
      'table td:first-child',
      'table td:nth-child(2)',
    ];
    selectors.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(el){
        var t=(el.innerText||el.textContent||'').trim();
        if(t.length>3&&t.length<50&&t.indexOf('@')<0&&/[A-Za-z]/.test(t)&&t.split(' ').length>=2){
          names.add(t);
        }
      });
    });
    if(names.size===0){
      alert('No player names found. Make sure the Players tab is selected and the list has loaded.');
      return;
    }
    var list=Array.from(names).join('\\n');
    var url='${siteUrl}?names='+encodeURIComponent(list);
    window.open(url,'_blank');
  })();`;
  return 'javascript:' + script;
}

function initBookmarklet() {
  const link = document.getElementById('bookmarkletLink');
  if (link) link.href = buildBookmarklet();
}

// ─── Auto-load from URL params (sent by bookmarklet) ─────────────────────────

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const names = params.get('names');
  if (!names) return;
  // Switch to manual tab and pre-fill
  namesInput.value = decodeURIComponent(names);
  tabManual.click();
  // Auto-start lookup
  setTimeout(() => loadManual(), 300);
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function showTab(tab) {
  [tabUrl, tabManual, tabBookmarklet].forEach(b => b.classList.remove('active'));
  [urlSection, manualSection, bookmarkletSection].forEach(s => s.style.display = 'none');
  tab.classList.add('active');
  if (tab === tabUrl) urlSection.style.display = 'block';
  else if (tab === tabManual) manualSection.style.display = 'block';
  else if (tab === tabBookmarklet) { bookmarkletSection.style.display = 'block'; initBookmarklet(); }
}

tabUrl.addEventListener('click', () => showTab(tabUrl));
tabManual.addEventListener('click', () => showTab(tabManual));
tabBookmarklet.addEventListener('click', () => showTab(tabBookmarklet));

loadBtn.addEventListener('click', loadTournament);
loadBtn2.addEventListener('click', loadManual);

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') loadTournament();
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

// ─── Init ─────────────────────────────────────────────────────────────────────

// Show initial tab state correctly
urlSection.style.display = 'block';

// Check if bookmarklet sent names via URL params
checkUrlParams();
