// Usage: UTR_JWT=<token_from_cookie> node debug-utr.js
// Extracts: jwt=<value> from the cookie string and passes it here

const UTR_BASE = 'https://app.universaltennis.com';
const TEST_NAME = 'Audrey Wu';    // city="Mc Lean" VA — test top=10 vs top=3
const TEST_NAME2 = 'Audrey Wu';   // duplicate to test profile of correct id=5511561

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json', 'Origin': UTR_BASE, ...headers } });
  return { status: r.status, body: await r.json() };
}

async function run() {
  const jwt = process.env.UTR_JWT;

  // Special: fetch known correct Audrey Wu directly
  if (jwt) {
    console.log('\n=== Direct v2 profile: Audrey Wu id=5511561 (Mclean VA) ===');
    const p = await get(`${UTR_BASE}/api/v2/player/5511561`, { 'Authorization': `Bearer ${jwt}` });
    console.log(`status=${p.status}  singlesUtr=${p.body?.singlesUtr}  display=${p.body?.singlesUtrDisplay}  loc="${p.body?.location?.display}"`);
  }

  for (const name of [TEST_NAME]) {
    const url = `${UTR_BASE}/api/v2/search/players?query=${encodeURIComponent(name)}&top=10`;

    console.log(`\n======== ${name} ========`);

    // --- No auth ---
    const plain = await get(url);
    const hit0 = plain.body.hits?.[0]?.source;
    console.log(`[no auth]  singlesUtr=${hit0?.singlesUtr}  display=${hit0?.singlesUtrDisplay}  status=${hit0?.ratingStatusSingles}  id=${hit0?.id}`);

    if (!jwt) continue;

    // Show top 3 search hits with details
    const authed = await get(url, { 'Authorization': `Bearer ${jwt}` });
    const hits = authed.body.hits || [];
    console.log(`[JWT auth] ${hits.length} hits (top 10):`);
    const mcleanHit = hits.find(h => h.source?.location?.display?.toLowerCase().includes('mclean') || h.source?.location?.display?.toLowerCase().includes('mc lean'));
    console.log(`  -> McLean VA hit: ${mcleanHit ? `id=${mcleanHit.source.id} rank=${hits.indexOf(mcleanHit)}` : 'NOT FOUND in top 10'}`);
    for (const h of hits.slice(0, 3)) {
      const s = h.source;
      console.log(`  id=${s.id}  name="${s.firstName} ${s.lastName}"  singlesUtr=${s.singlesUtr}  display=${s.singlesUtrDisplay}  loc="${s.location?.display || s.location?.city || '?'}"`);
    }

    const hit1 = hits[0]?.source;
    if (!hit1?.id) continue;

    // --- v2 player endpoint for top hit ---
    const prof2 = await get(`${UTR_BASE}/api/v2/player/${hit1.id}`, { 'Authorization': `Bearer ${jwt}` });
    const p2 = prof2.body;
    console.log(`[v2 #0]    status=${prof2.status}  name="${p2?.firstName} ${p2?.lastName}"  singlesUtr=${p2?.singlesUtr}  display=${p2?.singlesUtrDisplay}  loc="${p2?.location?.display || p2?.location?.city || '?'}"`);
    if (prof2.status !== 200) console.log('           v2 body:', JSON.stringify(p2).slice(0, 300));
  }

  if (!jwt) {
    console.log('\n[!] No UTR_JWT set. Re-run with:');
    console.log('    UTR_JWT=<value_of_jwt_cookie> node debug-utr.js');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
