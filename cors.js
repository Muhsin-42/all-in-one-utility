// YT Quick Hide: CORS settings, shared by background.js and popup.js.
//
// Unlike "allow all CORS" extensions this only touches tabs whose page is on a
// site you added, echoes that page's exact origin instead of "*" (so cookies
// and Authorization headers keep working), and leaves every other header
// (CSP, X-Frame-Options, ...) alone.

const CORS_DEFAULTS = {
  'cors-sites': [],
  'cors-credentials': true,
  'cors-private-network': true,
  'cors-headers': '',
};

const CORS_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
const CORS_ALLOW_HEADERS = [
  'Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Language',
  'Content-Type', 'If-Match', 'If-Modified-Since', 'If-None-Match', 'Pragma', 'Range',
  'X-Api-Key', 'X-CSRF-Token', 'X-Requested-With', 'X-XSRF-Token',
];
const CORS_EXPOSE_HEADERS = [
  'Content-Disposition', 'Content-Length', 'Content-Range', 'ETag', 'Link', 'Location',
  'Retry-After', 'X-Request-Id', 'X-Total-Count',
];

// "https://app.example.com/x" -> "https://app.example.com"; "localhost:3000"
// and "example.com" stay as typed (they match any scheme, and any port for a
// bare host). Returns '' for junk.
function corsNormalize(entry) {
  entry = String(entry).trim().toLowerCase().replace(/\/+$/, '');
  if (!entry) return '';
  try {
    if (entry.includes('://')) {
      const u = new URL(entry);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
    }
    const u = new URL('http://' + entry);
    return u.pathname === '/' && !u.search && !u.hash && !u.username ? u.host : '';
  } catch {
    return '';
  }
}

// The page origin to allow for a tab at `url`, or null if the site isn't listed.
function corsOriginFor(sites, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return sites.some((s) => s === u.origin || s === u.host || s === u.hostname) ? u.origin : null;
}
