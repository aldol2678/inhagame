import test from 'node:test';
import assert from 'node:assert/strict';
import { isSeoOnly } from './seo-only-scope.mjs';

const hub = 'apps/world/index.html';
const campus = 'apps/world/campus/index.html';
const profile = 'apps/world/profile/index.html';
const oldHub = '<!doctype html>\n<html><head>\n  <title>Old hub</title>\n  <script src="/hub.js"></script>\n</head><body><main>PLAY</main></body></html>\n';
const newHub = oldHub.replace('<title>Old hub</title>', [
  '<title>INHAGAME Hub</title>',
  '  <meta name="description" content="Official independent game hub">',
  '  <link rel="canonical" href="https://inhagame.app/">',
  '  <meta property="og:url" content="https://inhagame.app/">',
  '  <meta name="twitter:card" content="summary">'
].join('\n'));
const oldCampus = oldHub.replace('Old hub', 'Old campus');
const newCampus = newHub.replace('INHAGAME Hub', 'INHA WORLD')
  .replaceAll('https://inhagame.app/', 'https://inhagame.app/campus/');
const oldProfile = oldHub.replace('Old hub', 'Profile');
const newProfile = oldProfile.replace('<title>Profile</title>', '<title>Profile</title>\n  <meta name="robots" content="noindex, follow">');
const robots = [
  '# INHAGAME public web hub: indexing guidance, not an access-control mechanism.',
  'User-agent: *', 'Allow: /', 'Disallow: /api/', '',
  'Sitemap: https://inhagame.app/sitemap.xml', ''
].join('\n');
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '  <url><loc>https://inhagame.app/</loc></url>',
  '  <url><loc>https://inhagame.app/campus/</loc></url>',
  '</urlset>', ''
].join('\n');
function decide(changes) {
  const paths = Object.keys(changes);
  return isSeoOnly(paths, p => changes[p][0], p => changes[p][1]);
}
test('SEO-only hub/campus metadata is structurally accepted', () => {
  assert.equal(decide({[hub]:[oldHub,newHub], [campus]:[oldCampus,newCampus]}), true);
});
test('SEO-only privacy metadata, robots, sitemap and tests are accepted', () => {
  assert.equal(decide({
    [hub]:[oldHub,newHub], [profile]:[oldProfile,newProfile],
    'apps/world/robots.txt':[null,robots],
    'apps/world/sitemap.xml':[null,sitemap],
    'apps/world/tests/seo-metadata.test.mjs':[null,'test code'],
    'apps/world/docs/seo-p0-20261012.md':[null,'audit evidence']
  }), true);
});
test('body, runtime and executable head mutations never bypass full QA', () => {
  assert.equal(decide({[hub]:[oldHub,newHub.replace('PLAY','HACK')]}),false);
  assert.equal(decide({[hub]:[oldHub,newHub.replace('/hub.js','/other.js')]}),false);
  assert.equal(decide({[hub]:[oldHub,newHub.replace('</head>', '<script>alert(1)</script></head>')]}),false);
  assert.equal(decide({[hub]:[oldHub,newHub], 'apps/world/src/main.js':['before','after']}),false);
});
test('invalid metadata and crawler controls never bypass full QA', () => {
  assert.equal(decide({[hub]:[oldHub,newHub.replace('https://inhagame.app/','https://evil.example/')]}),false);
  assert.equal(decide({[hub]:[oldHub,newHub.replace('</head>', '<meta name="robots" content="noindex"></head>')]}),false);
  assert.equal(decide({[hub]:[oldHub,newHub], 'apps/world/robots.txt':[null,robots.replace('Disallow: /api/','Disallow: /')]}),false);
  assert.equal(decide({[hub]:[oldHub,newHub], 'apps/world/sitemap.xml':[null,sitemap.replace('inhagame.app','evil.example')]}),false);
});
test('unknown, deleted, renamed, missing history and CI files default to full', () => {
  assert.equal(decide({[hub]:[oldHub,null]}),false);
  assert.equal(decide({[hub]:[null,newHub]}),false);
  assert.equal(decide({[hub]:[oldHub,newHub],'.github/workflows/public-ci.yml':['x','y']}),false);
  assert.equal(isSeoOnly([hub],()=>{throw new Error('missing')},()=>newHub),false);
  assert.equal(isSeoOnly([],()=>oldHub,()=>newHub),false);
  assert.equal(isSeoOnly([hub,hub],()=>oldHub,()=>newHub),false);
});
