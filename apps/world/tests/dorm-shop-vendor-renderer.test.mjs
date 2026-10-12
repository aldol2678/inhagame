import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const pcStub = 'export class Vec3 { set(x,y,z){Object.assign(this,{x,y,z});return this;} }';
const avatarStub = `export function createHumanAvatar(root, actor) {
 const avatar={enabled:true,setLocalPosition(x,y,z){this.position={x,y,z}},setLocalEulerAngles(x,y,z){this.heading=y},getPosition(){return {...this.position,z:-this.position.z}},destroy(){this.destroyed=true}};
 root.actor=actor;return {avatar,marker:{enabled:true},identityMarker:{enabled:true},arms:[{setLocalEulerAngles(){}},{setLocalEulerAngles(){}}]};
}`;
registerHooks({ resolve(specifier, context, next) {
 const stub=specifier==='playcanvas'?pcStub:specifier.endsWith('/dev-human-avatar.mjs')?avatarStub:null;
 return stub?{url:`data:text/javascript,${encodeURIComponent(stub)}`,shortCircuit:true}:next(specifier,context);
} });
const { createDormShopVendorRenderer } = await import('../src/rooms/dorm-shop-vendor-renderer.js');
function rig() {
 const events = () => ({listeners:new Map(),on(event,fn){this.listeners.set(event,fn)},off(event,fn){if(this.listeners.get(event)===fn)this.listeners.delete(event)}});
 const root={...events(),enabled:false}, app={...events(),graphicsDevice:{canvas:{getBoundingClientRect:()=>({left:0,top:0,width:390,height:844})}}};
 const label={style:{},setAttribute(){},getBoundingClientRect:()=>({width:160}),remove(){this.removed=true}};
 const doc={createElement:()=>label,body:{append(){}}};
 let position={x:0,z:.85};
 const renderer=createDormShopVendorRenderer({app,root,doc,player:{getLocalPosition:()=>position},camera:{camera:{worldToScreen:p=>({x:200,y:200,z:2})}}});
 return {renderer,app,root,label,position:p=>{position=p},draw:()=>app.listeners.get('postrender')?.(),tick:()=>app.listeners.get('update')?.(.05)};
}
test('room-local actor idles in place, faces front customers and hides outside the room', () => {
 const r=rig(); r.tick();r.draw();assert.equal(r.label.hidden,true);assert.equal(r.renderer.visual.avatar.enabled,false);
 r.root.enabled=true;r.tick();r.draw();const v=r.renderer.visual;
 assert.equal(v.avatar.enabled,true);assert.equal(v.avatar.position.z,2.7);assert.equal(v.avatar.heading,180);
 assert.equal(v.marker.enabled,false);assert.equal(v.identityMarker.enabled,false);assert.equal(r.label.hidden,false);
 r.position({x:1,z:.85});r.tick();assert.ok(v.avatar.heading<180&&v.avatar.heading>=145);
 r.position({x:1,z:3});r.tick();assert.equal(v.avatar.heading,180,'does not turn its back on the counter');
 r.root.enabled=false;r.tick();assert.equal(r.label.hidden,true);
});
test('root destruction disposes only owned actor/label and listeners, idempotently', () => {
 const r=rig();r.root.listeners.get('destroy')();r.renderer.destroy();
 assert.equal(r.renderer.disposed,true);assert.equal(r.label.removed,true);assert.equal(r.renderer.visual.avatar.destroyed,true);
 assert.equal(r.app.listeners.size,0);assert.equal(r.root.listeners.size,0);
});
