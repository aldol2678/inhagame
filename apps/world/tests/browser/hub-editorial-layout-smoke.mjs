// Offline CSS regression: real hub HTML, styles, art, hub.js and editorial.js.
// Account/backend scripts are deliberately stubbed; this does not test authentication.
// Run: node apps/world/tests/browser/hub-editorial-layout-smoke.mjs
// Optional: CHROMIUM_PATH, PLAYWRIGHT_MODULE, EVIDENCE_DIR, CAPTURE_BASELINE=1.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(process.env.EVIDENCE_DIR || 'hub-editorial-layout-evidence');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root)) throw new Error('invalid path');
    const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.svg':'image/svg+xml', '.json':'application/json' };
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
let browser;
const results = [];
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless:true, args:['--no-sandbox'] });
  for (const width of [320,390,700,768,1440]) {
    const page = await browser.newPage({ viewport:{width,height:1000}, deviceScaleFactor:1 });
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (request.resourceType() === 'script' && !['/hub.js','/hub-editorial.js'].includes(url.pathname)) return route.fulfill({ contentType:'text/javascript',body:'' });
      return route.continue();
    });
    await page.goto(origin, {waitUntil:'networkidle'});
    await page.screenshot({path:resolve(output,`home-${width}.png`),fullPage:true});
    const metrics = await page.evaluate(() => {
      const el = s => document.querySelector(s);
      const box = s => {const b=el(s).getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
      const style = s => getComputedStyle(el(s));
      const overlap = (a,b) => a.x<b.right && a.right>b.x && a.y<b.bottom && a.bottom>b.y;
      const art=box('.portal-hero-art'),copy=box('.portal-hero-copy'),note=box('.portal-art-note');
      return { viewport:innerWidth, documentWidth:document.documentElement.scrollWidth, hero:box('.portal-hero'),art,copy,note,
        artCopyOverlap:overlap(art,copy), noteCopyOverlap:overlap(note,copy), bodyBackground:style('body').backgroundColor,
        headerBackground:style('.header').backgroundColor,mainWidth:box('.main').width,
        overlay:getComputedStyle(el('.portal-hero'),'::before').content,
        display:style('.portal-hero').display,
        infoCards:[...document.querySelectorAll('.editorial-info-grid > *')].map(a=>({
          display:getComputedStyle(a).display, direction:getComputedStyle(a).flexDirection,
          decoration:getComputedStyle(a).textDecorationLine,
          children:[...a.children].map(c=>{const b=c.getBoundingClientRect();return {top:b.top,bottom:b.bottom};})})),
        gameCards:[...document.querySelectorAll('.portal-game')].map(a=>{
          const b=a.getBoundingClientRect(),cta=a.querySelector('.portal-game-link').getBoundingClientRect();
          const mascot=a.querySelector('.portal-official-mascot');
          return {width:b.width, height:b.height, x:b.x, ctaHeight:cta.height,
            bodyFont:parseFloat(getComputedStyle(a.querySelector('.portal-card-body p')).fontSize),
            mascotSrc:mascot?.getAttribute('src'), mascotLoaded:!!mascot?.naturalWidth};}),
        controls:[...document.querySelectorAll('.portal-cta-row a')].map(a=>{const b=a.getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {text:a.textContent.trim(),hit:hit===a || a.contains(hit)};}) };
    });
    // Capture the previously missed lower-page sections after scrolling and loading lazy art.
    for(const [name,selector] of [['arcade','#game-cards'],['discover','.editorial-discover-more'],['news','.portal-info']]) {
      const section=page.locator(selector); await section.scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>[...document.querySelectorAll('.portal-poster img')].filter(i=>{
        const r=i.getBoundingClientRect();return r.top<innerHeight && r.bottom>0;
      }).every(i=>i.complete && i.naturalWidth>0));
      await section.screenshot({path:resolve(output,`${name}-${width}.png`)});
    }
    metrics.gameCards=await page.locator('.portal-game').evaluateAll(cards=>cards.map(a=>{
      const b=a.getBoundingClientRect(),cta=a.querySelector('.portal-game-link').getBoundingClientRect(),mascot=a.querySelector('.portal-official-mascot');
      return {width:b.width,height:b.height,x:b.x,ctaHeight:cta.height,bodyFont:parseFloat(getComputedStyle(a.querySelector('.portal-card-body p')).fontSize),mascotSrc:mascot?.getAttribute('src'),mascotLoaded:!!mascot?.naturalWidth};
    }));
    // Scroll each CTA into view and check real pointer targeting without following external links.
    metrics.ctaClickable=[];
    for (const selector of ['.portal-hero-cta','.portal-secondary-link']) {
      const locator=page.locator(selector); await locator.scrollIntoViewIfNeeded();
      try { await locator.click({trial:true,timeout:1500}); metrics.ctaClickable.push(true); }
      catch {metrics.ctaClickable.push(false);}
    }
    metrics.gameCtaClickable=[];
    for(const locator of await page.locator('.portal-game-link').all()) {
      await locator.scrollIntoViewIfNeeded();
      try { await locator.click({trial:true,timeout:1500});metrics.gameCtaClickable.push(true); }
      catch { metrics.gameCtaClickable.push(false); }
    }
    metrics.panels={};
    for (const panel of ['ranking','friends','messages','account','settings']) {
      await page.goto(origin+'/#'+panel,{waitUntil:'networkidle'});
      metrics.panels[panel]=await page.evaluate(p=>({visible:!document.querySelector(`[data-view="${p}"]`).hidden,body:getComputedStyle(document.body).backgroundColor,header:getComputedStyle(document.querySelector('.header')).backgroundColor,main:getComputedStyle(document.querySelector('.main')).padding,overflow:document.documentElement.scrollWidth>innerWidth}),panel);
    }
    metrics.publicPages={};
    for(const name of ['privacy','support','updates']){
      await page.goto(origin+'/'+name+'.html',{waitUntil:'networkidle'});
      metrics.publicPages[name]=await page.evaluate(()=>({title:document.title,overflow:document.documentElement.scrollWidth>innerWidth,heading:document.querySelector('h1')?.textContent.trim()}));
      await page.screenshot({path:resolve(output,`${name}-${width}.png`),fullPage:true});
    }
    results.push(metrics); await page.close();
  }
  await writeFile(resolve(output,'metrics.json'),JSON.stringify(results,null,2));
  if (!process.env.CAPTURE_BASELINE) for (const r of results) {
    assert.equal(r.documentWidth,r.viewport,'no horizontal overflow');
    assert.equal(r.infoCards.length,4);
    for(const card of r.infoCards){
      assert.equal(card.display,'flex','shortcut anchors and button keep flex layout');
      assert.equal(card.direction,'column');
      assert.equal(card.decoration,'none','cards are not styled as inline text links');
      for(let i=1;i<card.children.length;i++) assert.ok(card.children[i].top>=card.children[i-1].bottom,'shortcut text rows remain separate');
    }
    assert.equal(r.gameCards.length,4);
    assert.equal(r.gameCtaClickable.length,4);
    assert.ok(r.gameCtaClickable.every(Boolean),'all four game links accept pointer clicks');
    for(const card of r.gameCards){
      assert.ok(card.ctaHeight>=44,'play CTA has a comfortable touch target');
      assert.equal(card.mascotSrc,'/campus/icons/icon-512.png');
      assert.equal(card.mascotLoaded,true,'official public mascot loads');
      if(r.viewport<=700){assert.ok(card.width>=r.viewport-32,'mobile game card fills available width');assert.ok(card.bodyFont>=14);}
    }
    if(r.viewport<=700) assert.ok(r.gameCards.every(c=>c.x===r.gameCards[0].x),'mobile games use one column');
    else assert.ok(r.gameCards[1].x>r.gameCards[0].x,'larger screens retain multiple columns');
    assert.equal(r.bodyBackground,'rgb(245, 242, 236)','paper theme wins base home rules');
    assert.equal(r.headerBackground,'rgba(245, 242, 236, 0.98)','paper header wins base home rules');
    assert.equal(r.overlay,'none','legacy gradient removed');
    assert.equal(r.artCopyOverlap,false,'art does not overlap copy');
    assert.equal(r.noteCopyOverlap,false,'note does not cover copy');
    assert.ok(r.ctaClickable.every(Boolean),'both hero links accept pointer clicks');
    if(r.viewport>700) {assert.equal(r.display,'grid');assert.ok(r.art.x>=r.copy.right-1);assert.equal(r.mainWidth,Math.min(r.viewport,1200));}
    else {assert.ok(r.art.bottom<=r.note.y+1);assert.ok(r.note.bottom<=r.copy.y+1);}
    for(const p of Object.values(r.panels)){assert.equal(p.visible,true);assert.equal(p.overflow,false);}
    for(const p of Object.values(r.publicPages)){assert.ok(p.heading);assert.equal(p.overflow,false,'public page has no horizontal overflow');}
  }
  console.log(JSON.stringify({mode:process.env.CAPTURE_BASELINE?'baseline':'assertions passed',output,viewports:results.map(r=>r.viewport)}));
} finally {
  try { await browser?.close(); }
  finally { if (server.listening) await new Promise(r=>server.close(r)); }
}
