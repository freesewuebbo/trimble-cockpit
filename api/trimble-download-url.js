export default async function handler(req, res) {
  const allowedOrigin = 'https://freesewuebbo.github.io';
  const origin = req.headers.origin || '';
  if (origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (origin && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_trimble_token' });
  }

  const { fileId, versionId } = req.body || {};
  if (!fileId || !versionId) {
    return res.status(400).json({ error: 'fileId_and_versionId_required' });
  }

  const headers = { Authorization: auth, Accept: 'application/json' };
  const bases = new Set([
    'https://app.connect.trimble.com/tc/api/2.0',
    'https://app21.connect.trimble.com/tc/api/2.0',
    'https://app31.connect.trimble.com/tc/api/2.0'
  ]);

  try {
    const regions = await fetch('https://app.connect.trimble.com/tc/api/2.0/regions', { headers });
    if (regions.ok) {
      const data = await regions.json();
      collectCoreOrigins(data, bases);
    }
  } catch (_) {}

  let lastError = 'not_found_in_regions';
  for (const base of bases) {
    try {
      const url = base + '/files/fs/' + encodeURIComponent(fileId) +
        '/downloadurl?versionId=' + encodeURIComponent(versionId);
      const r = await fetch(url, { headers, redirect: 'manual' });

      if (r.status === 301 || r.status === 302 || r.status === 307 || r.status === 308) {
        const location = r.headers.get('location');
        if (location) {
          return res.status(200).json({ downloadUrl: location, regionBase: base });
        }
      }

      if (!r.ok) {
        lastError = base + ':' + r.status;
        continue;
      }

      const contentType = (r.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const data = await r.json();
        const downloadUrl = findUrl(data);
        if (downloadUrl) {
          return res.status(200).json({ downloadUrl, regionBase: base });
        }
      } else {
        const text = await r.text();
        const downloadUrl = findUrl(text);
        if (downloadUrl) {
          return res.status(200).json({ downloadUrl, regionBase: base });
        }
      }
      lastError = base + ':no_download_url';
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
  }

  return res.status(404).json({ error: 'download_url_not_found', detail: lastError });
}

function collectCoreOrigins(value, out) {
  if (!value) return;
  if (typeof value === 'string') {
    if (/^https:\/\/[^/]*connect\.trimble\.com/i.test(value)) {
      try {
        const u = new URL(value);
        out.add(u.origin + '/tc/api/2.0');
      } catch (_) {}
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectCoreOrigins(v, out);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectCoreOrigins(v, out);
  }
}

function findUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const s = value.trim().replace(/^"|"$/g, '');
    return /^https?:\/\//i.test(s) ? s : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const url = findUrl(v);
      if (url) return url;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['downloadUrl', 'downloadURL', 'download_url', 'url', 'href']) {
      if (value[key]) {
        const url = findUrl(value[key]);
        if (url) return url;
      }
    }
    for (const v of Object.values(value)) {
      const url = findUrl(v);
      if (url) return url;
    }
  }
  return null;
}
