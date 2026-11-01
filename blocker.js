// Browser Kit: site blocker settings, shared by background.js, popup.js and
// blocked.js.
//
// Listed sites are redirected to blocked.html. Typing the unlock phrase there
// opens that one site for BLOCK_UNLOCK_MS, then background.js locks it again
// and sends any tabs still on it back to the blocked page. A locked site can't
// be removed from the list; unlock it first.

const BLOCK_DEFAULTS = { 'block-sites': [] };
const BLOCK_PHRASE = 'i am a looser and continue to be';
const BLOCK_UNLOCK_MS = 10 * 60 * 1000;

// "https://www.instagram.com/reels" -> "instagram.com". Returns '' for junk.
function blockNormalize(entry) {
  entry = String(entry).trim().toLowerCase();
  if (!entry) return '';
  try {
    const u = new URL(entry.includes('://') ? entry : 'http://' + entry);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname.replace(/^www\./, '').replace(/\.$/, '');
    return host.includes('.') || host === 'localhost' ? host : '';
  } catch {
    return '';
  }
}

// The list entry that covers `url` (the site itself or any subdomain), or null.
function blockEntryFor(sites, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname;
  return sites.find((s) => host === s || host.endsWith('.' + s)) || null;
}

// Typed text matches the phrase, ignoring case and extra spaces.
function blockPhraseOk(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ') === BLOCK_PHRASE;
}
