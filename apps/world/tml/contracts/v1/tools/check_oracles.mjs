// Independent ECMAScript/JCS oracle. No imports from the application or Python generator.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const corpus=JSON.parse(fs.readFileSync(path.join(root,'conformance-corpus.json')));
const registry=JSON.parse(fs.readFileSync(path.join(root,'structural-sets.json'))).sets;
function canon(v){
 if(v===null||typeof v==='boolean'||typeof v==='string')return JSON.stringify(v);
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('nonfinite');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(canon).join(',')+']';
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
}
function norm(value,kind){
 const v=structuredClone(value);
 function key(x,k){return k==='$'?x:k.split('.').reduce((o,a)=>o[a],x);}
 function apply(o,p,r){
  if(!p.length){o.sort((a,b)=>{for(const k of r.sortKey){let x=key(a,k),y=key(b,k);if(k==='revision'||k==='reward.version'){x=BigInt(x);y=BigInt(y);}if(x<y)return -1;if(x>y)return 1;}return 0;});return;}
  const [k,...tail]=p;if(k==='*'){for(const z of o)apply(z,tail,r);}else if(o&&Object.hasOwn(o,k))apply(o[k],tail,r);
 }
 function walk(o,k){
  if(Array.isArray(o)){o.forEach(x=>walk(x));return;}
  if(!o||typeof o!=='object')return;
  Object.values(o).forEach(x=>walk(x));
  const typ=k??o.schema??(o.scope&&o.idempotencyKey&&o.args?'request':null);
  for(const r of registry)if(r.schema===typ)apply(o,r.path.slice(1).split('/'),r);
 }
 walk(v,kind);return v;
}
function timeAdapter(text){
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.([0-9]+)(Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
 if(!m||/[1-9]/.test(m[7].slice(6)))throw Error('non-lossless time');
 let y=Number(m[1]),mo=Number(m[2]),day=Number(m[3]),minutes=Number(m[4])*60+Number(m[5]);
 const days=(y,mo)=>[31,((y%4===0&&y%100!==0)||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][mo-1];
 if(y<1||mo<1||mo>12||day<1||day>days(y,mo)||Number(m[4])>23||Number(m[5])>59||Number(m[6])>59)throw Error('time range');
 if(m[8]!=='Z')minutes-=(m[9]==='+'?1:-1)*(Number(m[10])*60+Number(m[11]));
 while(minutes<0){minutes+=1440;day--;if(day===0){mo--;if(mo===0){mo=12;y--;}day=days(y,mo);}}
 while(minutes>=1440){minutes-=1440;day++;if(day>days(y,mo)){day=1;mo++;if(mo===13){mo=1;y++;}}}
 const pad=(x,n=2)=>String(x).padStart(n,'0');
 return `${pad(y,4)}-${pad(mo)}-${pad(day)}T${pad(Math.floor(minutes/60))}:${pad(minutes%60)}:${m[6]}.${m[7].slice(0,6).padEnd(6,'0')}Z`;
}
function hash(d,t){return 'sha256:'+crypto.createHash('sha256').update(d+'\n'+t).digest('hex');}
let n=0;
for(const c of corpus.cases){
 const e=c.expected;if(e.canonicalUtf8===null)continue;
 let actual;
 const v=c.input.structuredInput;
 if(c.layer==='fingerprint'){
  const {idempotencyKey,...q}=structuredClone(v.request);delete q.scope.executionId;actual=norm(q,'fingerprint');
 }else if(c.layer==='normalization')actual=norm(v.value,v.kind);
 else if(c.layer==='time-adapter')actual=timeAdapter(v.text);
 else if(c.input.wireBytesBase64!==null)actual=norm(JSON.parse(Buffer.from(c.input.wireBytesBase64,'base64').toString('utf8')),c.layer==='limits'?'bundle':null);
 else actual=norm(v,c.layer==='evaluation'?'bundle':null);
 const s=canon(actual);const domain=c.layer==='fingerprint'?'TML1/request':'TML1/vector';
 if(s!==e.canonicalUtf8||hash(domain,s)!==e.digest||canon(e.normalized)!==s)throw Error('case oracle mismatch: '+c.id);
 n++;
}
for(const c of corpus.cases){
 const h=c.input.hostFixture;if(!h)continue;
 const {revision,...p}=h.profile;
 if(hash('TML1/profile',canon(norm(p)))!==revision)throw Error('profile hash '+c.id);
 for(const e of h.executions){const {idempotencyKey,...q}=structuredClone(e.request);delete q.scope.executionId;if(hash('TML1/request',canon(norm(q,'fingerprint')))!==e.requestFingerprint)throw Error('host request hash '+c.id);}
}
const m=JSON.parse(fs.readFileSync(path.join(root,'canonical-digest-manifest.json')));
for(const e of m.entries){
 const s=canon(JSON.parse(e.canonicalUtf8));
 if(s!==e.canonicalUtf8||Buffer.from(s).toString('base64')!==e.canonicalBytesBase64||hash(e.domain,s)!==e.sha256)throw Error('manifest mismatch '+e.sha256);
}
console.log(JSON.stringify({independentNodeCanonicalCases:n,manifestEntries:m.entries.length,passed:true}));
