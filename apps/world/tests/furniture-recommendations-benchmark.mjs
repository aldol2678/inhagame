// Informational CPU receipt, not a mobile-frame-time acceptance gate.
// Run separately from parallel tests for an isolated number.
import {performance} from 'node:perf_hooks';
import {recommendFurniture,FURNITURE_STYLES} from '../src/rooms/furniture-recommendations.js';
import {ROOM_FURNITURE,validateFurniture} from '../src/rooms/furniture-layout.js';
const inventory=ROOM_FURNITURE.map(item=>({itemId:item.itemId,quantity:2}));
const measurements=[];
for(const cache of ['cold','warm'])for(const {id:style} of FURNITURE_STYLES){
  const start=performance.now(),result=recommendFurniture(style,inventory);
  const ms=Number((performance.now()-start).toFixed(2));
  if(result.error||validateFurniture(result.objects,inventory))throw Error('Invalid benchmark candidate');
  measurements.push({cache,style,ms,placed:result.objects.length,unplaced:result.unplaced.reduce((n,row)=>n+row.quantity,0)});
}
console.log(JSON.stringify({node:process.version,platform:process.platform,catalogTypes:inventory.length,copies:2,measurements},null,2));
