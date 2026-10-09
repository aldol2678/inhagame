import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewDistanceSettings } from '../src/view-distance-settings.js';

class Element extends EventTarget {
  value = ''; hidden = true; checked = false; textContent = ''; selectedOptions = [{textContent:'자동'}];
  setAttribute() {} focus() {} closest() { return null; }
}
test('detail controls apply typed values, reset UI and remove listeners on destroy', () => {
  const ids = ['open-settings','view-settings','close-settings','view-distance','graphics-quality',
    'graphics-quality-hint','view-settings-status','graphics-frame-limit','graphics-render-scale',
    'graphics-shadows','graphics-show-fps','graphics-reset'];
  const nodes = Object.fromEntries(ids.map(id=>[id,new Element()]));
  const doc = new EventTarget(); doc.getElementById=id=>nodes[id]; doc.body={dataset:{}};
  const oldDoc=globalThis.document,oldWindow=globalThis.window;
  globalThis.document=doc;globalThis.window={localStorage:undefined};
  let calls=0;
  let state={frameLimit:45,renderScale:0.85,shadows:'off',showFps:true};
  const graphics={preference:'auto',tier:'low',visualPolicy:p=>p,status:()=>state,
    setDetail(key,value){state[key]=value;calls++;return true;},
    reset(){state={frameLimit:'auto',renderScale:'auto',shadows:'auto',showFps:false};return true;}};
  try {
    const panel=createViewDistanceSettings({setPolicy(){}},{camera:{}},graphics);
    assert.equal(nodes['graphics-frame-limit'].value,'45');
    nodes['graphics-frame-limit'].value='30';nodes['graphics-frame-limit'].dispatchEvent(new Event('change'));
    assert.equal(state.frameLimit,30);
    nodes['graphics-show-fps'].checked=false;nodes['graphics-show-fps'].dispatchEvent(new Event('change'));
    assert.equal(state.showFps,false);
    nodes['graphics-reset'].dispatchEvent(new Event('click'));
    assert.equal(nodes['graphics-frame-limit'].value,'auto');
    panel.setOpen(true);panel.destroy();panel.destroy();
    nodes['graphics-frame-limit'].dispatchEvent(new Event('change'));
    assert.equal(calls,2);
    assert.equal(panel.open,false);
  } finally {globalThis.document=oldDoc;globalThis.window=oldWindow;}
});
