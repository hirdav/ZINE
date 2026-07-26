// Local library discovery — no manifest file, no build step. Static file
// servers (python -m http.server, nginx autoindex, Apache, etc.) that lack an
// index.html in a directory return an auto-generated HTML listing of its
// contents; we just fetch that and read the <a href> links out of it. Drop a
// .pdf/.txt/.md into library/ and refresh — it shows up.
//
// Hosts that don't support directory listing (GitHub Pages, most CDNs) will
// simply return a 404/redirect here, which we treat as "no library" and hide
// the section — this is local-only progressive enhancement, not a hard
// dependency.

const ACCEPTED_EXT = ['.pdf', '.txt', '.md'];

function titleFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const spaced = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return filename;
  return spaced.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Returns null if the folder can't be listed at all (missing / no listing
// support), or an array (possibly empty) of { name, title, ext, url }.
export async function scanLibrary(baseUrl = 'library/') {
  let res;
  try {
    res = await fetch(baseUrl, { cache: 'no-store' });
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return null;

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = Array.from(doc.querySelectorAll('a[href]'));

  const baseAbs = new URL(baseUrl, window.location.href);
  const seen = new Set();
  const items = [];

  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('?') || href.startsWith('#')) continue;
    const decoded = decodeURIComponent(href.split('?')[0].split('#')[0]);
    if (decoded.endsWith('/') || decoded === '..' || decoded === '.') continue; // skip parent/self links

    const lower = decoded.toLowerCase();
    if (lower === 'readme.md') continue; // the folder's own docs, not a book
    const ext = ACCEPTED_EXT.find((e) => lower.endsWith(e));
    if (!ext) continue;

    let absUrl;
    try { absUrl = new URL(href, baseAbs).href; } catch (e) { continue; }
    if (seen.has(absUrl)) continue;
    seen.add(absUrl);

    const filename = decoded.split('/').pop();
    items.push({
      name: filename,
      title: titleFromFilename(filename),
      ext: ext.slice(1),
      url: absUrl,
    });
  }

  items.sort((a, b) => a.title.localeCompare(b.title));
  return items;
}
