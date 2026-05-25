// Proxy for UTR API calls - bypasses CORS restriction
const UTR_BASE = 'https://app.universaltennis.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Utr-Cookie');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Only allow requests to UTR API
  const allowedPaths = ['/api/v1/player/', '/api/v2/player/', '/api/v2/search/players'];
  const isAllowed = allowedPaths.some(p => path.startsWith(p));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Path not allowed' });
  }

  // Build query string from remaining params
  const { path: _, ...rest } = req.query;
  const qs = new URLSearchParams(rest).toString();
  const url = `${UTR_BASE}${path}${qs ? '?' + qs : ''}`;

  try {
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://app.universaltennis.com',
      'Referer': 'https://app.universaltennis.com/',
    };
    // Forward UTR session cookie + extract JWT as Authorization Bearer
    const utrCookie = req.headers['x-utr-cookie'];
    if (utrCookie) {
      reqHeaders['Cookie'] = utrCookie;
      const jwtMatch = utrCookie.match(/\bjwt=([^;]+)/);
      if (jwtMatch) reqHeaders['Authorization'] = `Bearer ${jwtMatch[1]}`;
    }

    const upstream = await fetch(url, { headers: reqHeaders });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);
    res.status(upstream.status);

    const body = await upstream.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
