import { readFile } from 'node:fs/promises';
import { loadNpcPopulation } from '../../npc-factory/npc-population-loader.mjs';
import { createNpcNavigator } from '../../npc-factory/dev-navigation.mjs';
import { PERIODS, snapshotForPeriod } from '../../npc-factory/dev-runtime-state.mjs';
export async function workloads() {
  const fetcher = async url => new Response(await readFile(new URL(`../..${url}`, import.meta.url)));
  const { batch, expansion } = await loadNpcPopulation({ fetcher, retryDelays: [] });
  const navigator = createNpcNavigator(batch);
  const geometry = navigator.navigationGeometry();
  const { bounds: b, cellSize } = geometry;
  const width = Math.round((b.maxX-b.minX)/cellSize)+1;
  const height = Math.round((b.maxZ-b.minZ)/cellSize)+1;
  const grid = Array.from({length:width*height}, (_,i)=>({x:b.minX+i%width*cellSize,z:b.minZ+Math.floor(i/width)*cellSize}));
  const current = PERIODS.map(period => ({name:`npc-${period}`, points:snapshotForPeriod(batch,period).actors.map(a=>a.position).filter(Boolean)}));
  // Evenly sample the actual canonical grid, not an invented dense worst-case scene.
  const sample = count => Array.from({length:count},(_,i)=>grid[Math.floor(i*grid.length/count)]);
  return { batch, navigator, geometry, metadata:{npcCount:batch.npcs.length,expansion,width,height,gridPoints:grid.length,obstacles:geometry.obstacles.length,pondVertices:geometry.pond.length},
    cases:[...current,{name:'small-8',points:sample(8)},{name:'stratified-256',points:sample(256)},{name:'contiguous-grid-start-256',points:grid.slice(0,256)},{name:'contiguous-grid-middle-256',points:grid.slice(Math.floor(grid.length/2),Math.floor(grid.length/2)+256)},{name:'contiguous-grid-final',points:grid.slice(Math.floor(grid.length/256)*256)},{name:'medium-4096',points:sample(4096)},{name:'actual-full-grid',points:grid}] };
}
export const distribution = samples => {
  const sorted=[...samples].sort((a,b)=>a-b),at=p=>sorted[Math.floor((sorted.length-1)*p)];
  return {samplesMs:samples,minMs:sorted[0],p50Ms:at(.5),p95Ms:at(.95),maxMs:sorted.at(-1)};
};
