// Real Main2 guide lifecycle with a NullGraphicsDevice. No browser pixels are claimed.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createFakeDocument } from '../support/fake-dom.mjs';
const engineUrl = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) { return next(specifier === 'playcanvas' ? engineUrl : specifier, context); } });
const doc = createFakeDocument();
const createElement = doc.createElement.bind(doc);
doc.createElement = tag => {
  const element = createElement(tag);
  element.appendChild = node => element.append(node);
  element.remove = () => {};
  Object.defineProperty(element, 'firstChild', { get: () => element.children[0] });
  return element;
};
doc.removeEventListener = () => {};
doc.body = doc.createElement('body');doc.defaultView=doc;
globalThis.document = doc;
const pc = await import('playcanvas');
const { createMain2GuideRuntime } = await import('../../npc-factory/main2-guide-runtime.mjs');
const { MAIN2_GUIDE_NPC } = await import('../../npc-factory/main2-guide-contract.mjs');
const canvas={id:'main3-guide-null',width:512,height:512};
const app=new pc.AppBase(canvas), options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem];app.init(options);
let resolveStart;const start=new Promise(resolve=>{resolveStart=resolve;});
let stage=0,opens=0,closes=0;
const main2={status:()=>({enabled:true,signedIn:true,available:true,complete:true,stage:9})};
const main3={status:()=>({enabled:true,signedIn:true,ready:true,available:true,stage}),startFromGuide:()=>start};
const player={getLocalPosition:()=>MAIN2_GUIDE_NPC.position};
const guide=createMain2GuideRuntime({root:app.root,player,quest:main2,firstStyleQuest:main3,documentLike:doc,
 onConversationOpen:()=>opens++,onConversationClose:()=>closes++});
try {
 assert.equal(guide.getContextAction().trigger(),true);
 const dialog=doc.body.children[0],line=dialog.children[1],choices=dialog.children[2];
 assert.equal(choices.children[0].textContent,'굿즈샵 가보기');
 choices.children[0].click();assert.equal(choices.children[0].disabled,true);
 guide.closeDialogue();stage=2;assert.equal(guide.getContextAction().trigger(),true);
 const current=line.textContent;assert.match(current,/방문을 기록/);
 resolveStart({stage:1});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(line.textContent,current,'old CTA response never rewrites the reopened dialogue');
 doc.dispatch('keydown',{key:'Escape',repeat:false});assert.equal(guide.isDialogueOpen(),false);
 assert.equal(opens,2);assert.equal(closes,2);
 console.log(JSON.stringify({status:'PASS',engine:pc.version,device:'NullGraphicsDevice; no pixels',cases:['canonical guide CTA','close and reopen while start pending','stale response ignored','Escape releases conversation']},null,2));
} finally {guide.destroy();app.destroy();}
