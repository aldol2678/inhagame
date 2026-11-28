import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const sourceDir=new URL('../assets/npcs/refresh-72/',import.meta.url);
const input=file=>readFileSync(process.env.INHA_NPC_ASSETS ? join(process.env.INHA_NPC_ASSETS,file) : new URL(file,sourceDir));
const manifest=JSON.parse(input('manifest.json'));
const read=id=>{
 const filename=id+'.glb', b=input(filename), item=manifest.find(r=>r.file===filename);
 assert.ok(item,filename);
 assert.equal(b.length,item.bytes);
 assert.equal(createHash('sha256').update(b).digest('hex'),item.sha256);
 return JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
};
test('the camera clip has an attached hand socket; the seat clip carries a calibrated contact',()=>{
 const photo=read('INKYUNG_NPC_009'),seat=read('INKYUNG_NPC_010');
 assert.ok(photo.animations.some(a=>a.name==='Campus_Photo'));
 const socket=photo.nodes.findIndex(n=>n.name==='Campus_Camera_Socket');
 assert.ok(photo.nodes.find(n=>n.name==='Hand.R').children.includes(socket));
 assert.ok(seat.animations.some(a=>a.name==='Campus_Seat'));
 assert.ok(seat.nodes.some(n=>n.name==='Campus_Seat_Contact'));
});
test('reading and coffee rigs add calibrated prop sockets and leave locomotion intact',()=>{
 for(const [id,clip,socket,hand] of [
  ['003','Campus_Read','Campus_Book_Socket','Hand.R'],
  ['012','Campus_Coffee','Campus_Cup_Socket','Hand.R'],
 ]){
  const g=read('INKYUNG_NPC_'+id);
  const animation=g.animations.find(a=>a.name===clip);
  assert.ok(animation,clip);
  assert.ok(g.nodes.find(n=>n.name===hand).children.includes(g.nodes.findIndex(n=>n.name===socket)));
  assert.ok(g.animations.some(a=>a.name==='Walk_In_Place'));
  if(clip==='Campus_Coffee')assert.ok(animation.samplers.some(s=>g.accessors[s.input].count>=7),'sip is animated, not held');
  else assert.ok(animation.channels.some(c=>g.nodes[c.target.node].name==='Forearm.L'),'left arm supports the book');
 }
});

test('both readers retain an open-book clip and a forearm carry socket',()=>{
 for(const id of ['003','012']){
  const g=read('INKYUNG_NPC_'+id);
  for(const [clip,socket,parent] of [['Campus_Read','Campus_Book_Socket','Hand.R'],
    ['Carry_Book_Walk','Campus_Book_Tuck_Socket','Forearm.L']]){
   assert.ok(g.animations.some(a=>a.name===clip));
   const i=g.nodes.findIndex(n=>n.name===socket);
   assert.ok(i>=0&&g.nodes.find(n=>n.name===parent).children.includes(i));
  }
 }
});
test('standing phone and snack NPCs have animated hand attachments',()=>{
 for(const [id,clip,socket] of [['005','Campus_Phone','Campus_Phone_Socket'],['006','Campus_Snack','Campus_Snack_Socket']]){
  const g=read('INKYUNG_NPC_'+id);
  const a=g.animations.find(a=>a.name===clip);
  assert.ok(a,clip);
  assert.ok(a.samplers.some(s=>g.accessors[s.input].count>4));
  const i=g.nodes.findIndex(n=>n.name===socket);
  assert.ok(i>=0&&g.nodes.find(n=>n.name==='Hand.R').children.includes(i));
  assert.ok(a.channels.some(c=>c.target.node===i&&c.target.path==='translation'));
 }
});
