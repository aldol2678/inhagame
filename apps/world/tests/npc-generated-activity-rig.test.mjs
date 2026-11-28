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
