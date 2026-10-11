import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendFurniture, FURNITURE_STYLES } from '../src/rooms/furniture-recommendations.js';
import { ROOM_FURNITURE, validateFurniture, furnitureBox, firstFurniturePosition } from '../src/rooms/furniture-layout.js';
const all = ROOM_FURNITURE.map(item=>({itemId:item.itemId,quantity:2}));
test('three deterministic styles use only owned quantities, runtime bounds, fixed facilities and door rules',()=>{
  const layouts=[];
  for (const {id} of FURNITURE_STYLES) {
    const input=structuredClone(all),result=recommendFurniture(id,input);
    assert.equal(result.error,null);assert.ok(result.objects.length>10);assert.equal(validateFurniture(result.objects,all),null);
    assert.deepEqual(recommendFurniture(id,input),result);assert.deepEqual(input,all);
    for(const row of all) assert.equal(result.objects.filter(x=>x.itemId===row.itemId).length+result.unplaced.filter(x=>x.itemId===row.itemId).reduce((sum,x)=>sum+x.quantity,0),row.quantity);
    layouts.push(JSON.stringify(result.objects));
    if(id==='open') for(const object of result.objects.filter(x=>x.surface==='floor')) {
      const box=furnitureBox(object);assert.ok(box.maxX<=-2 || box.minX>=2 || box.maxZ<=-2.25 || box.minZ>=2.25);
    }
  }
  assert.equal(new Set(layouts).size,3);
});
test('empty, partial and duplicate copies are handled without invented furniture',()=>{
  assert.deepEqual(recommendFurniture('study',[]),{objects:[],unplaced:[],error:null});
  const items=[{itemId:'furniture.induck_chair',quantity:3}],result=recommendFurniture('relax',items);
  assert.equal(result.objects.length,3);assert.equal(new Set(result.objects.map(x=>x.id)).size,3);assert.equal(validateFurniture(result.objects,items),null);
  assert.ok(result.objects.every(x=>x.itemId===items[0].itemId));
});
test('slot cap and exhausted surfaces explain unplaced quantities, including very large inventory counts',()=>{
  const many=[{itemId:'furniture.mini_induck',quantity:1000000}],result=recommendFurniture('open',many);
  assert.equal(result.objects.length,32);assert.equal(result.unplaced[0].quantity,999968);assert.match(result.unplaced[0].reason,/32/);
  const cramped=recommendFurniture('study',[{itemId:'furniture.dorm_monitor',quantity:50}]);
  assert.ok(cramped.objects.length<32);assert.ok(cramped.unplaced.length);assert.match(cramped.unplaced[0].reason,/공간/);
});
test('instance ids survive repeat recommendations and existing generated ids do not collide',()=>{
  const items=[{itemId:'furniture.induck_chair',quantity:2}];
  const first=recommendFurniture('study',items),next=recommendFurniture('relax',items,first.objects);
  assert.deepEqual(next.objects.map(x=>x.id),first.objects.map(x=>x.id));
  assert.deepEqual(recommendFurniture('relax',items,next.objects),next);
});
test('malformed inventory and unsupported styles fail closed',()=>{
  for(const items of [null,[{itemId:'furniture.induck_chair',quantity:NaN}],[{itemId:'furniture.induck_chair',quantity:-1}],[all[0],all[0]]]) assert.ok(recommendFurniture('study',items).error);
  assert.ok(recommendFurniture('unknown',all).error);
});
test('ranked placement candidates still pass the shared validator and honor rotated bounds',()=>{
  const itemId='furniture.induck_chair',owned=[{itemId,quantity:1}];
  assert.equal(firstFurniturePosition(itemId,'floor',[],owned,{positions:[{x:100,z:0,yaw:45},{x:0,z:-3,yaw:0},{x:NaN,z:0,yaw:0}]}),null);
  const candidate=firstFurniturePosition(itemId,'floor',[],owned,{positions:[{x:-6,z:0,yaw:45}]});
  assert.equal(candidate.yaw,45);assert.equal(validateFurniture([candidate],owned),null);
});

test('cached candidate geometry remains inventory-independent and cannot restore unowned copies',()=>{
  for(const {id} of FURNITURE_STYLES){
    recommendFurniture(id,all);
    const single=[{itemId:'furniture.induck_chair',quantity:1}];
    const result=recommendFurniture(id,single);
    assert.equal(result.objects.length,1);assert.equal(result.objects[0].itemId,single[0].itemId);
    assert.equal(validateFurniture(result.objects,single),null);
    assert.deepEqual(recommendFurniture(id,[]),{objects:[],unplaced:[],error:null});
  }
});
