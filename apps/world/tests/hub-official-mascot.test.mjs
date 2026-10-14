import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('all arcade cards reuse the already published official mascot without altering its pixels', async () => {
  const html = await read('index.html');
  assert.equal((html.match(/class="portal-official-mascot" src="\/campus\/icons\/icon-512\.png"/g) || []).length, 4);
  const png = await readFile(new URL('../campus/icons/icon-512.png', import.meta.url));
  const blobSha = createHash('sha1').update(`blob ${png.length}\0`).update(png).digest('hex');
  assert.equal(blobSha, 'a6da8d3dbf523f4bc228ff0128fc23d97e4f5399');
  assert.doesNotMatch(await read('assets/hub/classic-concept.svg'), /ellipse cx="151"|circle cx="137"/);
  assert.doesNotMatch(await read('assets/hub/survival-concept.svg'), /translate\(148 103\)/);
  assert.doesNotMatch(await read('assets/hub/induck-grow-concept.svg'), /translate\(142 92\)/);
});


test('catalog-generated cards retain official art after DOM replacement', async () => {
  const source = await read('hub.js');
  const fn = source.match(/  function makeGameCard\(game\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(fn);
  const document = {createElement(tag){return {tag,dataset:{},children:[],setAttribute(k,v){this[k]=v;},append(...children){this.children.push(...children);}};}};
  const portalArt = {classic:['classic','CLASSIC'],induckup:['induckup','INDUCK UP'],survival:['survival','SURVIVAL'],'induck-grow':['induck-grow','LIFE SIM']};
  const context = vm.createContext({document,portalArt});
  vm.runInContext(fn + ';globalThis.makeCard=makeGameCard;',context);
  for(const id of Object.keys(portalArt)){
    const card=context.makeCard({id,title:'<safe text>',description:'description',status:'playable',playUrl:'https://example.com/'});
    const mascot=card.children[0].children.find(c=>c.className==='portal-official-mascot');
    assert.equal(mascot?.src,'/campus/icons/icon-512.png');
    assert.equal(mascot.width,mascot.height);
    assert.equal(card.children[1].children[0].textContent,'<safe text>');
  }
});
