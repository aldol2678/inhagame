import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,basename} from 'node:path';
const engine=process.env.PLAYCANVAS_TEST_MODULE;
export const ENGINE_AVAILABLE=Boolean(engine);
if(engine)registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:pathToFileURL(resolve(engine)).href,shortCircuit:true}:next(s,c)}});
export class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.events={};this.style={};this.attrs={};this.hidden=false;this.textContent='';this.isConnected=true;}
 append(...nodes){nodes.forEach(n=>this.appendChild(n));}
 appendChild(n){n.parentNode=this;this.children.push(n);return n;}
 remove(){this.isConnected=false;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
 setAttribute(k,v){this.attrs[k]=String(v);}
 getAttribute(k){return this.attrs[k]??null;}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,v){(this.events[k]??=new Set()).add(v);}
 removeEventListener(k,v){this.events[k]?.delete(v);}
 fire(k,e={}){for(const f of this.events[k]??[])f({target:this,preventDefault(){},stopPropagation(){},...e});}
 focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options;}
 getBoundingClientRect(){return {width:800,height:600,x:0,y:0};}
}
export function fakeDocument(){const d=new Element('document');d.createElement=tag=>{const e=new Element(tag);e.ownerDocument=d;return e};d.head=d.createElement('head');d.body=d.createElement('body');d.getElementById=id=>{const find=n=>n.id===id?n:n.children.map(find).find(Boolean);return find(d.body)||find(d.head)};return d;}
export async function realEngine(){
 if(!engine)throw new Error('Set PLAYCANVAS_TEST_MODULE to the existing PlayCanvas 2.22.4 module');
 globalThis.window=globalThis.window??new Element('window');
 globalThis.document=fakeDocument();
 globalThis.HTMLImageElement=class {constructor(){this.width=this.height=this.naturalWidth=this.naturalHeight=512}set src(v){queueMicrotask(()=>this.onload?.())}};
 globalThis.Image=HTMLImageElement;globalThis.HTMLVideoElement=class {};globalThis.HTMLCanvasElement=class {};globalThis.ImageBitmap=class {};
 const pc=await import('playcanvas');
 pc.Asset.fetchArrayBuffer=(url,cb)=>{try{const p=new URL('../../assets/npcs/inkyung-daily-v031/'+basename(url),import.meta.url),b=readFileSync(p);queueMicrotask(()=>cb(null,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));}catch(e){cb(e)}};
 const canvas=new Element('canvas');canvas.width=800;canvas.height=600;
 const app=new pc.Application(canvas,{graphicsDevice:new pc.NullGraphicsDevice(canvas)});
 const root=new pc.Entity('Canonical campus');root.setLocalScale(1,1,-1);app.root.addChild(root);
 return {pc,app,root,document:globalThis.document};
}
export const waitReady=async layer=>{for(let i=0;i<100&&layer.status().loading;i++)await new Promise(r=>setTimeout(r,10));};
