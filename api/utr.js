// Proxy for UTR API calls — bypasses CORS restriction
// UTR migrated from universaltennis.com to utrsports.net; old domain returns 301 which
// causes POST (login) to silently become GET and lose its body — use new domain directly.
const UTR_BASE = 'https://app.utrsports.net';

async function readBody(req) {
  if (req.body !== undefined) return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Utr-Cookie');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path parameter' });

  const allowedPaths = [
    '/api/v1/auth/login',
    '/api/v1/me',
    '/api/v1/player/',
    '/api/v2/player/',
    '/api/v2/search/players',
  ];
  if (!allowedPaths.some(p => path.startsWith(p))) {
    return res.status(403).json({ error: 'Path not allowed' });
  }

  const { path: _, ...rest } = req.query;
  const qs = new URLSearchParams(rest).toString();
  const url = `${UTR_BASE}${path}${qs ? '?' + qs : ''}`;

  try {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://app.utrsports.net',
      Referer: 'https://app.utrsports.net/',
    };

    const utrCookie = req.headers['x-utr-cookie'];
    if (utrCookie) {
      headers['Cookie'] = utrCookie;
      const m = utrCookie.match(/\bjwt=([^;]+)/);
      if (m) headers['Authorization'] = `Bearer ${m[1]}`;
    }

    const fetchOpts = { method: req.method || 'GET', headers };

    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      const body = await readBody(req);
      fetchOpts.body = JSON.stringify(body);
    }

    const upstream = await fetch(url, fetchOpts);

    // For login: extract JWT from Set-Cookie or response body, return as JSON
    if (path === '/api/v1/auth/login') {
      const json = await upstream.json();
      const setCookie = upstream.headers.get('set-cookie') || '';
      const jwtMatch = setCookie.match(/(?:^|,\s*)jwt=([^;,\s]+)/i);
      const jwt = jwtMatch?.[1] || json.jwt || json.token || json.accessToken || '';
      return res.status(upstream.status).json({ ...json, _jwt: jwt });
    }

    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);
    res.status(upstream.status);
    const body = await upstream.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
