import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectStarterPurchaseButton, trackStarterPurchaseRpc } from './browser/starter-furniture-input-probe.mjs';

function fixture() {
  const style={display:'block',visibility:'visible',opacity:'1',pointerEvents:'auto'};
  const node=(id,tagName='DIV')=>({id,tagName,dataset:{},getAttribute:()=>null,style});
  const tab={dataset:{category:'all'}};
  const panel={dataset:{presentation:'furniture-showroom'},querySelector:selector=>selector.includes('aria-pressed')?tab:null};
  const listing={dataset:{listingId:'offer.dorm_furniture.study_books_set'}};
  const button=Object.assign(node('buy','BUTTON'),{
    dataset:{focusKey:'listing:offer.dorm_furniture.study_books_set'},isConnected:true,disabled:false,
    getBoundingClientRect:()=>({x:10,y:20,left:10,top:20,right:110,bottom:60,width:100,height:40}),
    closest:selector=>selector==='.shop-panel'?panel:selector==='[data-listing-id]'?listing:null,
    contains:other=>other===button,
    click:()=>assert.fail('diagnostics must not dispatch input'),
    scrollIntoView:()=>assert.fail('diagnostics must not change scroll')
  });
  const doc={visibilityState:'visible',hasFocus:()=>true,activeElement:button,
    elementsFromPoint:()=>[button],querySelectorAll:()=>[{},{}],
    defaultView:{innerWidth:1280,innerHeight:800,getComputedStyle:element=>element.style,
      __STARTER_FURNITURE__:{frameCounts:()=>({updated:22,rendered:21})}}
  };
  button.ownerDocument=doc;
  return {button,doc,node,tab};
}

test('browser-serialized probe reports exact target/category/frame state without input or scroll',()=>{
  const {button}=fixture();
  // Playwright serializes this function into the page; module closures must not be required.
  const r=vm.runInNewContext(`(${inspectStarterPurchaseButton.toString()})(button)`,{button});
  assert.equal(r.listingId,'offer.dorm_furniture.study_books_set');
  assert.equal(r.activeCategory,'all');
  assert.equal(r.presentation,'furniture-showroom');
  assert.equal(r.probeHitsTarget,true);
  assert.equal(r.probePoint.x,60);assert.equal(r.probePoint.y,40);
  assert.equal(r.disabled,false);assert.equal(r.frames.rendered,21);
  assert.equal(r.canvasCount,2);assert.equal(r.detailOpen,false);
});

test('visible enabled target can still be obstructed, while selected category is recorded independently',()=>{
  const {button,doc,node,tab}=fixture();
  const overlay=node('transparent-overlay');overlay.style={...overlay.style,opacity:'0'};
  doc.elementsFromPoint=()=>[overlay,button];tab.dataset.category='decor';
  const r=inspectStarterPurchaseButton(button);
  assert.equal(r.disabled,false);assert.equal(r.style.visibility,'visible');
  assert.equal(r.probeHitsTarget,false);assert.equal(r.hitStack[0].id,'transparent-overlay');
  assert.equal(r.activeCategory,'decor');
});

test('offscreen/disabled state produces no invented click point or positive hit',()=>{
  const {button,doc}=fixture();
  button.disabled=true;
  button.getBoundingClientRect=()=>({x:2000,y:20,left:2000,top:20,right:2100,bottom:60,width:100,height:40});
  doc.elementsFromPoint=()=>assert.fail('offscreen target has no viewport probe point');
  const r=inspectStarterPurchaseButton(button);
  assert.equal(r.disabled,true);assert.equal(r.probePoint,null);assert.equal(r.probeHitsTarget,false);
  assert.deepEqual(r.hitStack,[]);
});

test('binding entry is retained while the real RPC response is pending, without copying tokens or arguments',async()=>{
  const invocations=[];let resolveResponse;
  const pending=trackStarterPurchaseRpc(invocations,'purchase_world_shop_listing_v1',
    {p_listing_id:'books',p_idempotency_key:'not-for-diagnostics'},()=>new Promise(resolve=>{resolveResponse=resolve;}));
  assert.equal(invocations.length,1);assert.equal(invocations[0].state,'BINDING_ENTERED');
  assert.equal(invocations[0].finishedAt,undefined);
  assert.equal(JSON.stringify(invocations).includes('not-for-diagnostics'),false);
  const response={data:{status:'SUCCESS'},error:null};resolveResponse(response);
  assert.equal(await pending,response);assert.equal(invocations[0].state,'RETURNED');
  assert.ok(invocations[0].finishedAt);
});

test('RPC rejection and error responses retain their original behavior plus an invocation record',async()=>{
  const invocations=[],error=new Error('transport failed');
  await assert.rejects(trackStarterPurchaseRpc(invocations,'purchase_world_shop_listing_v1',
    {p_listing_id:'books'},()=>Promise.reject(error)),actual=>actual===error);
  assert.equal(invocations[0].state,'THREW');
  const response={data:null,error:{message:'INSUFFICIENT_FUNDS'}};
  assert.equal(await trackStarterPurchaseRpc(invocations,'purchase_world_shop_listing_v1',
    {p_listing_id:'books'},()=>Promise.resolve(response)),response);
  assert.equal(invocations[1].state,'ERROR_RESPONSE');
});
