import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const origin = 'https://inhagame.app';
const publicPages = [['index.html','/'],['campus/index.html','/campus/'],['support.html','/support.html'],['privacy.html','/privacy.html'],['terms.html','/terms.html'],['updates.html','/updates.html']];
const privatePages = ['profile/index.html','achievements/index.html','editor/index.html','studio/index.html'];
const head = html => html.slice(0, html.indexOf('</head>'));
const meta = (html, key) => [...head(html).matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)].filter(m=>m[1]===key).map(m=>m[2]);
const title = html => head(html).match(/<title>([^<]+)<\/title>/)?.[1];

test('all six published public pages have distinct titles and consistent canonical/social metadata', () => {
  const titles = new Set();
  for (const [file,path] of publicPages) {
    const html = read(file), h = head(html), url = origin + path;
    assert.equal((h.match(/<title>/g)||[]).length,1,file);
    assert.ok(title(html)?.includes('INHA WORLD'),file);
    assert.ok(!titles.has(title(html)),file); titles.add(title(html));
    assert.deepEqual([...h.matchAll(/<link rel="canonical" href="([^"]+)"\s*\/?>/g)].map(m=>m[1]),[url],file);
    assert.equal(meta(html,'description').length,1,file);
    assert.ok(meta(html,'description')[0].length > 20,file);
    assert.deepEqual(meta(html,'og:title'),[title(html)],file);
    assert.deepEqual(meta(html,'og:description'),meta(html,'description'),file);
    assert.deepEqual(meta(html,'og:url'),[url],file);
    assert.deepEqual(meta(html,'og:site_name'),['INHA WORLD'],file);
    assert.deepEqual(meta(html,'og:locale'),['ko_KR'],file);
    assert.deepEqual(meta(html,'og:type'),['website'],file);
    assert.doesNotMatch(h,/name="robots"[^>]*noindex/i,file);
    assert.doesNotMatch(url,/[?#]/);
  }
});

test('existing public icon is accurately labelled, reachable in the source tree and not a screenshot claim', () => {
  for(const [file] of publicPages){
    const html=read(file);
    assert.deepEqual(meta(html,'og:image'),[origin+'/campus/icons/icon-512.png']);
    assert.deepEqual(meta(html,'og:image:alt'),['인하월드 앱 아이콘']);
    assert.deepEqual(meta(html,'twitter:card'),['summary']);
    assert.ok(head(html).includes('/campus/icons/favicon-32.png'));
  }
  for(const path of ['campus/icons/icon-512.png','campus/icons/favicon-32.png']){
    const png=readFileSync(new URL('../'+path,import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    if(path.includes('icon-512')){assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);}
  }
});

test('homepage WebSite JSON-LD uses the public brand without invented university affiliation',()=>{
  const scripts=[...read('index.html').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  assert.deepEqual(JSON.parse(scripts[0][1]),{'@context':'https://schema.org','@type':'WebSite',name:'INHA WORLD',alternateName:'인하월드',url:origin+'/'});
  assert.match(meta(read('index.html'),'description')[0],/비공식 학생 창작/);
  assert.match(read('index.html'),/공식적으로 제작·운영·후원하는 서비스가 아닌 학생 창작 프로젝트/);
});

test('private and editor documents including the WorldForge alias are noindex but crawlable',()=>{
  for(const file of privatePages) assert.deepEqual(meta(read(file),'robots'),['noindex, follow'],file);
  const config=JSON.parse(read('vercel.json'));
  assert.ok(config.routes.some(r=>r.src==='/worldforge/?'&&r.dest==='/studio/index.html'));
  const robots=read('robots.txt');
  assert.equal(robots,'# INHA WORLD: crawl guidance, not access control.\nUser-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://inhagame.app/sitemap.xml\n');
  assert.doesNotMatch(robots,/Disallow: \/(?:profile|achievements|editor|studio|worldforge)/);
});

test('sitemap includes only deployed same-origin public canonical documents, not private/hash/query URLs',()=>{
  const xml=read('sitemap.xml');
  assert.match(xml,/^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml,/<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  const urls=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  assert.deepEqual(urls,publicPages.map(([,path])=>origin+path));
  assert.equal(new Set(urls).size,urls.length);
  assert.doesNotMatch(xml,/<lastmod>|<priority>|<changefreq>/);
  for(const url of urls){const u=new URL(url);assert.equal(u.origin,origin);assert.equal(u.search+u.hash,'');}
});

test('actual hub render restores the homepage title after private panels and leaves canonical/indexability unchanged',()=>{
  const source=read('hub.js');
  const render=source.match(/  function render\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(render);
  const document={title:'',querySelectorAll(){return [];}};
  const location={hash:''};
  const context=vm.createContext({document,location,pages:new Set(['home','ranking','friends','messages','account','settings'])});
  vm.runInContext(render+';globalThis.render=render;',context);
  for(const hash of ['', '#home','#account','#friends','#messages','#home','#unknown','#portal-games']){
    location.hash=hash;context.render();
    if(['','#home','#unknown','#portal-games'].includes(hash))assert.equal(document.title,title(read('index.html')));
    else assert.ok(document.title.length>0);
  }
  assert.doesNotMatch(render,/canonical|robots|noindex/);
  assert.match(source,/hashchange[\s\S]*render/);
});
