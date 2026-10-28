import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const origin = 'https://inhagame.app';
const arcadeIds = JSON.parse(read('data/game-catalog.json')).games.filter(g=>g.id !== 'campus' && g.status === 'playable').map(g=>g.id);
const publicPages = [['index.html','/'],['campus/index.html','/campus/'],['support.html','/support.html'],['privacy.html','/privacy.html'],['terms.html','/terms.html'],['updates.html','/updates.html'],['arcade/index.html','/arcade/'],...arcadeIds.map(id=>['arcade/'+id+'/index.html','/arcade/'+id+'/'])];
const privatePages = ['profile/index.html','achievements/index.html','editor/index.html','studio/index.html'];
const head = html => html.slice(0, html.indexOf('</head>'));
const meta = (html, key) => [...head(html).matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)].filter(m=>m[1]===key).map(m=>m[2]);
const title = html => head(html).match(/<title>([^<]+)<\/title>/)?.[1];

test('all published public pages have distinct titles and consistent canonical/social metadata', () => {
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

test('gameplay share metadata matches the committed image and all export dimensions', () => {
  const alt = 'INHA WORLD 캠퍼스 실제 플레이 화면 — 비룡탑 옆을 비행하는 캐릭터';
  const image = origin + '/assets/social/20261028/inha-world-share.png';
  for (const [file] of publicPages) {
    const html = read(file);
    assert.deepEqual(meta(html,'og:image'),[image],file);
    assert.deepEqual(meta(html,'og:image:alt'),[alt],file);
    assert.deepEqual(meta(html,'og:image:width'),['1200'],file);
    assert.deepEqual(meta(html,'og:image:height'),['630'],file);
    assert.deepEqual(meta(html,'og:image:type'),['image/png'],file);
    assert.deepEqual(meta(html,'twitter:card'),['summary_large_image'],file);
    assert.deepEqual(meta(html,'twitter:image'),[image],file);
    assert.deepEqual(meta(html,'twitter:image:alt'),[alt],file);
    assert.ok(head(html).includes('/campus/icons/favicon-32.png'),file);
  }
  for (const [name,width,height,budget] of [['share',1200,630,500000],['square',1080,1080,1000000],['portrait',1080,1350,1000000]]) {
    const png=readFileSync(new URL('../assets/social/20261028/inha-world-'+name+'.png',import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a',name);
    assert.equal(png.readUInt32BE(16),width,name);
    assert.equal(png.readUInt32BE(20),height,name);
    assert.ok(png.length < budget,name);
  }
});

test('all public documents provide a large branded icon and image-preview permission', () => {
  for (const [file] of publicPages) {
    const html = read(file);
    assert.ok(head(html).includes('<link rel="icon" type="image/png" sizes="192x192" href="/campus/icons/icon-192.png">'), file);
    assert.deepEqual(meta(html, 'robots'), ['max-image-preview:large'], file);
  }
  const icon = readFileSync(new URL('../campus/icons/icon-192.png', import.meta.url));
  assert.equal(icon.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 192);
  assert.equal(icon.readUInt32BE(20), 192);
});

test('public navigation links to the independent campus page and identifies concept imagery', () => {
  const home = read('index.html');
  assert.ok(home.includes('<a class="editorial-nav-link" href="/campus/">캠퍼스</a>'));
  assert.ok(home.includes('<img src="/assets/hub/campus-concept.svg" alt="인하월드 캠퍼스 콘셉트 일러스트"'));
  for (const file of ['support.html', 'updates.html', 'privacy.html', 'terms.html']) {
    assert.ok(read(file).includes('<a href="/campus/">캠퍼스</a>'), file);
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
  assert.deepEqual(new Set(urls),new Set(publicPages.map(([,path])=>origin+path)));
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
