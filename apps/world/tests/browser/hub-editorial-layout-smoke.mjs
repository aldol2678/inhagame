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
  for (const width of [320,390,1440]) {
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
        controls:[...document.querySelectorAll('.portal-cta-row a')].map(a=>{const b=a.getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {text:a.textContent.trim(),hit:hit===a || a.contains(hit)};}) };
    });
    // Scroll each CTA into view and check real pointer targeting without following external links.
    metrics.ctaClickable=[];
    for (const selector of ['.portal-hero-cta','.portal-secondary-link']) {
      const locator=page.locator(selector); await locator.scrollIntoViewIfNeeded();
      try { await locator.click({trial:true,timeout:1500}); metrics.ctaClickable.push(true); }
      catch {metrics.ctaClickable.push(false);}
    }
    metrics.panels={};
    for (const panel of ['ranking','friends','messages','account','settings']) {
      await page.goto(origin+'/#'+panel,{waitUntil:'networkidle'});
      metrics.panels[panel]=await page.evaluate(p=>({visible:!document.querySelector(`[data-view="${p}"]`).hidden,body:getComputedStyle(document.body).backgroundColor,header:getComputedStyle(document.querySelector('.header')).backgroundColor,main:getComputedStyle(document.querySelector('.main')).padding,overflow:document.documentElement.scrollWidth>innerWidth}),panel);
    }
    results.push(metrics); await page.close();
  }
  await writeFile(resolve(output,'metrics.json'),JSON.stringify(results,null,2));
  if (!process.env.CAPTURE_BASELINE) for (const r of results) {
    assert.equal(r.documentWidth,r.viewport,'no horizontal overflow');
    assert.equal(r.bodyBackground,'rgb(245, 242, 236)','paper theme wins base home rules');
    assert.equal(r.headerBackground,'rgba(245, 242, 236, 0.98)','paper header wins base home rules');
    assert.equal(r.overlay,'none','legacy gradient removed');
    assert.equal(r.artCopyOverlap,false,'art does not overlap copy');
    assert.equal(r.noteCopyOverlap,false,'note does not cover copy');
    assert.ok(r.ctaClickable.every(Boolean),'both hero links accept pointer clicks');
    if(r.viewport>700) {assert.equal(r.display,'grid');assert.ok(r.art.x>=r.copy.right-1);assert.equal(r.mainWidth,1200);}
    else {assert.ok(r.art.bottom<=r.note.y+1);assert.ok(r.note.bottom<=r.copy.y+1);}
    for(const p of Object.values(r.panels)){assert.equal(p.visible,true);assert.equal(p.overflow,false);}
  }
  console.log(JSON.stringify({mode:process.env.CAPTURE_BASELINE?'baseline':'assertions passed',output,viewports:results.map(r=>r.viewport)}));
} finally {
  try { await browser?.close(); }
  finally { if (server.listening) await new Promise(r=>server.close(r)); }
}
