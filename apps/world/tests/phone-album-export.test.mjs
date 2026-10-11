import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAlbumZip, measureAlbum, requestAlbumDownload, ALBUM_EXPORT_LIMITS } from '../src/phone/phone-album-export.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
function fixture(count = 3) {
  const originals = Array.from({ length: count }, (_,i) => new Blob([png, new Uint8Array(i)], {type:'image/png'}));
  const records = originals.map((_,i) => ({id:`private-account/${i}`,favorite:i%2===0,position:{x:123,y:456,z:789},token:'secret',caption:'email@example.com'}));
  return { generation: 1, originals, records, reads:0, writes:0,
    async list(){return records;}, async sizes(id){const index=records.findIndex(r=>r.id===id);return {originalBytes:originals[index].size,thumbnailBytes:7,damaged:false};},
    async image(id){this.reads++;return originals[records.findIndex(r=>r.id===id)];} };
}
const zip = (album, options={}) => createAlbumZip({album, validate:async()=>{}, yieldTask:async()=>{}, ...options});
async function unzip(blob) {
  const dir=await mkdtemp(join(tmpdir(),'album-zip-'));
  try {await writeFile(join(dir,'photos.zip'),Buffer.from(await blob.arrayBuffer()));return JSON.parse(execFileSync('python3',['-c',`import zipfile,json,sys,base64
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 print(json.dumps([{'name':n,'data':base64.b64encode(z.read(n)).decode()} for n in z.namelist()]))`,join(dir,'photos.zip')],{encoding:'utf8'}));}
  finally {await rm(dir,{recursive:true,force:true});}
}
test('empty and many albums account for originals and thumbnails independently without original reads',async()=>{
  assert.deepEqual(await measureAlbum(fixture(0)),{count:0,originalBytes:0,thumbnailBytes:0,damaged:0,photos:[]});
  const album=fixture(120),stats=await measureAlbum(album);assert.equal(stats.count,120);assert.equal(stats.originalBytes,album.originals.reduce((n,b)=>n+b.size,0));assert.equal(stats.thumbnailBytes,840);assert.equal(album.reads,0);
});
for(const mode of ['all','favorites','selected'])test(`${mode}: ZIP CRC, unique safe names, original bytes and source preservation`,async()=>{
  const album=fixture(),progress=[],before=JSON.stringify(album.records),selected=[album.records[1].id];
  const blob=await zip(album,{mode,selected,onProgress:p=>progress.push(p)}),files=await unzip(blob);
  const indices=mode==='all'?[0,1,2]:mode==='favorites'?[0,2]:[1];assert.equal(files.length,indices.length);
  assert.equal(new Set(files.map(f=>f.name)).size,indices.length);
  for(let i=0;i<indices.length;i++){assert.match(files[i].name,/^photo-\d{4}\.png$/);assert.deepEqual(Buffer.from(files[i].data,'base64'),Buffer.from(await album.originals[indices[i]].arrayBuffer()));}
  assert.equal(JSON.stringify(album.records),before);assert.equal(album.writes,0);assert.equal(progress.at(-1).completed,indices.length);
  assert.doesNotMatch(Buffer.from(await blob.arrayBuffer()).toString(),/private-account|email@example|secret|position/);
});
test('limits reject before reading originals; no empty ZIP or unknown mode success',async()=>{
  const large=fixture();large.sizes=async()=>({originalBytes:ALBUM_EXPORT_LIMITS.bytes+1});
  await assert.rejects(zip(large),{code:'LIMIT'});assert.equal(large.reads,0);
  await assert.rejects(zip(fixture(101)),{code:'LIMIT'});await assert.rejects(zip(fixture(0)),{code:'EMPTY'});
  await assert.rejects(zip(fixture(),{mode:'unknown'}),{code:'INVALID_SELECTION'});
});
test('denied storage, missing, malformed and decode-failing originals reject without success',async()=>{
  const denied=fixture();denied.sizes=async()=>{throw Object.assign(Error('denied'),{name:'SecurityError'});};await assert.rejects(zip(denied),{name:'SecurityError'});
  for(const bad of [null,new Blob(['not an image'])]){const album=fixture();album.image=async()=>bad;await assert.rejects(zip(album),{code:'DAMAGED_PHOTO'});}
  await assert.rejects(zip(fixture(),{validate:async()=>{throw Error('decode failed');}}),{code:'DAMAGED_PHOTO'});
  const huge=Buffer.from(png);huge.writeUInt32BE(0x7fffffff,16);const album=fixture();album.image=async()=>new Blob([huge]);let decoded=false;
  await assert.rejects(zip(album,{validate:async()=>{decoded=true;}}),{code:'DAMAGED_PHOTO'});assert.equal(decoded,false);
});
test('cancel during CRC yields; A→B→A generation invalidates both sizing and export',async()=>{
  const controller=new AbortController();let turns=0;await assert.rejects(zip(fixture(),{signal:controller.signal,yieldTask:async()=>{if(++turns===2)controller.abort();}}),{name:'AbortError'});
  const album=fixture();await assert.rejects(zip(album,{yieldTask:async()=>{album.generation+=2;}}),{name:'AbortError'});
  const other=fixture(),sizes=other.sizes;other.sizes=async id=>{const value=await sizes(id);other.generation+=2;return value;};await assert.rejects(measureAlbum(other),{name:'AbortError'});
});
test('download errors propagate and object URLs are revoked, successful request releases URL',()=>{
  for(const throws of [false,true]){const revoked=[],timers=[],link={remove(){},click(){if(throws)throw Error('download denied');}};
    const options={doc:{createElement:()=>link,body:{append(){}}},win:{URL:{createObjectURL:()=> 'blob:qa',revokeObjectURL:u=>revoked.push(u)},setTimeout:f=>timers.push(f)}};
    if(throws)assert.throws(()=>requestAlbumDownload(new Blob(),options),/denied/);else{requestAlbumDownload(new Blob(),options);timers[0]();}
    assert.deepEqual(revoked,['blob:qa']);assert.equal(link.download,'inha-world-photos.zip');
  }
});
