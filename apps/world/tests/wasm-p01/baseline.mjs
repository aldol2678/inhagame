import {execFileSync} from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { workloads, distribution } from './workloads.mjs';
const {navigator,metadata,cases}=await workloads();
let checksum=0;
const results=[];
for(const {name,points} of cases){
  const run=()=>{let sum=0;for(const point of points)sum+=navigator.walkable(point);return sum;};
  for(let i=0;i<20;i++)checksum+=run();
  const iterations=Math.max(1,Math.min(100,Math.floor(10000/points.length)));
  const samples=[];
  for(let sample=0;sample<31;sample++){
    const start=performance.now();for(let i=0;i<iterations;i++)checksum+=run();samples.push((performance.now()-start)/iterations);
  }
  results.push({name,count:points.length,iterations,...distribution(samples)});
}
const result={kind:'JS_ONLY_BASELINE',sourceBase:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,cpu:os.cpus()[0]?.model,platform:process.platform,arch:process.arch,metadata,checksum,results};
await writeFile(new URL('./js-baseline.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,results:results.map(({samplesMs,...r})=>r)},null,2));
