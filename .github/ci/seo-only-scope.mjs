// SEO-P0: require full content equality outside explicitly whitelisted HTML head metadata.
// No arbitrary file/path-based bypass. Policy/CI/source changes always fail closed.
const PUBLIC = new Map([
  ['apps/world/index.html', 'https://inhagame.app/'],
  ['apps/world/campus/index.html', 'https://inhagame.app/campus/'],
]);
const PRIVATE = new Set([
  'apps/world/profile/index.html',
  'apps/world/achievements/index.html',
  'apps/world/editor/index.html',
  'apps/world/studio/index.html',
]);
const INCIDENTAL = new Set([
  'apps/world/docs/seo-p0-20261012.md',
  'apps/world/tests/seo-metadata.test.mjs',
]);
const ROBOTS = [
  '# INHAGAME public web hub: indexing guidance, not an access-control mechanism.',
  'User-agent: *', 'Allow: /', 'Disallow: /api/', '',
  'Sitemap: https://inhagame.app/sitemap.xml', ''
].join('\n');
const SITEMAP = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '  <url><loc>https://inhagame.app/</loc></url>',
  '  <url><loc>https://inhagame.app/campus/</loc></url>',
  '</urlset>', ''
].join('\n');
function approvedTag(line, isPublic) {
  const s = line.trim();
  if (/^<title>[^<>]+<\/title>$/.test(s)) return true;
  if (!isPublic) return /^<meta name="robots" content="noindex, follow"\s*\/?>$/.test(s);
  return /^<meta name="description" content="[^"<>]+"\s*\/?>$/.test(s)
    || /^<link rel="canonical" href="https:\/\/inhagame\.app\/(?:campus\/)?"\s*\/?>$/.test(s)
    || /^<meta property="og:(?:type|site_name|locale|title|description|url)" content="[^"<>]+"\s*\/?>$/.test(s)
    || /^<meta name="twitter:card" content="summary"\s*\/?>$/.test(s);
}
function withoutSearchTags(html, isPublic) {
  if (typeof html !== 'string') return null;
  const match = html.match(/^([\s\S]*?<head>)([\s\S]*?)(<\/head>[\s\S]*)$/i);
  if (!match || html.indexOf('</head>', html.indexOf('</head>') + 1) !== -1) return null;
  return match[1] + match[2].split(/\r?\n/).filter(line => !approvedTag(line, isPublic)).join('\n') + match[3];
}
function validNewPage(html, canonical) {
  const head = html?.split('</head>')[0] ?? '';
  if (!/^<title>[^<>]+<\/title>$/m.test(head.trim()) && !/<title>[^<>]+<\/title>/.test(head)) return false;
  if (canonical) {
    return head.includes('<link rel="canonical" href="' + canonical + '">')
      && /<meta name="description" content="[^"<>]+">/.test(head)
      && head.includes('<meta property="og:url" content="' + canonical + '">')
      && !/<meta name="robots" content="noindex/.test(head);
  }
  return /<meta name="robots" content="noindex, follow">/.test(head);
}
export function isSeoOnly(files, readBefore, readAfter) {
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length ||
      typeof readBefore !== 'function' || typeof readAfter !== 'function') return false;
  if (!files.some(file => PUBLIC.has(file) || PRIVATE.has(file) ||
        file === 'apps/world/robots.txt' || file === 'apps/world/sitemap.xml')) return false;
  for (const file of files) {
    if (typeof file !== 'string' || file.includes('\0') || file.includes('..')) return false;
    if (!PUBLIC.has(file) && !PRIVATE.has(file) && !INCIDENTAL.has(file) &&
        file !== 'apps/world/robots.txt' && file !== 'apps/world/sitemap.xml') return false;
    let before, after;
    try {
      before = readBefore(file);
      after = readAfter(file);
    } catch {
      return false; // Including missing history, blob or unexpected change.
    }
    if (typeof after !== 'string') return false; // Deletions never qualify.
    if (INCIDENTAL.has(file)) continue; // Docs/tests only, never deployed runtime.
    if (file === 'apps/world/robots.txt') {
      if (after !== ROBOTS) return false;
      continue;
    }
    if (file === 'apps/world/sitemap.xml') {
      if (after !== SITEMAP) return false;
      continue;
    }
    if (typeof before !== 'string') return false; // Cannot add/replace HTML entrypoints.
    const isPublic = PUBLIC.has(file);
    if (!validNewPage(after, isPublic ? PUBLIC.get(file) : null)) return false;
    if (withoutSearchTags(before, isPublic) === null ||
        withoutSearchTags(before, isPublic) !== withoutSearchTags(after, isPublic)) return false;
  }
  return true;
}
