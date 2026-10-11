// Private-asset acceptance only. Captures pixels in memory and emits RGB/contrast
// metadata, never image/model bytes. Fixtures must be hash-verified by the caller.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke } from './harness.mjs';
import { assertAnnyongiColorSamples } from './annyongi-color-policy.mjs';
const output = process.env.ANNYONGI_OUTPUT || 'test-results/annyongi';
const results = [];
let activeCase = null, failure = null;
try {
for (const [device, viewport] of [['desktop', {width:720,height:800}], ['mobile', {width:390,height:844}]]) {
  const smoke = await startSmoke({viewport});
  try {
    const page = await smoke.context.newPage(); smoke.watch(page);
    for (const optimized of [false, true]) for (const night of [false, true]) {
      activeCase = {device, variant:optimized?'optimized':'source', night};
      const query = new URLSearchParams();
      if (optimized) query.set('optimized', '1');
      if (night) query.set('night', '1');
      await page.goto(`${smoke.origin}/tests/browser/annyongi-review-harness.html?${query}`);
      await page.waitForFunction(() => window.__ANNYONGI_REVIEW__);
      await page.evaluate(() => { const d=window.__ANNYONGI_REVIEW__; d.state('ground'); d.view('front'); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const regions = await page.evaluate(async () => {
        const pc = await import('playcanvas');
        const d = window.__ANNYONGI_REVIEW__;
        const mesh = name => { const node=d.carrier.findByName(name); if (!node?.render?.meshInstances?.length) throw Error(`Missing color target ${name}`); return node.render.meshInstances[0]; };
        const head=mesh('Head'), eyes=['Dot eye -1','Dot eye 1'].map(mesh);
        // Use front upper-cheek/forehead patches away from the central curl and
        // mouth. Eye samples are the projected center of each semantic eye mesh.
        const point = v => { const p=d.camera.camera.worldToScreen(v); return {x:p.x,y:p.y}; };
        const skin=[-1,1].map(side => point(new pc.Vec3(head.aabb.center.x + side*.35*head.aabb.halfExtents.x,
          head.aabb.center.y + .32*head.aabb.halfExtents.y, head.aabb.center.z + head.aabb.halfExtents.z)));
        const eyePoints=eyes.map(mi => point(mi.aabb.center));
        return {body:skin,eyes:eyePoints,albedo:{body:[head.material.diffuse.r,head.material.diffuse.g,head.material.diffuse.b],eyes:eyes.map(mi=>[mi.material.diffuse.r,mi.material.diffuse.g,mi.material.diffuse.b])}};
      });
      const png = await page.screenshot();
      const samples = await page.evaluate(async ({encoded,regions}) => {
        const bytes=Uint8Array.from(atob(encoded), c=>c.charCodeAt(0));
        const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
        const sample=({x,y})=>{
          x=Math.round(x);y=Math.round(y);
          if(x<1||y<1||x>=canvas.width-1||y>=canvas.height-1)throw Error('Color ROI outside screenshot');
          const rgba=context.getImageData(x-1,y-1,3,3).data;
          return [0,1,2].map(c=>Array.from({length:9},(_,i)=>rgba[i*4+c]).sort((a,b)=>a-b)[4]);
        };
        const result={body:regions.body.map(sample),eyes:regions.eyes.map(sample)};
        bitmap.close();canvas.width=canvas.height=0;return result;
      }, {encoded:png.toString('base64'),regions});
      const record = {...activeCase, regions, samples, passed:false};
      results.push(record);
      // Independent authored material-factor checks precede the pixel checks.
      const [r,g,b]=regions.albedo.body;
      assert.ok(b-r>.05 && g-r>.04, 'runtime preserves authored blue body material');
      for(const eye of regions.albedo.eyes)assert.ok(Math.max(...eye)<.25,'runtime preserves authored dark eye material');
      assertAnnyongiColorSamples(samples, assert);
      record.passed = true;
    }
    assert.deepEqual(smoke.problems, []);
  } finally { await smoke.close(); }
}
} catch (error) {
  failure = {case:activeCase, message:String(error.message).split('\n')[0]};
  throw error;
} finally {
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/color-results.json`,JSON.stringify({headSha:process.env.CHARACTER_SMOKE_HEAD_SHA||null,results,passed:!failure,failure},null,2));
}
console.log('Annyongi authored palette and eye contrast: PASS (8 device/variant/light cases)');
