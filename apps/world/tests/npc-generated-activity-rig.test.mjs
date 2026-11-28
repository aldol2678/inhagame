import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=id=>{const b=readFileSync(new URL('../assets/npcs/refresh-72/'+id+'.glb',import.meta.url));return JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));};
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
